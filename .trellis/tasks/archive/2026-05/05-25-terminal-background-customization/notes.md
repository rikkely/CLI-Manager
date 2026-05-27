# 模糊/颜色异常 Bug 修复笔记

## 问题描述

启用终端背景图后，部分文字变模糊，颜色也不太正常。关闭背景图则恢复正常。
仅出现在 `data-bg-enabled="true"` 状态下，规模仅限单个终端面板。

## 确认的根本原因

`src/App.css` 第 1846 行的 `isolation: isolate` 在 `.ui-terminal-bg-layer[data-bg-enabled="true"]`
上不仅创建了 stacking context，还把整个子树提升到了 GPU compositing layer。

**后果链**：
1. GPU 合成层无法做 subpixel 抗锯齿（GPU 不知道层背后的像素），浏览器静默降级
   为 grayscale AA。
2. xterm 的渲染并非纯 WebGL canvas — 它还有若干 DOM 元素：
   - `.xterm-helper-textarea`（IME / 焦点）
   - `.xterm-link-layer`（链接 hover）
   - `.xterm-decoration-container` / overlay 层（搜索高亮等）
   - scrollbar
3. 这些 DOM 渲染的字形/笔画失去 subpixel AA，看起来"软""糊"，与 canvas 的清晰字形
   并列时差异明显 → 用户感知的"部分字变模糊"。
4. 同时 WebGL 透明 + CSS `::before` opacity 合成在 GPU 层下会有轻微 alpha 混合误差，
   造成"颜色不太正常"。

`allowTransparency: true` 在两种状态下都开启，因此不是回归来源（已排除）。
触发器必然受 `data-bg-enabled="true"` 控制 — 即 `isolation: isolate`。

## 修改内容

**文件**：`src/App.css`（1844-1858 行附近，单点改动，约 11 行注释 + 1 行代码）

**Before**：
```css
.ui-terminal-bg-layer[data-bg-enabled="true"] {
  position: relative;
  isolation: isolate;
}
```

**After**：
```css
.ui-terminal-bg-layer[data-bg-enabled="true"] {
  position: relative;
  /* 详见注释：用 z-index: 0 创建 stacking context 而不强制 GPU 合成 */
  z-index: 0;
}
```

**为什么有效**：`position: relative + z-index: 0` 会创建 stacking context（保留
`::before z-index:0`、`::after z-index:1`、`> * z-index:2` 的层叠顺序），但在
当前 Chrome/Edge 中不会强制 compositing layer 提升 — DOM 文字保留 subpixel AA。

## Step 3 是否必要

否。Step 2 即解决了"模糊"和"颜色"两类症状（颜色的轻微偏差也来自合成层下的
alpha 混合差异，去掉合成层即一并解决）。
`src/lib/terminalThemes.ts` 未改动。

## 用户视觉验证清单

1. 开启背景图：
   - 文字边缘应与关闭背景图时一样锐利；
   - 字体颜色应与关闭状态一致（无明显发灰、发淡）；
   - 光标、选区、链接 hover 高亮位置正确，无错位。
2. 关闭背景图：渲染应与修复前完全一致（无回归）。
3. 切换模糊度滑杆：背景图的模糊应正常变化，文字不受影响。
4. 切换 darken 滑杆：覆盖暗化层正常生效，文字依然清晰。

## 验证状态

- `npx tsc --noEmit`：通过（无错误）。
- 后端无改动，无需 `cargo check`。

---

# Fix #2 — 文字边缘在高频背景图上"发糊"

## 问题描述

第一处模糊修复后，用户提交新截图：在彩色高频背景（橡皮鸭图）之上，Claude Code
状态行的小字号 token（红/绿色 SGR 背景的小药丸）以及其周边的默认背景小字，
字形边缘"溶进"了背景颜色，可读性差。

用户当前设置：`imageOpacity=100, blur=0, overlayDarken=50, fit=cover`。

## 根本原因

`applyTransparency()` 之前把 `theme.background` 设为 `rgba(0,0,0,0)`。WebGL 渲染器
把默认 cell 背景输出为 alpha=0：
- 字形 body 像素 (alpha≈1)：与 cell 背景下方的 BG 图无视觉冲突；
- 字形 **edge** 像素 (alpha 0.1–0.6，子像素覆盖)：与高频 BG 图像素直接 alpha-blend，
  小字号下 edge 占比高，整体观感"糊"。

`::after` 50% 暗化层位于 xterm 容器之下（z-index 1 vs 2），它降低了 BG 图本身的
亮度，但 alpha-blend 仍然发生在每个 glyph 的子像素边界 — `::after` 触达不到那一层。

## 修复策略

把 `applyTransparency()` 改为接收 `darkenPct` 参数，给 cell 背景注入一个"深色 alpha 地板"：

```ts
applyTransparency(theme, darkenPct)
  → background: rgba(0,0,0, darkenPct/100 * 0.6)
```

系数 0.6 的取值依据：
- `darken=0`   → cell bg alpha=0.00（图像全显，原行为）
- `darken=50`  → cell bg alpha=0.30（图像仍可见，文字 edge 在稳定深色基底上 resolve）
- `darken=100` → cell bg alpha=0.60（图像变淡，文字几乎不受 BG 高频影响）

字形 edge 像素始终与一致的深色基底（而非噪声图像）做 alpha-blend，因此 edge 清晰可分。
图像仍透过该 alpha 地板渲染，所以视觉上图像仍然可见。

`::after` 不动 — 它继续负责对 cell 之间的空白做暗化，保持滑杆原有用户语义。
如果用户反馈"整体过暗"，可后续把 `::after` 的系数从 1:1 降到 0.7:1，但默认保留。

## 修改内容

1. **`src/lib/terminalThemes.ts`** — `applyTransparency(theme)` → `applyTransparency(theme, darkenPct = 0)`，
   将 `background` alpha 由固定 0 改为 `darkenPct/100 * 0.6`。注释更新。约 +10 行（含注释）。
2. **`src/components/XTermTerminal.tsx`** — 两处 `applyTransparency(baseTheme)` 调用追加
   `background.overlayDarken` 参数（hot-update effect 第 ~104 行；construction effect 第 ~154 行）。
   hot-update effect 的依赖数组追加 `background.overlayDarken`，让用户拖动滑杆时
   alpha 地板实时刷新。

## 用户视觉验证

| overlayDarken | 期望效果 |
|---|---|
| 0   | 与之前完全一致：BG 图全显；小字号在高频图上 edge 仍可能"软"（已知 trade-off）。 |
| 50  | BG 图仍清晰可见；状态行小字、SGR 高亮像素清晰可读，无溶解感。 |
| 100 | BG 图明显被压暗；终端文字最接近原始不透明主题的锐利度。 |

## 验证状态

- `npx tsc --noEmit`：通过（无错误）。
- 后端无改动，无需 `cargo check`。
- `::after` 未调整 — 等用户实测后再决定是否降低系数。

