# Smoke Test — Terminal Background Customization

> Run through this checklist before tagging the feature as complete. All
> 16 ACs from the PRD are mapped to concrete clickable steps. Tick a box
> only after physically observing the expected outcome.

## Setup

- [ ] `npm install` 完成，无报错
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `cd src-tauri && cargo test --lib background` 全部用例通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run tauri dev` 启动成功；前端控制台与 Rust 日志无新增 ERROR
- [ ] 打开「设置 → 主题」页 → 页面底部出现「终端背景」区块（`ui-surface-card` 视觉规范）

## 功能 ACs

- [ ] **AC1**：首次启动（未配置过背景）→ 进入任意终端 Tab，背景为当前主题纯色，**与现状一致**，无图片层
- [ ] **AC2**：勾选「启用终端背景图」→ 点击「选择图片...」→ 选一张本地 JPEG → 终端立刻显示该图：
      默认透明度 50% / 适配 cover / 位置 center / 模糊 0px / 暗化 30%
- [ ] **AC3**：拖动「透明度」滑块 0 ↔ 100 → 所有活跃终端 Tab 同步过渡，无明显延迟（≤ 1 帧滞后）
- [ ] **AC4**：切换「适配模式」cover → tile → 背景立即重绘为平铺
- [ ] **AC5**：点击 9 宫格「左上」→ 图片立刻对齐到左上角（在 `center` 适配模式下尤其明显）
- [ ] **AC6**：拖动「模糊」从 0 到 10px → 图片明显高斯模糊，xterm 字符仍清晰可读（字符不在模糊层）
- [ ] **AC7**：拖动「暗化覆盖」从 0 到 50% → 黑色蒙层加深，xterm 主题前景色 RGB 不变
- [ ] **AC8**：选择一张 GIF（含动画帧）→ 终端背景为动画播放，无明显卡顿，CPU 占用可接受
- [ ] **AC9**：选择一张 > 5MB 的 JPEG（例如 8MB）→ 保存成功 + 顶部 toast 提示「图片大于 5MB，可能影响启动速度」+ 终端立刻显示该图
- [ ] **AC10**：选择 WEBP / BMP / EXE → 文件选择对话框 filter 已限制；如绕过 filter 直接传入，toast 报错「不支持的图片格式」
- [ ] **AC11**：打开 2+ 个终端 Tab → 在 Tab A 上右键 → 「隐藏背景图」→ 仅 Tab A 背景隐藏；切到 Tab B 仍显示背景
- [ ] **AC12**：完全关闭并重新打开应用 → 全局配置（启用、图片、参数）全部恢复；上一步 Tab A 的「隐藏」覆盖被清空（Tab A 恢复显示）
- [ ] **AC15**：F12 打开 DevTools → Console 中无 WebGL 错误；XTermTerminal 内部 WebglAddon 仍正常加载（不回退 Canvas renderer）
- [ ] **AC16**：在终端显示图 A 状态下，重新「选择图片」→ 图 B → 观察到 ≈ 300ms 的淡入淡出过渡（不是瞬切硬切）

## 安全 ACs

- [ ] **AC14**：DevTools Console 执行
      `fetch("http://asset.localhost/C%3A%2FWindows%2FSystem32%2Fnotepad.exe")`
      → 被 asset scope 拒绝（404 / forbidden），不返回任何文件字节
- [ ] **AC14b**：DevTools Console 执行
      `fetch("http://asset.localhost/C%3A%2FUsers%2F<you>%2FAppData%2FLocal%2Fcom.cli-manager.app%2Fsettings.json")`
      → 被拒绝（仅 `$APPLOCALDATA/backgrounds/**` 在白名单内）

## 韧性 ACs

- [ ] **AC13a**：在应用中保存了一张背景图 → 完全关闭应用 →
      手动到 `%APPDATA%\..\Local\com.cli-manager.app\backgrounds\` 删除该图片文件 →
      重新启动应用 → 终端正常渲染（背景层无图，回退到纯色），无白屏 / 崩溃
- [ ] **AC13b**：在上述状态下进入「设置 → 主题 → 终端背景」→
      上方出现警告卡片「⚠ 此前选择的背景图已丢失（可能被外部删除或移动）。请重新选择图片或关闭背景。」
- [ ] **AC13c**：点击「选择图片」重新选一张 → 警告卡片消失 + 终端立刻显示新图
- [ ] **AC13d**：另一条路径：点击「清除」→ 警告卡片消失 + 启用开关仍为 ON 但回到「尚未选择图片」状态

## 旁路清理验证

- [ ] 选择图片 A 保存 → 检查 `backgrounds/` 目录有 1 个文件
- [ ] 在仍启用的状态下选图片 B → 检查 `backgrounds/` 目录仍只有 1 个文件（图 A 已被自动清理）
- [ ] 点击「清除」→ 检查 `backgrounds/` 目录为空
- [ ] 反例：仅切换「启用」开关 OFF → ON → OFF → `backgrounds/` 目录里的文件**不**应该被清理（便于重新启用）

## 性能 / 回归

- [ ] 启用背景图后，长时间 (30s+) 输出大量字符到终端，FPS 与未启用相比下降幅度 ≤ 10%
- [ ] 终端 resize（拖动分屏分隔线）时背景层跟随，无错位、无白边
- [ ] 暗主题与亮主题切换 → 背景层与 xterm 文字均正确刷新

## DoD 复核

- [ ] 所有 AC 已勾选
- [ ] `CLAUDE.md`「最近变更」已追加一条记录（终端背景自定义）
- [ ] `tauri.conf.json` / `capabilities/default.json` / `Cargo.toml` 的变更已在 PR1 中 diff 给用户确认
- [ ] 无新的 ESLint warning / TypeScript error
