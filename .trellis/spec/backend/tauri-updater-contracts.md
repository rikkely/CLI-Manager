# Tauri Updater Contracts

> Executable contracts for CLI-Manager's Tauri 2 auto-update pipeline across React, Tauri config/capabilities, GitHub Actions release artifacts, and installer restart UX.

---

## Scenario: Official Tauri updater release and install flow

### 1. Scope / Trigger

- Trigger: changes touching update checks, update downloads/install, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, updater/process plugins, or release workflow signing env.
- This is a cross-layer contract because the frontend calls Tauri plugin APIs, the WebView capability grants updater/restart permissions, Tauri config defines signed update endpoints, and GitHub Actions must publish matching `latest.json` / signature artifacts.
- Do not use the GitHub Releases REST API as the actual auto-update mechanism. GitHub Releases may only be used as a manual fallback link.

### 2. Signatures

Frontend update store surface:

```ts
interface UpdateState {
  currentVersion: string | null;
  checking: boolean;
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  pendingUpdate: Update | null;
  downloading: boolean;
  downloadProgress: number;
  downloadTotalBytes: number | null;
  downloadedBytes: number;
  readyToInstall: boolean;
  installing: boolean;
  lastCheckedAt: string | null;
  error: string | null;
  releaseFallbackUrl: string;
  fetchVersion(): Promise<void>;
  checkUpdate(options?: { silent?: boolean }): Promise<UpdateInfo | null>;
  downloadUpdate(): Promise<boolean>;
  installAndRelaunch(): Promise<void>;
  reset(): void;
}
```

Tauri updater APIs used by frontend:

```ts
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const update = await check();
await update.download((event) => { /* progress */ });
await update.install();
await relaunch();
```

Rust plugin registration:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

### 3. Contracts

#### Tauri config

`src-tauri/tauri.conf.json` must include:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<Tauri updater public key content>",
      "endpoints": ["https://github.com/dark-hxx/CLI-Manager/releases/latest/download/latest.json"],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

- `pubkey` is public and may be committed.
- The matching private key must never be committed.
- Production endpoints must be HTTPS.
- Windows updater asset strategy is default/MSI; do not set `updaterJsonPreferNsis` unless the installer strategy is intentionally changed.

#### Capability / permissions

`src-tauri/capabilities/default.json` must grant only:

```json
"updater:default",
"process:allow-restart"
```

- Do not grant `process:default` for updater UI.
- Do not add file-system permissions for updater downloads; Tauri updater owns that flow.

#### Release workflow env

`.github/workflows/release.yml` must pass secrets to `tauri-apps/tauri-action`:

```yaml
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
with:
  includeUpdaterJson: true
```

- `TAURI_SIGNING_PRIVATE_KEY` is required for releases that should auto-update.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional and required only when the signing key was generated with a password.
- The first version that includes updater support still requires manual installation; earlier releases without `latest.json` / `.sig` cannot be consumed by the official updater.

#### UX behavior

- Startup update check may run silently after startup readiness; failures must not interrupt first screen or terminal restore.
- Manual settings-page check may surface errors and retry actions.
- Download starts only after user clicks the download action.
- Install/relaunch requires explicit confirmation.
- If terminal sessions are active, the confirmation must show the active count and warn that tasks may be interrupted; the user may still confirm.
- Keep a Release-page fallback link for manifest/signature/network failures.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| No update available | `checkUpdate` returns `null`, sets `lastCheckedAt`, clears stale update state. |
| Startup check fails | No toast/error interruption; current app continues normally. |
| Manual check fails | Show a stable, understandable error with retry and Release fallback. |
| `latest.json` missing or invalid | Treat as update-check failure; do not claim no update. |
| Signature validation fails | Treat as updater failure; do not install; keep Release fallback. |
| Download progress has `contentLength` | Show percentage and byte progress. |
| Download progress lacks total length | Show indeterminate/downloading state, not `NaN`. |
| Download fails midway | Keep current app usable; allow retry or reset. |
| Download finished | Set `readyToInstall`; do not install automatically. |
| Active terminal count > 0 | Show strong warning with count before install/relaunch. |
| User confirms install | Call `install()` then `relaunch()` only after confirmation. |
| User chooses later | Keep downloaded/pending state when safe; do not close resources during active download/install. |

### 5. Good/Base/Bad Cases

- Good: release workflow publishes signed updater artifacts; app startup silently detects a new version; settings page displays notes; user downloads; active terminal warning appears; user confirms install/relaunch.
- Base: GitHub latest release lacks updater JSON; manual check shows failure and the Release fallback link, while terminal sessions continue unaffected.
- Bad: checking `https://api.github.com/repos/.../releases/latest` and manually comparing `tag_name` for the auto-update path bypasses Tauri's signed updater contract.
- Bad: granting `process:default` just to relaunch the app expands permissions beyond the updater UI need.

### 6. Tests Required

- TypeScript checks:
  - `checkUpdate({ silent: true })` must not set user-visible `error` on failure.
  - Progress math must handle unknown `contentLength` without `NaN`.
  - `reset()` must close pending updater resources only when not downloading/installing.
- UI checks:
  - Settings page renders no-update, checking, update-available, downloading, ready-to-install, installing, and error states.
  - Active terminal warning includes the count when at least one non-exited/non-error terminal exists.
  - Install action is unavailable until download is finished and confirmation is visible.
- Backend/config checks:
  - `src-tauri/tauri.conf.json` parses and includes `bundle.createUpdaterArtifacts` plus updater endpoint/pubkey.
  - `src-tauri/capabilities/default.json` includes `updater:default` and `process:allow-restart`, not `process:default`.
  - `cargo check --manifest-path src-tauri/Cargo.toml` passes after plugin changes.
- Release checks:
  - GitHub Actions release has `TAURI_SIGNING_PRIVATE_KEY` available.
  - Published release includes `latest.json` and signature-backed updater artifacts.

### 7. Wrong vs Correct

#### Wrong

```ts
const response = await fetch("https://api.github.com/repos/dark-hxx/CLI-Manager/releases/latest");
const latestVersion = (await response.json()).tag_name;
```

This can notify users, but it is not a signed installable update path.

#### Correct

```ts
const update = await check();
if (update) {
  await update.download(onDownloadEvent);
  await update.install();
  await relaunch();
}
```

#### Wrong

```json
"permissions": ["updater:default", "process:default"]
```

#### Correct

```json
"permissions": ["updater:default", "process:allow-restart"]
```
