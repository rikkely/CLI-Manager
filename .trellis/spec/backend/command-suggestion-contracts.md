# Command Suggestion Contracts

## Scenario: LLM-backed terminal command suggestions

### 1. Scope / Trigger

- Trigger: terminal input suggestions now cross frontend settings, Tauri commands, and an OpenAI-compatible model endpoint.
- Goal: keep LLM suggestions optional, fast, secret-safe, and unable to execute commands automatically.
- Execution model: local history/template/built-in suggestions are the first layer and must render without waiting for the model; the LLM is only an asynchronous second-phase upgrade for stable input.

### 2. Signatures

- `command_suggestion_test_model(baseUrl: string, apiKey: string, model: string) -> CommandSuggestionModelTestResult`
- `command_suggestion_generate(request: CommandSuggestionGenerateRequest) -> CommandSuggestionResponse`

```typescript
interface CommandSuggestionGenerateRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  input: string;
  cwd: string | null;
  previousCommand: string | null;
  history: string[];
  templates: string[];
}

interface CommandSuggestionResponse {
  command: string | null;
  responseTimeMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}
```

### 3. Contracts

- Backend auto-detects the endpoint from `baseUrl`: a full `/v1/responses` URL uses Responses; a full `/v1/chat/completions`, root, or `/v1` URL uses Chat Completions. It avoids duplicate `/v1`, `/v1/chat/completions`, or `/v1/responses` suffixes.
- API key is used only in the `Authorization: Bearer ...` header and must not be logged, returned, or written to task docs.
- Frontend sends only compact LLM context: history/templates are limited to the current command root, deduplicated, capped at 12 entries, and secret-bearing entries such as `.env`, token/password/API-key assignments, bearer tokens, provider keys, and private key file names are dropped or redacted before `command_suggestion_generate`.
- Frontend should compact `cwd` before sending it to the model instead of leaking the full absolute path; if the path contains secret markers, send `null`.
- Model test uses a minimal chat request and classifies:
  - `operational`: HTTP 2xx and response time is at or below the fast threshold.
  - `degraded`: HTTP 2xx but response is slow; UI should warn that it is not recommended.
  - `failed`: non-2xx, timeout, connection error, or invalid config.
- Generate returns a single candidate command or `null`; frontend must still require the command to start with the current input before showing a suffix.
- AI suffixes must be rejected when they introduce dangerous shells/pipes or force flags, for example `curl ... | sh`, `irm ... | iex`, shell pipe execution, `rm`/`del`/`Remove-Item`, `--force`, `--yes`, `-f`, or `-y`.
- LLM output is never executed. `Tab` / `Ctrl+Space` may insert only the accepted suffix.
- Backend should reuse a shared `reqwest::Client`; per-request timeout stays on the request builder. Response bodies are bounded before parsing to avoid unbounded memory growth.
- Usage stats are hot-path data. Frontend may update the Zustand state immediately, but persistent store writes should be batched/debounced.
- LLM suggestion diagnostics must follow the system Debug Mode. When debug mode is off, no prediction diagnostics are emitted. When debug mode is on, frontend `@tauri-apps/plugin-log` entries and backend command logs write to the existing local log file.
- Debug diagnostics may include endpoint type, sanitized endpoint URL, model name, response time, HTTP status, body byte length, context item counts, token usage, and frontend reject/fallback reason. They must not include API keys, full current input, prompt text, history/template command text, cwd absolute path, or response body text.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Empty `baseUrl` | Return `missing_base_url` |
| Empty `apiKey` | Return `missing_api_key` |
| Empty `model` | Return `missing_model` |
| Empty `input` for generation | Return `missing_input` |
| Oversized prompt/input/cwd/previous command | Return `input_too_large` |
| HTTP non-2xx | Return summarized `HTTP <status>: <body prefix>` without secrets |
| Timeout | Return `Request timeout` |
| Response `Content-Length` or actual body exceeds the configured response body cap | Return `model_response_too_large` |
| Multi-line or very long generated command | Treat as no command and let frontend fall back |
| AI result does not start with the current input or adds a dangerous suffix | Treat as no command and keep/fall back to local suggestions |
| Debug Mode disabled | Do not write LLM prediction diagnostics |
| Debug Mode enabled | Write only sanitized LLM prediction diagnostics to the local app log |

### 5. Good/Base/Bad Cases

- Good: Chat Completions or Responses returns `{"command":"git status"}` for input `git s`; frontend shows only `tatus`.
- Good: local history returns `git status` immediately for `git s`; a later valid AI result for the same still-current input may replace the ghost suffix.
- Base: model is slow but succeeds; settings test reports degraded and terminal suggestions keep local suggestions visible while the input-time request is pending.
- Base: debug mode is enabled; logs show timing/status/counts for model test and generation, plus frontend fallback reason, without command text or secrets.
- Bad: model returns `rm -rf .\ngit status`, `git status && rm -rf .`, or a command that does not start with current input; backend/frontend reject it and local suggestions remain available.
- Bad: debug logs contain API keys, full prompt, full command input, history/template command text, or raw provider response body.

### 6. Tests Required

- Rust unit tests:
  - endpoint URL builder avoids duplicate `/v1`.
  - JSON command content is parsed.
  - Responses `output[].content[].text` command content is parsed.
  - multi-line commands are rejected.
- Frontend checks:
  - `npx tsc --noEmit`.
  - LLM-disabled path still returns local history/template/built-in suggestions.
  - LLM-enabled path renders local suggestions first and rejects stale async LLM responses when input changes.
  - LLM context redaction drops or masks secrets before invoking `command_suggestion_generate`.
  - Stale async LLM responses do not overwrite suggestions for newer input.
- Backend checks:
  - `cd src-tauri && cargo check`.
  - `cd src-tauri && cargo test command_suggestion`.
  - Response body cap rejects oversized responses before JSON parsing.
  - Debug log endpoint labels remove URL userinfo, query, and fragment before writing diagnostics.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Sends model output straight into the terminal or trusts any returned text.
forwardTerminalInput(modelCommand, "onData");
```

#### Correct

```typescript
const suffix = getSafeSuggestionSuffix(currentInput, modelCommand);
if (suffix) {
  showGhostSuffix(suffix);
}
```

Keep LLM completion as a suggestion source only; the PTY write path is reached only after explicit user acceptance.
