# 让统计读取跟随自定义 Claude/Codex 安装目录

## Goal

当用户在 Hook 设置中修改 Claude 或 Codex 的配置/安装目录后，历史会话与分析看板读取数据时也使用对应目录，而不是继续读取默认的 `%USERPROFILE%/.claude` 或 `%USERPROFILE%/.codex`。

## What I already know

* Hook 设置页已经保存 `claudeHookConfigDir` 和 `codexHookConfigDir`。
* 默认值为 `null`，表示使用默认目录。
* Hook 后端安装/状态逻辑已经支持传入自定义 Claude/Codex 目录。
* 历史/统计后端当前仍硬编码读取：
  * Claude: `%USERPROFILE%/.claude/projects`
  * Codex: `%USERPROFILE%/.codex/sessions`
* 分析看板 `history_get_stats` 依赖历史索引 `refresh_history_index()`，历史列表、搜索、Prompt 列表也复用同一索引。

## Requirements

* 未设置自定义目录时，保持现有默认行为。
* 设置 Claude 自定义目录时，Claude 历史读取应使用 `<claudeHookConfigDir>/projects`。
* 设置 Codex 自定义目录时，Codex 历史读取应使用 `<codexHookConfigDir>/sessions`。
* 分析看板统计读取路径必须与 Hook 设置中的目录一致。
* 历史列表、搜索、会话详情、删除、Prompt 列表必须与分析看板使用同一历史根目录。
* 路径切换后缓存不能继续命中旧目录数据。

## Acceptance Criteria

* [ ] 默认设置下，历史列表和分析看板仍读取默认 Claude/Codex 目录。
* [ ] 修改 Claude hook 目录后，Claude 统计读取新目录下的 `projects`。
* [ ] 修改 Codex hook 目录后，Codex 统计读取新目录下的 `sessions`。
* [ ] 切换目录后不会展示旧目录缓存统计。
* [ ] 不扩大 Tauri command 权限面，只在现有 history 命令参数中传递受限路径。

## Definition of Done

* TypeScript 类型检查通过。
* Rust `cargo check` 通过。
* 相关路径解析逻辑尽量复用，不新增依赖。
* UI 行为可手动验证：修改 Hook 设置目录后刷新历史/看板。

## Technical Approach

把 Hook 设置中已有的 `claudeHookConfigDir` / `codexHookConfigDir` 从前端 history store 传给后端 history commands；Rust 侧统一解析历史根目录：Claude 使用 `<configDir>/projects`，Codex 使用 `<configDir>/sessions`，未传入则回落到默认 home 目录。

## Decision (ADR-lite)

**Context**: Hook 设置路径与历史统计读取路径目前是两套逻辑，导致用户改安装/配置位置后，统计仍读取旧默认位置。

**Decision**: 统一修复所有历史读取链路：历史列表、搜索、详情、删除、Prompt 列表和分析看板统计都使用同一套 Claude/Codex 目录解析逻辑。

**Consequences**: 改动会覆盖多个 history invoke 参数和后端函数签名，但能避免历史列表、搜索、详情、统计之间数据不一致。

## Out of Scope

* 不新增安装目录自动探测。
* 不修改 Hook 安装逻辑本身。
* 不新增新依赖。
* 不重构历史解析器。

## Technical Notes

* `src/components/settings/pages/HookSettingsPage.tsx`：Hook 设置页读写自定义目录。
* `src/stores/settingsStore.ts`：保存 `claudeHookConfigDir` / `codexHookConfigDir`。
* `src/stores/historyStore.ts`：调用 `history_list_sessions` / `history_get_stats` / `history_search` / `history_get_session` / `history_list_prompts`。
* `src-tauri/src/commands/history.rs`：当前硬编码历史根目录，并维护历史文件缓存与索引缓存。
* `src-tauri/src/commands/hook_settings.rs`：已有 Hook 目录解析模式，可参考但不需要改动。
