# WebDAV Sync Contracts

## Scenario: WebDAV sync payload boundaries

### 1. Scope / Trigger

- Trigger: code changes that touch `src-tauri/src/sync/mod.rs` or `src-tauri/src/webdav/mod.rs` upload/download behavior.
- Scope: preserve sync JSON bytes and public Tauri command behavior while controlling CPU/memory cost at WebDAV boundaries.

### 2. Signatures

- `sync::upload(config: WebDavConfig, data: SyncData) -> Result<(), String>`
- `sync::download(config: WebDavConfig) -> Result<SyncData, String>`
- `WebDavClient::upload(&self, remote_path: &str, data: Vec<u8>) -> Result<(), WebDavError>`
- `WebDavClient::download(&self, remote_path: &str) -> Result<Vec<u8>, WebDavError>`

### 3. Contracts

- Remote path for sync data: `cli-manager-sync/sync.json`.
- Upload request body: UTF-8 JSON bytes serialized from `SyncData`.
- Upload `Content-Type`: `application/json`.
- Download response body: UTF-8 JSON bytes parsed into `SyncData`.
- Maximum successful WebDAV response body handled by `handle_response`: `16 * 1024 * 1024` bytes.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| HTTP status is not success | `Err(WebDavError { message: "HTTP error: <status>", status_code: Some(status) })` |
| `Content-Length` exists and exceeds 16 MiB | `Err(WebDavError { message: "Response too large: <len> bytes", status_code: Some(status) })` |
| No `Content-Length`, but actual body exceeds 16 MiB after read | `Err(WebDavError { message: "Response too large: <len> bytes", status_code: Some(status) })` |
| Body read fails | `Err(WebDavError { message: "Failed to read response: <err>", status_code: None })` |
| Downloaded JSON parse fails | `Err("Failed to parse sync data: <err>")` |

### 5. Good/Base/Bad Cases

- Good: upload serializes with `serde_json::to_vec(&data)` and sends those bytes directly.
- Base: download with a valid small `sync.json` parses into the same `SyncData` shape used by local import/export.
- Bad: do not serialize upload via `serde_json::to_string(&data).into_bytes()` because it creates an avoidable large intermediate `String`.
- Bad: do not trust missing `Content-Length`; still check actual bytes read before returning success.

### 6. Tests Required

- `cd src-tauri && cargo check` must pass after sync/WebDAV changes.
- For behavior tests or manual checks, assert:
  - valid sync JSON round-trips through upload/download unchanged at the data-model level;
  - non-success HTTP status returns `HTTP error: <status>`;
  - responses over 16 MiB are rejected both with and without `Content-Length`.

### 7. Wrong vs Correct

#### Wrong

```rust
let json = serde_json::to_string(&data)?;
client.upload(SYNC_FILE_PATH, json.into_bytes()).await?;
```

#### Correct

```rust
let json = serde_json::to_vec(&data)?;
client.upload(SYNC_FILE_PATH, json).await?;
```

#### Wrong

```rust
if response.content_length().is_some_and(|len| len > MAX_RESPONSE_BYTES) {
    return Err(...);
}
Ok(response.bytes().await?.to_vec())
```

#### Correct

```rust
if let Some(len) = response.content_length() {
    if len > MAX_RESPONSE_BYTES {
        return Err(...);
    }
}
let bytes = response.bytes().await?;
if bytes.len() > MAX_RESPONSE_BYTES as usize {
    return Err(...);
}
Ok(bytes.to_vec())
```
