# cross-platform-hook-binary

## Goal

让 CLI-Manager 的「通知 hook」安装在 Windows / macOS / Linux / WSL(best-effort) 上都能工作。当前 hook 以 PowerShell `.ps1` 脚本形式安装，注册命令为 `powershell -File ...`，只能在 Windows 运行。本任务用 App 自身二进制的隐藏子命令 `__hook` 替代脚本，彻底去除 PowerShell 依赖，做到一次实现、跨平台通吃。

## What I already know

* 整条通知链路里唯一被 Windows 锁死的只有「hook 脚本 + 注册命令串」：
  * 通知服务 `src-tauri/src/claude_hook.rs`：纯 Rust，监听 `127.0.0.1:port`，Bearer token 鉴权，已跨平台。
  * 环境注入 `claude_hook.rs::apply_env`：往 PTY 注入 `CLI_MANAGER_TAB_ID/NOTIFY_PORT/NOTIFY_TOKEN`，已跨平台。
  * `src-tauri/src/commands/hook_settings.rs`：写 4 个 `.ps1` 脚本，`build_command` 生成 `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<script>" -Event <E>`。← 仅 Windows。
* 脚本逻辑极简：读 3 个 env → 读 stdin JSON → 抽 message/prompt/notification/reason/session_id → 拼 payload(tabId/source/event/title/message/sessionId/cwd/timestamp) → 带 token POST 到 `/api/claude-hook`。
* `src-tauri/Cargo.toml` 已有 `reqwest 0.12`（仅 async 特性，无 blocking）。hook 客户端用裸 TCP POST 即可，零运行时、零新依赖，与 `claude_hook.rs` 写裸 HTTP 的风格一致。
* `src-tauri/src/main.rs` 入口仅 `cli_manager_lib::run()`；`lib.rs::run()` 在 setup 里 `app.manage(ClaudeHookBridge::start(...))`。可在 `main()` 中于 `run()` 之前拦截 `__hook` 参数，走纯 Rust 早退分支，绝不初始化 Tauri runtime / WebView。
* 前端 `src/components/settings/pages/HookSettingsPage.tsx` 消费状态字段 `attentionScriptInstalled`/`finishedScriptInstalled`（行 16-17、363-370），与各 event hook 安装位做 `&&`。
* 事件白名单（`claude_hook.rs::is_valid_payload`）：claude = SessionStart/UserPromptSubmit/Notification/Stop/StopFailure；codex = SessionStart/UserPromptSubmit/PermissionRequest/Stop。服务端无需改动。
* 已存在相邻任务 `06-18-fix-hooks-env-for-git-bash-wsl`：只修「env 注入开关」，明确把「重写 hook 安装脚本 / 原生 WSL 支持」列为 Out of Scope。本任务正是补上它划走的那块。

## Requirements

* 新增隐藏子命令 `<app-binary> __hook --source <claude|codex> --event <Event>`：纯 Rust 实现脚本原有全部逻辑（读 env、读 stdin JSON、拼 payload、带 token POST、缺变量/出错静默 exit 0）。
* `main.rs` 在 `run()` 之前拦截 `__hook`，执行后立即退出，不触碰 Tauri runtime。
* `build_command` 改为指向 `std::env::current_exe()` + `__hook` 参数，按平台正确加引号；删除 4 个 `*_SCRIPT` 常量与写脚本/删脚本逻辑。
* 安装/卸载/状态检测改为只围绕「注册命令」判定，不再依赖脚本文件存在性。
* 卸载识别标志改用 `__hook` 关键字（旧版按脚本名识别的逻辑要保留兼容，能清掉历史 `.ps1` 注册项）。
* 保留 `attentionScriptInstalled`/`finishedScriptInstalled` 字段（值改为「二进制可解析即 true」），使前端零改动、IPC 契约稳定。
* WSL2（CLI 跑在 Linux 内）标记为 best-effort，限制写进文档/最终说明，不在代码里假装原生支持。

## Acceptance Criteria

* [ ] Windows 安装后，`settings.json`/`hooks.json` 注册命令指向 `CLI-Manager.exe __hook ...`，不再有 `.ps1` 与 `powershell`。
* [ ] 触发 SessionStart/UserPromptSubmit/Notification/Stop/StopFailure（codex 对应集）能正常 POST 到本地服务并被前端收到。
* [ ] 缺少任一 `CLI_MANAGER_*` env 时，`__hook` 静默 `exit 0`，不输出噪声、不报错。
* [ ] 重装能清理旧版 `.ps1` 注册项（升级即覆盖），卸载能清掉新版 `__hook` 注册项。
* [ ] 旧 `.ps1` 脚本文件在卸载/重装时被清理（若存在）。
* [ ] 前端 HookSettingsPage 状态显示正确，无需改动其逻辑即通过。
* [ ] `npx tsc --noEmit` 与 `cd src-tauri && cargo check`、`cargo test` 通过。
* [ ] 最终回复给出 Windows / Git Bash / WSL 的人工验证说明与 WSL 限制声明。

## Definition of Done

* 最小改动，无新依赖（裸 TCP POST，不启用 reqwest blocking）。
* Tauri command 对外契约保持稳定（字段不删，仅语义微调）。
* `npx tsc --noEmit` 与 `cargo check` / `cargo test` 已执行。
* WSL 限制在最终说明中明确记录。
* 现有 `hook_settings.rs` 的单测同步更新（脚本文件断言改为命令断言）。

## Technical Approach

把「可移植性缺口」收口到 Rust：

1. **hook 客户端（新增 `src-tauri/src/hook_client.rs` 或并入 `claude_hook.rs`）**
   `pub fn run_and_exit(source: &str, event: &str) -> !`：读 3 个 env（缺则 exit 0）→ 读 stdin 全量 → `serde_json` 解析（失败则当空）→ 按 source/event 取 message 字段 → 组 payload → 裸 TCP 连 `127.0.0.1:port`，写一条带 `Authorization: Bearer` 的 POST（2s 超时）→ 无论结果 exit 0。

2. **入口拦截（`main.rs`）**
   解析 `std::env::args()`，命中 `__hook` 则调用 `cli_manager_lib::hook_client::run_and_exit(source, event)`，否则照常 `run()`。`lib.rs` 暴露 `pub mod hook_client;`。

3. **安装层（`hook_settings.rs`）**
   * 删 `*_SCRIPT` 常量、脚本名常量改为内部标志/或保留用于清理旧文件。
   * `build_command(event, source)` → `format!("\"{exe}\" __hook --source {source} --event {event}")`，`exe = env::current_exe()`。
   * 安装：不再写脚本，只注册命令；先按 `.ps1` 旧标志清历史项，再注册新命令。
   * 卸载：清新命令 + 删旧 `.ps1` 文件（若有）。
   * `is_cli_manager_command`：同时识别 `__hook`（新）与旧脚本名（兼容）。
   * 状态：`*_script_installed` 改为「`current_exe` 可取得即 true」。

## Decision (ADR-lite)

**Context**：跨平台只缺「脚本语言 + 注册命令」一环；再写一套 `.sh` 必依赖 `jq`/`python` 做 JSON 转义，精简 Linux/容器不保证存在，脆弱。

**Decision**：用 App 自身二进制的隐藏 `__hook` 子命令替代所有脚本，逻辑全部落到 Rust。

**Consequences**：一次实现跨平台、零外部运行时依赖；代价是 hook 触发要冷启动二进制，故必须保证早退分支不初始化 Tauri runtime。Git Bash/MSYS（Windows 上）直接可用；WSL2 内原生场景需 interop 调 `.exe` + WSLENV 转发 + mirrored networking，列 best-effort。

## Out of Scope

* 原生 Linux/WSL 内独立二进制分发与自动探测。
* WSLENV 转发、mirrored networking 的自动配置（仅文档说明）。
* shell runtime OSC 注入（归属 `06-18-fix-hooks-env-for-git-bash-wsl`）。
* 通知服务端协议 / 事件白名单变更。

## Technical Notes

* 关键文件：`src-tauri/src/main.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/claude_hook.rs`、`src-tauri/src/commands/hook_settings.rs`、`src/components/settings/pages/HookSettingsPage.tsx`。
* `hook_settings.rs` 现有单测（行 1100+）断言脚本文件存在，需改为断言注册命令含 `__hook`。
* 裸 TCP POST 可直接复用 `claude_hook.rs::write_response` 同款手写 HTTP 思路。
* 平台引号：Windows 与 *nix 都用双引号包裹 exe 路径即可；macOS 路径可能含空格（.app bundle），务必引号。
