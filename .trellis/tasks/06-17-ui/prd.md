# 重构供应商模块 UI 对齐系统设计语言

## Goal

供应商模块（设置页 `ProviderSettingsPage` + 项目切换弹窗 `ProviderSwitchModal`）当前用了两套互不相干的样式体系，且都绕开了系统已有的"标准件"（`.ui-surface-card` / `.ui-selection-card` / `.ui-interactive` / `.ui-focus-ring` + `var(--primary)` 色板）。表现为"仿 iOS"的大圆角、多彩药丸徽章、廉价的 `hover:opacity-80`、硬编码 `accent` 选中态。本任务将其归一到系统设计语言，使供应商模块与「通用设置」等页面视觉一致。

## What I already know

- `ProviderSettingsPage.tsx`：Mantine 组件实现，`radius="lg"`、`radius="xl"` 胶囊徽章、`Badge color="green/gray/blue/red"` 多彩徽章；列表项 `ProviderListItem`（行 184-188）选中态硬编码 `border-accent/40 bg-accent/10`，未选中态 `hover:opacity-80`，无 focus ring。
- `ProviderSwitchModal.tsx`：纯 Tailwind 硬编码 token；选中行（行 228-232）同样 `border-accent/40 bg-accent/10` + `hover:opacity-80`；徽章是 `rounded-full bg-accent/15 text-accent` 药丸；圆角混用 `rounded`(4px)。
- `JsonCodeBlock`（ProviderSettingsPage.tsx 行 72-95）：背景硬编码 `#1e1e1e`，VSCode 暗色高亮，不随主题切换。
- 系统基准（`App.css` + `GeneralSettingsPage.tsx`）：
  - `.ui-surface-card`：`border-radius: 12px` + 极淡 `outline`，无彩色边框（App.css:619）。
  - `.ui-selection-card[data-selected]` / `.ui-interactive[data-selected]`：选中态走 `var(--interactive-selected-*)` 与 `color-mix(in srgb, var(--primary) X%, ...)`（App.css:815-843）。
  - 徽章参考 `PaletteCard` "当前"标：`primary 10%` 底 + `primary 22%` 描边 + `primary` 字色，单色克制。
  - Mantine `defaultRadius: "md"`，强调色统一 `cliPrimary` / `var(--primary)`。

## Requirements（修改范围）

### P0 — 统一选中行组件（核心诉求：选中态 + 配色）
- 抽出共享 `ProviderRow`（建议放 `src/components/`），同时供 `ProviderSettingsPage` 列表项与 `ProviderSwitchModal` 行复用。
- 选中态从硬编码 `accent` 改为系统 `color-mix(var(--primary) ...)` + `.ui-interactive` / `.ui-focus-ring`。
- 去掉 `hover:opacity-80`，hover 走 bg 渐变（系统 interactive 行为）。
- 补 `.ui-focus-ring`，键盘聚焦有反馈。
- 选中标记统一右侧 `Check` 图标。

### P1 — 卡片与圆角归一
- `ProviderSettingsPage` 内 `<Card border... bg-surface-container-low radius="lg">` → `className="ui-surface-card"`（移除显式 radius，统一 12px）。
- 移除散落的 `radius="xl"`；圆角统一到 `md`/12px 体系。
- `ProviderSwitchModal` 的 `rounded`(4px) 容器统一到系统圆角。

### P2 — 徽章降饱和
- 抽 `ProviderBadge`：默认 primary-mix 单色风格替代 `color="green/gray/blue"` 多彩药丸。
- 仅"配置解析失败"保留语义色 `var(--danger)`。"当前/全局当前"改用 primary-mix。

### P3 — 主题感知的 JSON 代码块（已定：方案 A，本次纳入）
- `.json-code-block` 背景从 `#1e1e1e` 改为随主题（`var(--surface-container-highest)` 或等价 token），高亮色随明暗切换两套（浅色主题用浅底+深色高亮，暗色主题保留现风格）。

## Acceptance Criteria

- [ ] 供应商列表/切换行选中态使用 `var(--primary)` 色板，与「通用设置」选择卡视觉一致，无硬编码 `accent`。
- [ ] 所有列表行有 hover bg 反馈与键盘 focus ring，不再用 `hover:opacity-80`。
- [ ] 卡片统一 `.ui-surface-card`（12px 圆角、淡描边），无残留 `radius="lg/xl"`。
- [ ] 徽章为单色 primary-mix 风格，仅错误态用 danger 语义色。
- [ ] 两处选中行由同一个 `ProviderRow` 组件渲染，无重复实现。
- [ ] `npx tsc --noEmit` 通过；亮/暗主题、多套配色下无明显视觉错乱。

## Definition of Done

- 纯前端改动，不触碰后端 / 数据层 / IPC。
- `npx tsc --noEmit` 通过。
- 用户在亮/暗主题各抽查一套配色，确认视觉一致后验收（按用户验证习惯：范围由我汇报，构建/视觉由用户确认）。

## Out of Scope

- 不改供应商数据读取、cc-switch 解析、切换写入逻辑（纯展示层重构）。
- 不新增功能（不加排序/搜索/编辑能力）。
- 不改 Mantine 主题全局配置。

## Decision (ADR-lite)

**Context**: 供应商模块两套样式体系，与系统设计语言不一致；JSON 代码块明暗主题表现是开放项。用户随后提供了 `docs/UI/`（DESIGN.md + code.html + screen.png）作为目标设计——"Chromatic Intelligence / Editorial Analyst" 风格：编辑式大标题、色调分层、大圆角卡片、左侧强调条选中态、柔粉强调高亮、Tab + 深色 JSON 块。

**Decision**:
1. **采纳该参考的视觉语言与布局**（左主列表 + 右详情大标题 + 环境变量卡片网格 + Tab JSON 块、左强调条选中态、柔色 chip、大圆角卡片）。
2. **所有颜色映射到系统主题 token**（`--primary` / `--surface-container-*` / `--on-surface*`），不写死 `#b5044d`/`#2a6676`，保证 18 套主题（9 亮 + 9 暗）与暗色模式可用。
3. **只保留真实数据**：丢弃无数据源的统计页脚（4.2k/240ms/99.9%）、"Add Supplier"、"Connect Instance"、最近连接时间、悬浮终端按钮等虚构部分。
4. 字体沿用应用全局 `uiFontFamily`，不引入 Manrope/Inter；"编辑式"质感靠字重 + 字号 + 字距实现。
5. JSON 代码块沿用 P3=A（主题感知，已实现）。

**Consequences**: 视觉改动幅度比初版"对齐系统"更大（更接近参考的编辑式风格、圆角更大），但通过 token 映射保持全主题可用；与最初"减小圆角/贴近系统"的方向相比是用户主动调整。新增共享 `.provider-row` 样式到 App.css。

## 参考设计映射（docs/UI → 系统 token）

| 参考 | 映射 |
|------|------|
| primary `#b5044d` / primary-container `#d82c65` | `var(--primary)` / `var(--accent-hover)` |
| primary-fixed `#ffd9df`（柔粉高亮底） | `color-mix(in srgb, var(--primary) 10-14%, transparent/surface)` |
| secondary teal `#2a6676`（链接） | `var(--primary)`（无 teal token，统一强调色） |
| surface tiers | 直接用现有 `--surface-container-lowest/low/high/highest` |
| on-surface `#111d26` | `var(--on-surface)` |
| 左强调条选中态 `border-l-[6px] border-primary bg-primary-fixed/40` | `.provider-row[data-selected]`：左 4px primary 条 + primary-mix 底 + 柔光 |
| 大圆角 `rounded-[40px]/3xl` | 卡片 ~20-24px、内卡 ~16px（编辑式但适配设置面板宽度） |
| 深色 JSON 块 | 沿用 P3=A 主题感知版 |
| 统计页脚 / Add / Connect / 悬浮按钮 | **不实现**（无真实数据/功能） |

## Technical Notes

- 受影响文件：`src/components/settings/pages/ProviderSettingsPage.tsx`、`src/components/ProviderSwitchModal.tsx`，新增 `src/components/ProviderRow.tsx`（或就近），可能微调 `src/App.css` 的 `.json-code-block`。
- 复用标准件：`.ui-surface-card`(App.css:619)、`.ui-interactive`(795)、`.ui-selection-card`(829)、`.ui-focus-ring`(1359)；选中色参考 `PaletteCard`(GeneralSettingsPage.tsx:316)。
- 风险：低。可逆、无数据迁移。两个文件分属 Mantine / Tailwind 两套写法，`ProviderRow` 需兼容两处用法（props 抽象选中态、徽章、副标题等）。
