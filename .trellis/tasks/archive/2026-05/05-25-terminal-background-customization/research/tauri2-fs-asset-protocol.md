# Research: Tauri 2 — Safely Loading a User-Selected Local Image into the WebView

- **Query**: How to load a user-selected local image into the Tauri 2 WebView for `<img>` / `background-image`, scoped strictly to `$APPLOCALDATA/backgrounds/**`.
- **Scope**: mixed (internal evidence + external Tauri 2 API knowledge)
- **Date**: 2026-05-25
- **Task dir**: `.trellis/tasks/05-25-terminal-background-customization/`

## Evidence from this repo

| File | Relevant line | Note |
|---|---|---|
| `src-tauri/Cargo.toml` | l.20-39 | `tauri = "2"` with `tray-icon`. `tauri-plugin-dialog = "2"` is present. **`tauri-plugin-fs` is NOT a direct dependency.** |
| `src-tauri/Cargo.lock` | `name = "tauri-plugin-fs" / version = "2.4.5"` | Already present as a *transitive* dep (pulled by `tauri-plugin-dialog`). It is NOT initialized in `lib.rs`, so its commands/capabilities are inert today. |
| `src-tauri/src/lib.rs` | l.240-249 | Plugins initialized: `dialog`, `shell`, `store`, `sql`, `opener`, `log`. No `tauri_plugin_fs::init()`. |
| `src-tauri/tauri.conf.json` | l.23-25 | `app.security.csp = null` (i.e. CSP disabled). No `assetProtocol` block configured. |
| `src-tauri/capabilities/default.json` | full file | No `fs:*` permissions; no `core:asset` etc. |
| `src-tauri/src/commands/fs.rs` | full file | Only one command (`check_paths_exist`); no read/write/copy helpers. |

Implication: to ship the background-image feature you must (a) enable the asset protocol scope in `tauri.conf.json`, (b) opt into `tauri-plugin-fs` permissions in the capability file (and likely declare it as a direct dep so its build script wires up `core:fs` cleanly), and (c) add a small Rust command that copies the picked file into `$APPLOCALDATA/backgrounds/<hash>.<ext>`.

## 1. Loading a local file in the WebView — `convertFileSrc` + asset protocol

Tauri 2 exposes local files to the WebView through a custom URL scheme served by the Rust core. The scheme name is **`asset`** on macOS/Linux and is rewritten to **`http://asset.localhost/<encoded>`** on Windows (the WebView2 stack cannot register custom schemes directly, so Tauri uses a localhost domain instead). The JS helper that produces the right URL on every platform is **`convertFileSrc`**.

```ts
// src/lib/assetUrl.ts
import { convertFileSrc } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';

export async function backgroundImageUrl(relPath: string): Promise<string> {
  // relPath e.g. "backgrounds/abc.jpg"
  const base = await appLocalDataDir();          // e.g. C:\Users\X\AppData\Local\com.cli-manager.app
  const abs = await join(base, relPath);          // C:\...\backgrounds\abc.jpg
  return convertFileSrc(abs);                     // http://asset.localhost/<urlencoded-abs-path> on Windows
                                                  // asset://localhost/<urlencoded-abs-path> on macOS/Linux
}
```

Usage in React / CSS:

```tsx
const url = await backgroundImageUrl('backgrounds/abc.jpg');
<div style={{ backgroundImage: `url("${url}")` }} />
// or: <img src={url} />
```

**Required config — enable the asset protocol scope** in `src-tauri/tauri.conf.json` (the WebView will reject the URL unless the path matches the scope):

```jsonc
{
  "app": {
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": {
          // Only allow files under $APPLOCALDATA/backgrounds/**
          "allow": ["$APPLOCALDATA/backgrounds/**"],
          "deny": []
        }
      }
    }
  }
}
```

Notes on the scope DSL:

- `$APPLOCALDATA` (and its siblings `$APPDATA`, `$APPCONFIG`, `$APPCACHE`, `$RESOURCE`, `$HOME`, `$TEMP`, `$DOCUMENT`, `$DOWNLOAD`, `$PICTURE`, `$VIDEO`, `$AUDIO`, `$DESKTOP`, `$DESKTOP`, `$EXE`, `$LOG`) are predefined path variables that Tauri resolves at runtime per OS.
- `**` matches any depth, `*` matches a single path segment. Glob is rooted at the variable.
- The scope is enforced inside the Rust process before the file is read — front-end manipulation cannot bypass it.

`assetProtocol.enable` is a separate switch from `tauri-plugin-fs`. You can have the asset protocol enabled for *reading* through `<img>`/CSS without ever calling fs JS APIs.

## 2. `tauri-plugin-fs` capability scoped to `$APPLOCALDATA/backgrounds/**`

`tauri-plugin-fs` is the canonical 2.x crate name (confirmed at `crates.io/tauri-plugin-fs` v2.x; Cargo.lock shows 2.4.5 already pulled). Its permission set is referenced from capability files as `fs:<permission-id>`.

**Make it a direct dependency** in `src-tauri/Cargo.toml`:

```toml
tauri-plugin-fs = "2"
```

**Register the plugin** in `src-tauri/src/lib.rs` (one line, after `dialog`):

```rust
.plugin(tauri_plugin_fs::init())
```

**Capability snippet** for `src-tauri/capabilities/default.json` — read+write only inside `$APPLOCALDATA/backgrounds/**`, nothing else:

```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-is-maximized",
    "core:window:allow-unmaximize",
    "core:window:allow-set-min-size",
    "core:window:allow-set-size",
    "core:window:allow-start-dragging",
    "opener:default",
    "sql:default",
    "sql:allow-execute",
    "sql:allow-select",
    "store:default",
    "log:default",
    "shell:default",
    "dialog:default",

    "fs:allow-app-local-data-read-recursive",
    "fs:allow-app-local-data-write-recursive",
    {
      "identifier": "fs:scope",
      "allow": [
        { "path": "$APPLOCALDATA/backgrounds" },
        { "path": "$APPLOCALDATA/backgrounds/**" }
      ],
      "deny": []
    }
  ]
}
```

Why this shape:

- `fs:allow-app-local-data-read-recursive` / `fs:allow-app-local-data-write-recursive` are the *coarse* per-directory permissions shipped by the plugin. They gate the **set of commands** (read_file, write_file, read_dir, mkdir, remove, …) when the target lies inside `$APPLOCALDATA`.
- The inline `fs:scope` permission *narrows* the allowed paths to the `backgrounds` subtree only. Without it, those `…-recursive` permissions would expose the whole `$APPLOCALDATA` directory to the WebView. **Both pieces are required**: command-level permission AND path scope.
- Do NOT add `fs:default` — that opens the JS bindings broadly. Stick to the explicit, narrow permissions above.
- `core:asset:default` is unrelated to `tauri-plugin-fs`; the asset protocol's allow/deny is configured in `tauri.conf.json` (see §1), not in capabilities.

If you decide *not* to expose any fs JS API to the front-end and instead do all I/O in a Rust command (recommended for this feature, see §3), you can omit the `fs:*` permissions entirely. The Rust side does not require capabilities — capabilities only gate `invoke('plugin:fs|…')` from the WebView. **Reading the file through `<img src="http://asset.localhost/…">` only needs the `assetProtocol` scope from §1, not `fs:*`.**

## 3. Minimal Rust command: copy a picked file into `$APPLOCALDATA/backgrounds/<hash>.<ext>`

This pattern keeps the privileged file I/O on the Rust side. The front-end uses `tauri-plugin-dialog` to pick a file, then invokes one command that validates, hashes, copies, and returns a relative path (the front-end converts that to an asset URL with `convertFileSrc`).

```rust
// src-tauri/src/commands/background.rs
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const ALLOWED_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const MAX_BYTES: u64 = 20 * 1024 * 1024; // 20 MiB cap

#[tauri::command]
pub async fn save_background_image(
    app: AppHandle,
    source_path: String,
) -> Result<String, String> {
    // 1. Validate the incoming string as a real, existing file.
    let src = PathBuf::from(&source_path);
    if !src.is_absolute() {
        return Err("source_path must be absolute".into());
    }
    let meta = tokio::fs::metadata(&src)
        .await
        .map_err(|e| format!("stat failed: {e}"))?;
    if !meta.is_file() {
        return Err("source is not a regular file".into());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("image exceeds {} bytes", MAX_BYTES));
    }

    // 2. Whitelist extension.
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .ok_or_else(|| "missing extension".to_string())?;
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!("unsupported extension: {ext}"));
    }

    // 3. Resolve $APPLOCALDATA/backgrounds and ensure it exists.
    let base: PathBuf = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir: {e}"))?;
    let bg_dir = base.join("backgrounds");
    tokio::fs::create_dir_all(&bg_dir)
        .await
        .map_err(|e| format!("mkdir failed: {e}"))?;

    // 4. Hash file contents -> stable, dedup-friendly name.
    let bytes = tokio::fs::read(&src)
        .await
        .map_err(|e| format!("read failed: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = hex_short(&hasher.finalize());
    let file_name = format!("{hash}.{ext}");
    let dest = bg_dir.join(&file_name);

    // 5. Defence in depth: confirm dest stays inside bg_dir.
    let canon_dest = canonical_or_self(&dest);
    let canon_base = canonical_or_self(&bg_dir);
    if !canon_dest.starts_with(&canon_base) {
        return Err("path escapes backgrounds directory".into());
    }

    // 6. Write (idempotent: same content -> same hash -> no-op overwrite).
    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("write failed: {e}"))?;

    // 7. Return the relative path the front-end stores in settings.
    //    Front-end will combine with appLocalDataDir() + convertFileSrc().
    Ok(format!("backgrounds/{file_name}"))
}

fn hex_short(digest: &[u8]) -> String {
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn canonical_or_self(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}
```

Wire-up in `src-tauri/src/lib.rs`:

```rust
mod commands; // already exists
// add: pub mod background; inside src-tauri/src/commands/mod.rs

// inside invoke_handler!
commands::background::save_background_image,
```

Front-end usage:

```ts
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const picked = await open({
  multiple: false,
  filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
});
if (typeof picked === 'string') {
  const rel: string = await invoke('save_background_image', { sourcePath: picked });
  // rel === "backgrounds/<hash>.<ext>"
  // store rel in settings; build asset URL on demand
}
```

Crates: `sha2 = "0.10"` is already in `Cargo.toml` (l.36), so no new dependency.

## 4. CSP considerations for `asset://` / `http://asset.localhost/...`

Current state: `app.security.csp = null` in `tauri.conf.json` (l.24). That means the WebView is shipped with **no** Content-Security-Policy, so any URL — including the asset protocol — loads without CSP-side restrictions. Nothing extra is needed *today*.

If/when a CSP is added (recommended at some point), the `img-src` (and `style-src` if used as `background-image`) directives must include the asset endpoints:

```jsonc
// tauri.conf.json
"security": {
  "csp": {
    "default-src": "'self'",
    "img-src": "'self' asset: http://asset.localhost",
    "style-src": "'self' 'unsafe-inline'",
    "connect-src": "'self' ipc: http://ipc.localhost"
  },
  "assetProtocol": { "enable": true, "scope": { "allow": ["$APPLOCALDATA/backgrounds/**"] } }
}
```

Key points:

- Tauri 2 will automatically rewrite the `IPC` and `asset` directives if they contain placeholder strings (`asset:`, `ipc:`) when the config is parsed, but explicitly listing both schemes (`asset:` for macOS/Linux, `http://asset.localhost` for Windows) is safe and self-documenting.
- The asset protocol's path scope (`assetProtocol.scope.allow`) is enforced *inside* Tauri before the bytes are streamed — even if CSP would otherwise allow the URL, a path outside the scope returns 403.
- Setting `csp: null` is acceptable for an internal tool but it disables browser-side defence-in-depth. Treat that as a separate hardening task; it does not block the background-image feature.

## 5. `tauri-plugin-fs` 2.x dependency name

Confirmed. The crate is published on crates.io as **`tauri-plugin-fs`** (matches Cargo.lock evidence: `tauri-plugin-fs v2.4.5`). The matching JS binding is `@tauri-apps/plugin-fs` on npm. Both are versioned in lock-step with Tauri 2.x. Cargo.toml fragment:

```toml
[dependencies]
tauri-plugin-fs = "2"
```

And in `package.json` if you want the JS bindings (only needed when the WebView itself calls fs commands — for the design proposed in §3 you do **not** need them):

```jsonc
"@tauri-apps/plugin-fs": "^2"
```

## Decision summary (matches PRD §Technical Notes option B)

The cleanest path for this codebase:

1. Add `tauri-plugin-fs = "2"` as a *direct* dep and call `tauri_plugin_fs::init()` in `lib.rs` (gives the build system its types and lets capabilities resolve).
2. Skip exposing any `fs:*` JS commands; keep all file I/O inside the new Rust command `save_background_image`.
3. Turn on `assetProtocol.enable = true` with scope `"$APPLOCALDATA/backgrounds/**"` so the WebView can load the saved image via `convertFileSrc`.
4. Store only the relative path `backgrounds/<hash>.<ext>` in `settings.json` (small, portable, survives a re-install since `$APPLOCALDATA` is stable).
5. No CSP changes required while `csp: null`. If CSP is later tightened, add `img-src 'self' asset: http://asset.localhost` and the matching `style-src` entry.

## Caveats / Not Found

- I could not run a live web search in this session (no `mcp__exa_*` or browser tool was available in this agent's toolbelt), so the JSON keys, permission identifiers, and crate names above are sourced from my Tauri 2 knowledge and cross-checked against the repo's `Cargo.lock` (which pins `tauri-plugin-fs 2.4.5`). Before committing the capability JSON, please run `cargo check` once after adding the direct dep — the build script regenerates `gen/schemas/desktop-schema.json` and will surface any permission-id typos as a JSON-schema validation error.
- The `fs:allow-app-local-data-*-recursive` permission identifiers have been stable since `tauri-plugin-fs 2.0`, but the *exact* spelling of every variant is enumerated in the auto-generated `gen/schemas/desktop-schema.json` — that file is the source of truth in your local checkout.
- `app.security.assetProtocol` is the documented Tauri 2 config key. If a future minor renames it, `tauri build` will emit a config-validation error pointing at the new key.
- Windows-specific: `http://asset.localhost` is intercepted *inside* WebView2 by Tauri's request handler; nothing actually listens on TCP. Do not be confused by the `http://` scheme — it does not bypass Tauri's scope check.
