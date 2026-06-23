use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::{OnceLock, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const LITELLM_PRICES_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const MIN_CANDIDATE_SCORE: f64 = 0.70;
const MAX_SYNC_TARGETS: usize = 500;
const REMOTE_FETCH_TIMEOUT: Duration = Duration::from_secs(20);

static MODEL_PRICE_CACHE: OnceLock<RwLock<HashMap<String, ModelPriceEntry>>> = OnceLock::new();
static MODEL_PRICE_CACHE_LOADED: OnceLock<RwLock<bool>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceEntry {
    pub model: String,
    pub input_per_1m: f64,
    pub output_per_1m: f64,
    pub cache_read_per_1m: f64,
    pub cache_creation_per_1m: f64,
    pub source: String,
    pub source_model_id: Option<String>,
    pub raw_json: Option<String>,
    pub updated_at_ms: i64,
    pub synced_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModelPrice {
    pub model: String,
    pub input_per_1m: f64,
    pub output_per_1m: f64,
    pub cache_read_per_1m: f64,
    pub cache_creation_per_1m: f64,
    pub source: String,
    pub source_model_id: String,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceSyncCandidate {
    pub target_model: String,
    pub score: f64,
    pub remote: RemoteModelPrice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceSyncMatch {
    pub target_model: String,
    pub score: f64,
    pub remote: RemoteModelPrice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceSyncResult {
    pub matched: Vec<ModelPriceSyncMatch>,
    pub candidates: Vec<ModelPriceSyncCandidate>,
    pub unmatched: Vec<String>,
    pub fetched_count: usize,
}

#[derive(Debug, Clone)]
pub struct CachedModelPricing {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_creation_per_million: f64,
}

#[derive(Debug, Clone)]
pub enum CachedModelPricingLookup {
    CacheUnavailable,
    Found(CachedModelPricing),
    Missing,
}

#[tauri::command]
pub fn model_prices_set_cache(prices: Vec<ModelPriceEntry>) -> Result<(), String> {
    let mut next = HashMap::new();
    for price in prices {
        if !is_valid_price_entry(&price) {
            continue;
        }
        if let Some(normalized) = normalize_model_id(&price.model) {
            next.insert(normalized, price);
        }
    }

    let cache = MODEL_PRICE_CACHE.get_or_init(|| RwLock::new(HashMap::new()));
    let mut guard = cache
        .write()
        .map_err(|_| "model price cache lock poisoned".to_string())?;
    *guard = next;

    let loaded = MODEL_PRICE_CACHE_LOADED.get_or_init(|| RwLock::new(false));
    let mut loaded_guard = loaded
        .write()
        .map_err(|_| "model price cache loaded flag lock poisoned".to_string())?;
    *loaded_guard = true;
    Ok(())
}

#[tauri::command]
pub async fn model_prices_sync(targets: Vec<String>) -> Result<ModelPriceSyncResult, String> {
    if targets.len() > MAX_SYNC_TARGETS {
        return Err(format!(
            "too many model price sync targets: {} (max {MAX_SYNC_TARGETS})",
            targets.len()
        ));
    }

    let mut remote_prices = fetch_remote_prices().await?;
    remote_prices.sort_by(|a, b| source_priority(&a.source).cmp(&source_priority(&b.source)));

    let mut seen_remote = HashSet::new();
    remote_prices.retain(|price| seen_remote.insert(normalize_for_compare(&price.model)));

    let mut seen_targets = HashSet::new();
    let mut matched = Vec::new();
    let mut candidates = Vec::new();
    let mut unmatched = Vec::new();

    for target in targets
        .into_iter()
        .map(|target| target.trim().to_string())
        .filter(|target| !target.is_empty())
        .filter(|target| seen_targets.insert(normalize_for_compare(target)))
    {
        let ranked = rank_candidates(&target, &remote_prices);
        if ranked.is_empty() {
            unmatched.push(target);
            continue;
        }

        let best = &ranked[0];
        if matches!(best.kind, MatchKind::Exact | MatchKind::CaseInsensitive) {
            matched.push(ModelPriceSyncMatch {
                target_model: target,
                score: best.score,
                remote: best.remote.clone(),
            });
            continue;
        }

        candidates.extend(
            ranked
                .into_iter()
                .take(5)
                .map(|candidate| ModelPriceSyncCandidate {
                    target_model: target.clone(),
                    score: candidate.score,
                    remote: candidate.remote,
                }),
        );
    }

    Ok(ModelPriceSyncResult {
        matched,
        candidates,
        unmatched,
        fetched_count: remote_prices.len(),
    })
}

pub fn find_cached_model_pricing(model: &str) -> CachedModelPricingLookup {
    let Some(normalized) = normalize_model_id(model) else {
        return CachedModelPricingLookup::Missing;
    };
    let loaded = MODEL_PRICE_CACHE_LOADED.get_or_init(|| RwLock::new(false));
    let Ok(loaded_guard) = loaded.read() else {
        return CachedModelPricingLookup::CacheUnavailable;
    };
    if !*loaded_guard {
        return CachedModelPricingLookup::CacheUnavailable;
    }
    drop(loaded_guard);

    let cache = MODEL_PRICE_CACHE.get_or_init(|| RwLock::new(HashMap::new()));
    let Ok(guard) = cache.read() else {
        return CachedModelPricingLookup::CacheUnavailable;
    };

    let Some(exact) = guard.get(&normalized).or_else(|| {
        guard
            .iter()
            .filter(|(key, _)| {
                normalized.starts_with(key.as_str())
                    && normalized.as_bytes().get(key.len()) == Some(&b'-')
            })
            .max_by_key(|(key, _)| key.len())
            .map(|(_, value)| value)
    }) else {
        return CachedModelPricingLookup::Missing;
    };

    CachedModelPricingLookup::Found(CachedModelPricing {
        input_per_million: exact.input_per_1m,
        output_per_million: exact.output_per_1m,
        cache_read_per_million: exact.cache_read_per_1m,
        cache_creation_per_million: exact.cache_creation_per_1m,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MatchKind {
    Exact,
    CaseInsensitive,
    Tail,
    Normalized,
    Fuzzy,
}

#[derive(Debug, Clone)]
struct RankedRemotePrice {
    score: f64,
    kind: MatchKind,
    remote: RemoteModelPrice,
}

async fn fetch_remote_prices() -> Result<Vec<RemoteModelPrice>, String> {
    let client = reqwest::Client::builder()
        .user_agent("CLI-Manager model pricing sync")
        .timeout(REMOTE_FETCH_TIMEOUT)
        .build()
        .map_err(|err| format!("failed to create HTTP client: {err}"))?;

    let (litellm_result, openrouter_result) = tokio::join!(
        fetch_litellm_prices(&client),
        fetch_openrouter_prices(&client)
    );
    let mut errors = Vec::new();
    let mut prices = Vec::new();

    match litellm_result {
        Ok(mut items) => prices.append(&mut items),
        Err(err) => errors.push(err),
    }
    match openrouter_result {
        Ok(mut items) => prices.append(&mut items),
        Err(err) => errors.push(err),
    }

    if prices.is_empty() {
        let detail = if errors.is_empty() {
            "remote price sources returned no usable models".to_string()
        } else {
            errors.join("; ")
        };
        return Err(detail);
    }
    Ok(prices)
}

async fn fetch_litellm_prices(client: &reqwest::Client) -> Result<Vec<RemoteModelPrice>, String> {
    let response = client
        .get(LITELLM_PRICES_URL)
        .send()
        .await
        .map_err(|err| format!("failed to fetch LiteLLM prices: {err}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "LiteLLM price source returned {}",
            response.status()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|err| format!("failed to parse LiteLLM prices: {err}"))?;
    let Some(object) = value.as_object() else {
        return Ok(Vec::new());
    };

    let mut prices = Vec::new();
    for (model, raw) in object {
        if !raw.is_object() {
            continue;
        }
        let input = number_field(raw, &["input_cost_per_token", "prompt_cost_per_token"]);
        let output = number_field(raw, &["output_cost_per_token", "completion_cost_per_token"]);
        if input.is_none() && output.is_none() {
            continue;
        }
        prices.push(RemoteModelPrice {
            model: model.clone(),
            input_per_1m: per_million(input),
            output_per_1m: per_million(output),
            cache_read_per_1m: per_million(number_field(
                raw,
                &[
                    "cache_read_input_token_cost",
                    "input_cost_per_token_cache_read",
                ],
            )),
            cache_creation_per_1m: per_million(number_field(
                raw,
                &[
                    "cache_creation_input_token_cost",
                    "input_cost_per_token_cache_creation",
                ],
            )),
            source: "litellm".to_string(),
            source_model_id: model.clone(),
            raw_json: raw.to_string(),
        });
    }
    Ok(prices)
}

async fn fetch_openrouter_prices(
    client: &reqwest::Client,
) -> Result<Vec<RemoteModelPrice>, String> {
    let response = client
        .get(OPENROUTER_MODELS_URL)
        .send()
        .await
        .map_err(|err| format!("failed to fetch OpenRouter prices: {err}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "OpenRouter price source returned {}",
            response.status()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|err| format!("failed to parse OpenRouter prices: {err}"))?;
    let models = value
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut prices = Vec::new();
    for item in models {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        let pricing = item.get("pricing").unwrap_or(&Value::Null);
        let input = number_field(pricing, &["prompt"]);
        let output = number_field(pricing, &["completion"]);
        if input.is_none() && output.is_none() {
            continue;
        }
        prices.push(RemoteModelPrice {
            model: id.to_string(),
            input_per_1m: per_million(input),
            output_per_1m: per_million(output),
            cache_read_per_1m: per_million(number_field(pricing, &["cache_read", "cache"])),
            cache_creation_per_1m: per_million(number_field(pricing, &["cache_creation"])),
            source: "openrouter".to_string(),
            source_model_id: id.to_string(),
            raw_json: item.to_string(),
        });
    }
    Ok(prices)
}

fn rank_candidates(target: &str, remotes: &[RemoteModelPrice]) -> Vec<RankedRemotePrice> {
    let target_norm = normalize_for_compare(target);
    let target_tail = canonical_tail(target);
    let target_alnum = normalized_alnum(&target_tail);
    let mut ranked = Vec::new();

    for remote in remotes {
        let remote_norm = normalize_for_compare(&remote.model);
        let remote_tail = canonical_tail(&remote.model);
        let remote_alnum = normalized_alnum(&remote_tail);

        let (score, kind) = if target.trim() == remote.model.trim() {
            (1.0, MatchKind::Exact)
        } else if target.trim().eq_ignore_ascii_case(remote.model.trim()) {
            (0.995, MatchKind::CaseInsensitive)
        } else if target_norm == remote_norm {
            (0.99, MatchKind::Normalized)
        } else if target_tail == remote_tail {
            (0.98, MatchKind::Tail)
        } else if !target_alnum.is_empty() && target_alnum == remote_alnum {
            (0.96, MatchKind::Normalized)
        } else {
            let jaccard_score = jaccard(&target_alnum, &remote_alnum);
            let levenshtein_score = levenshtein_similarity(&target_alnum, &remote_alnum);
            (
                (jaccard_score * 0.45) + (levenshtein_score * 0.55),
                MatchKind::Fuzzy,
            )
        };

        if score >= MIN_CANDIDATE_SCORE {
            ranked.push(RankedRemotePrice {
                score,
                kind,
                remote: remote.clone(),
            });
        }
    }

    ranked.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| source_priority(&a.remote.source).cmp(&source_priority(&b.remote.source)))
            .then_with(|| a.remote.model.cmp(&b.remote.model))
    });
    ranked
}

pub fn normalize_model_id(model: &str) -> Option<String> {
    let mut value = model.trim().to_lowercase();
    if let Some(idx) = value.find('[') {
        value.truncate(idx);
    }
    if let Some(idx) = value.find('(') {
        value.truncate(idx);
    }
    value = value.trim().to_string();
    if value.is_empty() || value == "unknown" {
        return None;
    }
    value = value
        .strip_prefix("us.anthropic.com/")
        .unwrap_or(&value)
        .to_string();
    if let Some((_, tail)) = value.rsplit_once('/') {
        value = tail.to_string();
    }
    if let Some((head, _)) = value.split_once(':') {
        value = head.to_string();
    }
    value = value.replace('@', "-").replace('.', "-");
    while let Some(stripped) = value.strip_prefix("global-anthropic-") {
        value = stripped.to_string();
    }
    while let Some(stripped) = value.strip_prefix("anthropic-") {
        value = stripped.to_string();
    }
    if let Some(stripped) = value.strip_prefix("claude-gpt-") {
        value = format!("gpt-{stripped}");
    }
    value = strip_model_date_suffix(&value).unwrap_or(value);
    if let Some(stripped) = value.strip_suffix("-v1") {
        value = stripped.to_string();
    }
    (!value.is_empty()).then_some(value)
}

fn normalize_for_compare(model: &str) -> String {
    normalize_model_id(model).unwrap_or_else(|| model.trim().to_lowercase())
}

fn canonical_tail(model: &str) -> String {
    normalize_for_compare(model)
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn normalized_alnum(model: &str) -> String {
    model
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn strip_model_date_suffix(model: &str) -> Option<String> {
    let bytes = model.as_bytes();
    if bytes.len() < 11 {
        return None;
    }
    let date_start = bytes.len() - 10;
    if bytes.get(date_start - 1) != Some(&b'-') {
        return None;
    }
    let date = &bytes[date_start..];
    let is_date = date.iter().enumerate().all(|(idx, byte)| {
        (matches!(idx, 4 | 7) && *byte == b'-') || (!matches!(idx, 4 | 7) && byte.is_ascii_digit())
    });
    if !is_date {
        return None;
    }
    Some(model[..date_start - 1].to_string())
}

fn number_field(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        let Some(raw) = value.get(*key) else {
            continue;
        };
        let parsed = match raw {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.trim().parse::<f64>().ok(),
            _ => None,
        };
        if let Some(number) = parsed.filter(|number| number.is_finite() && *number >= 0.0) {
            return Some(number);
        }
    }
    None
}

fn per_million(value: Option<f64>) -> f64 {
    value.unwrap_or(0.0) * 1_000_000.0
}

fn is_valid_price_entry(price: &ModelPriceEntry) -> bool {
    !price.model.trim().is_empty()
        && [
            price.input_per_1m,
            price.output_per_1m,
            price.cache_read_per_1m,
            price.cache_creation_per_1m,
        ]
        .into_iter()
        .all(|value| value.is_finite() && value >= 0.0)
}

fn source_priority(source: &str) -> u8 {
    match source {
        "litellm" => 0,
        "openrouter" => 1,
        _ => 2,
    }
}

fn jaccard(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let a_set: HashSet<char> = a.chars().collect();
    let b_set: HashSet<char> = b.chars().collect();
    let intersection = a_set.intersection(&b_set).count() as f64;
    let union = a_set.union(&b_set).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn levenshtein_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let distance = levenshtein(a, b) as f64;
    let max_len = a.chars().count().max(b.chars().count()) as f64;
    if max_len == 0.0 {
        1.0
    } else {
        (1.0 - distance / max_len).max(0.0)
    }
}

fn levenshtein(a: &str, b: &str) -> usize {
    let b_chars: Vec<char> = b.chars().collect();
    let mut costs: Vec<usize> = (0..=b_chars.len()).collect();
    for (i, a_char) in a.chars().enumerate() {
        let mut previous = costs[0];
        costs[0] = i + 1;
        for (j, b_char) in b_chars.iter().enumerate() {
            let temp = costs[j + 1];
            let substitution = previous + usize::from(a_char != *b_char);
            costs[j + 1] = (costs[j + 1] + 1).min(costs[j] + 1).min(substitution);
            previous = temp;
        }
    }
    costs[b_chars.len()]
}
