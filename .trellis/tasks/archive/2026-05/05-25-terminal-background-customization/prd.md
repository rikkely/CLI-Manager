# 终端背景与外观自定义

> 状态：brainstorm 阶段 final draft，待用户确认。

## Goal

在内置终端（xterm.js）中支持用户设置自定义背景图片以及配套外观参数（透明度、适配模式、位置对齐、模糊、暗化覆盖），提升终端可视个性化。设置全局生效，单个会话可右键临时隐藏。

## Requirements

### 功能（MVP C 完整方案 + 增强）

- **R1 启用开关**：「启用终端背景图」全局开关，关闭时回到当前主题纯色背景。
- **R2 选择图片**：通过文件选择对话框选取本地图片，复制到 `appLocalData/backgrounds/<sha256>.<ext>`。
  - 支持格式：JPEG、PNG、GIF（动画）。**不支持 WEBP**。
  - 文件大小不限制；超过 5MB 在 UI 提示「可能影响启动速度」但仍允许。
- **R3 透明度**：滑块控制图片透明度，范围 0%–100%，默认 50%。
- **R4 适配模式**：下拉选择 `cover` / `contain` / `center` / `tile`，默认 `cover`。
- **R5 位置对齐**：9 宫格选择（左上 / 中上 / 右上 / 左中 / 居中 / 右中 / 左下 / 中下 / 右下），默认 `居中`。
- **R6 高斯模糊**：滑块控制 0px–20px，默认 0px。
- **R7 暗化覆盖**：滑块控制黑色蒙层 0%–80%，默认 30%。提升文字可读性。
- **R8 会话覆盖**：终端 Tab 右键菜单增加「隐藏背景」/「显示背景」，仅当前会话生效；该状态不持久化，会话关闭即丢失。
- **R9 平滑切换动效**：图片切换 / 启用 / 关闭时 300ms 淡入淡出。

### 行为

- **R10 实时预览**：所有滑块拖动时实时反映到所有活跃终端。
- **R11 配置入口**：在「设置 → 主题」页底部增加「终端背景」区块（沿用 `ui-surface-card` 视觉规范）。
- **R12 缺失图片容错**：启动时若 `appLocalData/backgrounds/<file>` 不存在（外部清理），背景悄悄回退到无图，UI 在设置页给出提示，不阻断终端使用。
- **R13 设置持久化**：所有参数（除 R8 会话覆盖外）写入 `settings.json`，跨会话/重启保留。

### 非功能

- **NFR1 安全边界**：`assetProtocol.scope` 锁定 `$APPLOCALDATA/backgrounds/**`，禁止读其他路径。
- **NFR2 性能**：xterm 启用 `allowTransparency` 后的渲染性能损失可接受（≤10% FPS 下降），保留 WebglAddon GPU 加速。
- **NFR3 类型/Lint**：`npx tsc --noEmit` 通过；Rust 端 `cargo check` 通过。

## Acceptance Criteria

- [ ] AC1：从未配置背景的状态启动应用 → 终端显示纯色（与现状一致）
- [ ] AC2：点击「启用背景图」+ 选择一张本地 JPEG → 终端立刻显示该图，透明度/适配/位置/模糊/暗化默认值生效
- [ ] AC3：拖动透明度滑块 → 所有活跃终端同步反映新透明度，无明显延迟
- [ ] AC4：切换适配模式（cover ↔ tile）→ 背景渲染立即更新
- [ ] AC5：9 宫格点击「左上」→ 图片对齐左上
- [ ] AC6：模糊从 0 拖到 10px → 图片明显模糊，xterm 字符仍清晰
- [ ] AC7：暗化从 0 到 50% → 字符可读性提升，xterm 主题前景色不变
- [ ] AC8：选择一张 GIF → 终端背景为动画（无明显卡顿）
- [ ] AC9：选择一张 8MB JPEG → UI 提示「可能影响启动速度」但仍允许保存
- [ ] AC10：选择 WEBP / BMP → UI 拒绝并给出格式错误提示
- [ ] AC11：终端 Tab 右键「隐藏背景」→ 仅当前 Tab 背景隐藏；切到其他 Tab 仍显示
- [ ] AC12：关闭并重新打开应用 → 全局配置恢复；会话覆盖被清空
- [ ] AC13：人为删除 `appLocalData/backgrounds/<file>` 后启动 → 终端回退无图，设置页提示「图片已丢失，请重选」
- [ ] AC14：尝试通过 `convertFileSrc("C:/Windows/system32/notepad.exe")` 加载 → 被 asset scope 拒绝（返回 404）
- [ ] AC15：背景图启用 → WebglAddon 仍正常加载（不回退 Canvas），日志无 GL 错误
- [ ] AC16：背景图切换 → 观察到 300ms 淡入淡出动效

## Definition of Done

- 所有 AC 通过
- `npx tsc --noEmit` 通过
- `cd src-tauri && cargo check` 通过
- `cd src-tauri && cargo test` 通过（新增的 Rust 命令有单元测试）
- 前端关键逻辑（settingsStore 新字段迁移、背景渲染 hook）有 vitest 测试
- ESLint / 现有 lint 通过
- `CLAUDE.md` 「最近变更」补一条记录
- `tauri.conf.json` / `capabilities/default.json` / `Cargo.toml` 变更已 diff 给用户确认

## Technical Approach

### 数据模型（settingsStore）

```ts
interface TerminalBackgroundSettings {
  enabled: boolean;                              // R1
  imagePath: string | null;                      // 相对路径 backgrounds/<hash>.<ext>
  opacity: number;                               // 0..100
  fit: "cover" | "contain" | "center" | "tile"; // R4
  position: "top-left" | "top-center" | "top-right"
          | "center-left" | "center" | "center-right"
          | "bottom-left" | "bottom-center" | "bottom-right";
  blur: number;                                  // 0..20 px
  overlayDarken: number;                         // 0..80 %
}

// settingsStore 新增字段
terminalBackground: TerminalBackgroundSettings;
```

默认值：`{ enabled: false, imagePath: null, opacity: 50, fit: "cover", position: "center", blur: 0, overlayDarken: 30 }`。

会话覆盖单独存在 `terminalStore`：`hiddenBackgroundSessionIds: Set<string>`，进程内 in-memory，关闭会话清掉。

### 渲染管线

1. **xterm 构造期始终设 `allowTransparency: true`**（研究确认 WebglAddon 兼容透明背景，性能损失可接受）。避免「启用/禁用背景」时重建 Terminal 实例的复杂性。
2. **xterm `theme.background`**：
   - 背景图启用且当前会话未覆盖隐藏 → `"rgba(0,0,0,0)"`
   - 否则 → 沿用当前主题预设的不透明 HEX（现状）
3. **外层 DOM（`XTermTerminal.tsx` 的 wrapper `<div>`）**采用 CSS 伪元素叠加：
   - `::before` 承载 `background-image` + `background-size`(由 fit 映射) + `background-position`(由 position 映射) + `filter: blur(${blur}px)` + `opacity: ${opacity}%`
   - `::after` 黑色 `rgba(0,0,0,${overlayDarken}%)` 蒙层
   - xterm 容器 `position: relative; z-index: 2`
4. **平滑切换**：在 `::before` 上 `transition: opacity 300ms, background-image 0s` —— 透明度过渡，图片瞬切。切换图片时先 0 透明 → 换图 → 渐显。

### 后端命令

新增 `src-tauri/src/commands/background.rs`：

```rust
// 复制用户选择的图片到 appLocalData/backgrounds/<sha256>.<ext>
// 校验：扩展名 jpg/jpeg/png/gif；读字节算 sha256 命名；超过 5MB 不阻断仅返回 warn flag。
// 返回：{ relativePath: "backgrounds/abc...jpg", sizeBytes, warning?: "file_too_large" }
#[tauri::command]
async fn save_background_image(app: AppHandle, sourcePath: String) -> Result<SavedBackground, String>;

// 清理 appLocalData/backgrounds/ 下未在 settings 中引用的文件
#[tauri::command]
async fn cleanup_unused_backgrounds(app: AppHandle) -> Result<u32, String>;
```

### Tauri 配置增量

**`Cargo.toml`** 增加 `tauri-plugin-fs = "2"`（已在 lockfile 间接存在，需提升为直接依赖）。

**`lib.rs`** 注册 `tauri_plugin_fs::init()`。

**`tauri.conf.json`** 增加：
```jsonc
"app": {
  "security": {
    "csp": null,
    "assetProtocol": {
      "enable": true,
      "scope": { "allow": ["$APPLOCALDATA/backgrounds/**"], "deny": [] }
    }
  }
}
```

**`capabilities/default.json`** 增加 `"fs:default"`（保守，scope 由 assetProtocol.scope 控）。

### UI 增量

**`ThemeSettingsPage.tsx`** 末尾增加 `<TerminalBackgroundSection />` 子组件，包含：
- 启用开关
- 选图按钮（dialog 选 + 调 `save_background_image`）+ 缩略图预览
- 透明度滑块、适配下拉、9 宫格、模糊滑块、暗化滑块
- 「清除背景」按钮

**`TerminalTabs.tsx`** 的 ContextMenu 在「关闭其它终端」下增加「隐藏背景图」/「显示背景图」（仅当全局 enabled 时显示）。

## Decision (ADR-lite)

**Context**：xterm.js 不原生支持背景图；Tauri 2 默认不暴露本地文件给 WebView；启用透明背景可能影响 GPU 渲染性能。

**Decision**：
1. 始终 `allowTransparency: true`，xterm 透明 + 外层 CSS 伪元素叠加，避免重建实例。
2. 图片复制到 `appLocalData/backgrounds/<sha256>.<ext>`，asset protocol scope 严格锁定该目录。
3. WebglAddon 保留（研究证实兼容透明背景）。
4. 会话级覆盖仅 in-memory，不进 SQLite/store。

**Consequences**：
- ✅ 用户切换启用/禁用不感知任何延迟
- ✅ 安全边界精准（无 fs:* 通用读权限）
- ✅ 性能损失可控（保留 WebGL）
- ⚠️ `allowTransparency` 默认带 ~5-10% 性能 overhead，全局开启对纯色背景用户也有少量影响（可接受）
- ⚠️ 老背景文件不会自动清理，提供「清理未使用背景」手动命令

## Research References

- [`research/xterm-transparent-background.md`](research/xterm-transparent-background.md) — xterm.js 支持 `allowTransparency: true` + 透明 theme.background；WebglAddon 兼容；构造时设定不可热切换。
- [`research/tauri2-fs-asset-protocol.md`](research/tauri2-fs-asset-protocol.md) — `convertFileSrc` + `assetProtocol.scope = ["$APPLOCALDATA/backgrounds/**"]` 是 Tauri 2 标准做法；`tauri-plugin-fs 2.x` 已在 lockfile 间接存在，需直接依赖 + `init()`。

## Out of Scope

- 外部 Windows Terminal 的背景图设置（`useExternalTerminal=true` 时跳过该功能）
- 视频背景 / WEBM 背景
- 内置精选壁纸库（V2）
- 图片历史 / 最近使用列表（V2）
- 按项目独立背景（V2，若用户后续要求再做）
- 按终端主题预设关联背景（V2）

## Implementation Plan (small PRs)

- **PR1：后端基础设施**
  - `Cargo.toml` 增加 `tauri-plugin-fs = "2"`
  - `lib.rs` 注册 `tauri_plugin_fs::init()`
  - `tauri.conf.json` 增加 `assetProtocol` 配置
  - `capabilities/default.json` 增加 `fs:default`
  - 新增 `commands/background.rs`：`save_background_image` + `cleanup_unused_backgrounds`
  - Rust 单元测试（hash 命名、扩展名校验、scope 检查）

- **PR2：settings store 与渲染管线**
  - `settingsStore.ts` 增加 `terminalBackground` 字段 + 迁移逻辑
  - `terminalStore.ts` 增加 `hiddenBackgroundSessionIds`
  - `XTermTerminal.tsx` 接入 `allowTransparency: true` + 透明 theme.background + 外层 CSS 伪元素背景
  - `lib/terminalThemes.ts` 增加透明背景兜底辅助
  - vitest 覆盖核心 store 逻辑

- **PR3：UI 与右键覆盖**
  - `ThemeSettingsPage.tsx` 增加 `<TerminalBackgroundSection />`
  - 透明度/模糊/暗化滑块、适配下拉、9 宫格、缩略图预览
  - `TerminalTabs.tsx` ContextMenu 增加「隐藏背景图」选项
  - 平滑切换动效（CSS transition）

- **PR4：容错与文档**
  - 缺失图片回退 + 设置页提示
  - 大文件提示
  - `CLAUDE.md`「最近变更」补一条
  - 端到端冒烟测试覆盖所有 AC

## Technical Notes

- `src-tauri/Cargo.lock` 已含 `tauri-plugin-fs 2.4.5`（来自 dialog 传递依赖），但需提升为直接依赖以使其 build script 正确注入 capability schema。
- `tauri.conf.json` 当前 `csp: null`，asset 协议 URL 不会被 CSP 拒绝，无需额外配置。
- xterm 主题如 `selectionBackground` 在透明背景下需为半透明 `rgba(255,255,255,0.18)`，避免高对比；当前预设大多用不透明色，需要在透明模式下使用统一覆盖值（在 `lib/terminalThemes.ts` 加一层 transform）。
