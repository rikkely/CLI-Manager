# 实施计划

## Checklist

1. [x] 读取前后端 Trellis 规范与 Hook/通知相关代码。
2. [x] 跑 GitNexus impact 分析后再编辑目标函数/命令。（CLI 索引因本机 native 依赖失败，已用源码调用搜索补充手工影响面。）
3. [x] 抽出前端统一激活入口，复用应用内 toast 与系统通知 action。
4. [x] 增加后端窗口聚焦命令。
5. [x] 增加/调整系统通知发送命令，使通知点击能 emit 回前端。
6. [x] 更新 i18n 文案。
7. [x] 运行 `npx tsc --noEmit` 与 `cd src-tauri && cargo check`。

## Risky Files

- `src/App.tsx`
- `src-tauri/src/commands/system_notification.rs`
- `src-tauri/src/lib.rs`
- `src/lib/i18n.ts`
- `src-tauri/capabilities/default.json`
- `src-tauri/Cargo.toml`

## Validation

- `npx tsc --noEmit`
- `cd src-tauri && cargo check`

## Manual Verification Notes

- Windows：最小化 CLI-Manager，触发 PermissionRequest，点击系统通知，确认窗口前置并激活对应 tab。
- 已关闭 tab：触发通知后关闭 tab，再点击通知，确认窗口前置并提示目标终端已关闭。
- macOS/Linux：确认平台不支持 action 时不报错，应用内 toast 与系统通知展示仍正常。
