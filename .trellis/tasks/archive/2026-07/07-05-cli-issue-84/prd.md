# PRD: 项目维护支持 CLI 启动参数扩展

- **Issue**: https://github.com/dark-hxx/CLI-Manager/issues/84
- **Changelog Target**: V1.2.5

## 背景与问题

项目维护（ConfigModal）目前只有 `cli_tool`（claude / codex / 自定义）和 `startup_cmd`（整条自定义启动命令）两个字段，`--permission-mode bypassPermissions` 这类 CLI 附加参数没有地方维护：

- 塞进 `cli_tool` 会破坏 `isExactCodexProject`（要求严格等于 "codex"）、`getProviderSwitchAppType`、图标推断等按 cli_tool 匹配的逻辑；
- 塞进 `startup_cmd` 会整条覆盖 cli_tool 分支，丢失项目级供应商切换的自动追加参数（codex `--profile`、claude `--settings`）。

## 方案

新增独立字段 `cli_args`（自由文本，整串透传，不解析语义），仅在 cli_tool 分支生效：

最终命令 = `cli_tool` + `cli_args` + 自动追加的供应商覆盖参数。

- `startup_cmd` 语义不变：非空时整条覆盖，`cli_args` 不生效。
- **必须兼容项目级供应商切换**（用户明确要求）：拼接顺序为先拼 `cli_args`、再走现有 `hasProfileArg` / `hasClaudeSettingsArg` / `hasCodexThemeConfigArg` 对整条命令的检测追加——用户手写过 `--profile` / `--settings` / `-c theme=` 时不重复追加，三个检测函数本身不改。
- 多参数支持：单行文本框整串透传（如 `--permission-mode bypassPermissions --model opus`），由 shell/CLI 自行解析；带空格的值用户自行加引号，与 `startup_cmd` 现有模式一致，无新增风险面。
- 不做 per-CLI 预设参数勾选 UI（过度设计，参数随 CLI 版本变化）。

## 修改清单

| 文件 | 改动 |
|---|---|
| `src-tauri/src/lib.rs` | `migrations()` 追加 v12：`ALTER TABLE projects ADD COLUMN cli_args TEXT NOT NULL DEFAULT ''`（只增不改） |
| `src/lib/types.ts` | `Project` / `CreateProjectInput` / `UpdateProjectInput` 增加 `cli_args` |
| `src/stores/projectStore.ts` | create/update SQL 带上 `cli_args`，默认空串 |
| `src/lib/projectStartupCommand.ts` | `resolveProjectStartupCommand` cli_tool 分支：先拼 `cli_args` 再做供应商覆盖追加 |
| `src/components/ConfigModal.tsx` | 「CLI 工具」下方新增「CLI 启动参数」输入框，placeholder `--permission-mode bypassPermissions` |
| `src/stores/syncStore.ts` | WebDAV 同步项目字段清单加 `cli_args` |
| `CHANGELOG.md` | V1.2.5 记录本功能，关联 issue #84 |
| `docs/功能清单.md` | 产品功能变化，同步更新 |

## 验收标准

1. 项目编辑弹窗可维护 CLI 启动参数，保存/克隆/新增均生效。
2. cli_tool=claude + cli_args=`--permission-mode bypassPermissions` + 项目级供应商覆盖时，启动命令同时包含 `--permission-mode bypassPermissions` 与 `--settings "..."`。
3. cli_tool=codex + 供应商 profile 覆盖时，`--profile` 仍自动追加；用户在 cli_args 手写 `--profile x` 时不重复追加。
4. `startup_cmd` 非空时行为与现状完全一致（cli_args 不参与）。
5. 旧数据（无 cli_args）升级后行为不变；`npx tsc --noEmit` 与 `cd src-tauri && cargo check` 通过。

## 风险

- migration 只增不改，向后兼容；同步侧旧客户端忽略新字段，可接受。
- 外部终端（externalTerminal.ts）、CommandPalette 等调用 `resolveProjectStartupCommand` 的场景自动受益，无需单独改。
