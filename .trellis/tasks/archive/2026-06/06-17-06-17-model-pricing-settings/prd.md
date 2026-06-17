# 引入模型价格设置与费用统计功能

## Goal

从 CPA-Manager-Plus 借鉴「模型价格设置」功能，将当前硬编码在前后端两处的模型价格表（前端 18 个模型 + 后端 21 个模型）改为可配置的 SQLite 存储，支持手动添加/编辑/删除模型价格、一键同步远程价格（LiteLLM + OpenRouter），并用于两个 CLI-Manager 自管费用计算场景：

1. **内部终端实时统计**（`TerminalStatsPanel` - 当前会话预估费用 + 今日项目费用）
2. **历史用量分析**（`StatsPanel` - 后端 `history_get_stats` 计算总费用 + 未定价 token）

`ccusage 用量分析` 继续沿用外部 ccusage 工具自身的费用估算，不接入/覆盖本地模型价格表。

**Why**: 当前价格硬编码导致：① 新模型发布需改代码重编译；② 前后端价格表不一致（TS 18 vs Rust 21）；③ 无法自定义私有/企业模型价格；④ 用户无法查看/审计定价依据。可配置价格表提升灵活性与透明度。

---

## What I Already Know

### 现有架构（从代码研究得出）

**前端硬编码定价**：
- 文件：`src/lib/modelPricing.ts` (18 个模型)
- 结构：`{ modelId, inputPerMillion, outputPerMillion, cacheReadPerMillion, cacheCreationPerMillion }`
- 单位：USD / 1M tokens
- 归一化：移除 `[1m]` 后缀、`us.anthropic.com/` 前缀、`(xhigh)` 等 UI 后缀
- 消费方：`src/components/stats/termStatsUi.tsx:116`（终端实时统计回退计算）

**后端硬编码定价**：
- 文件：`src-tauri/src/commands/history.rs:3065-3220` (21 个模型)
- 结构：`HistoryModelPricing { model_id, input_per_million, output_per_million, cache_read_per_million, cache_creation_per_million }`
- 消费方：`calculate_usage_cost()` (`:3007-3054`)，用于历史用量分析、今日费用聚合
- 优先级：显式 `explicit_cost_usd`（日志携带）> 定价表计算 > 未定价（`unpriced_tokens`）

**SQLite 现状**：
- 最高 migration: v10 (`src-tauri/src/lib.rs:156` - `ccusage_cache` 表)
- 前端 DB 访问：`src/lib/db.ts` - `getDb()` 单例
- 封装模式：各表 CRUD 在对应 Zustand store（如 `settingsStore.ts`、`projectStore.ts`）

**设置中心结构**：
- 入口：`src/components/SettingsModal.tsx`
- Tab 定义：`:15` `SettingsTab` 类型、`:24` `SETTINGS_TAB_ORDER`、`:26` `SETTINGS_TAB_CONFIG`、`:117-126` 内容路由
- 现有 7 个子页：`general / terminal-theme / shortcuts / templates / providers / sync / hooks`
- 子页位置：`src/components/settings/pages/`

**CPA-Manager-Plus 参考实现**（已完整研究）：
- **同步源**：LiteLLM (`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`) + OpenRouter (`https://openrouter.ai/api/v1/models`)
- **数据结构**：`ModelPrice { prompt, completion, cache, cacheRead, cacheCreation, source, sourceModelId, rawJson, updatedAtMS, syncedAtMS }`
- **表结构**：`model_prices (model PK, prompt_per_1m, completion_per_1m, cache_per_1m, cache_read_per_1m, cache_creation_per_1m, source, source_model_id, raw_json, updated_at_ms, synced_at_ms)`
- **模糊匹配算法**：精确匹配 → 大小写不敏感 → 去 provider 前缀尾段匹配 → Jaccard + Levenshtein 相似度 → 返回候选集供用户确认
- **前端 UI**：Add manual / Sync 按钮、搜索框、过滤标签（all/missing/candidates/saved）、价格表（编辑/删除）、候选下拉确认

---

## Assumptions (Temporary - To Validate)

1. **单一数据源**：新增 SQLite 表 `model_prices` (v11 migration)，作为前后端唯一权威定价源，启动时加载到内存（前端 store + 后端全局静态变量）。硬编码价格表降级为「默认种子数据」。
2. **后端 API 优先**：定价 CRUD 用 Tauri 命令（Rust 负责 SQLite + 同步逻辑），前端仅读取 + UI 展示。
3. **历史兼容**：已存在的历史会话（`session_meta` 表）不回溯重算费用，仅影响新查询/新扫描。
4. **ccusage 独立**：`CcusageStatsPanel` 继续使用 ccusage 工具自带费用，不强制覆盖（因其定价源可能更新）。但可选在 UI 提示「若需自定义价格，请切换到历史用量分析」。
5. **价格单位**：USD / 1M tokens（与现有一致），暂不支持多币种。
6. **同步策略**：手动触发（Sync 按钮），不自动后台同步（避免网络依赖）。
7. **初始化时机**：首次打开「模型价格设置」页时，若 DB 表空，自动插入当前硬编码的 18+21 合并去重后的种子数据（source='builtin'）。

---

## Decision (ADR-lite)

**Context**: 需确定模型列表来源、同步范围、价格设置 UI 位置。

**Decision**（用户确认）：
1. **模型列表来源 = 方案 A（扫描历史 jsonl）+ 手动添加入口**。复用 `history_get_stats` 的 `model_distribution` 聚合逻辑发现本地实际使用过的模型，并保留「手动添加」按钮覆盖未来模型。
2. **同步范围 = 方案 B（完整模糊匹配 + 候选确认 UI）**。移植 CPA-Manager-Plus 的匹配算法（精确 → 大小写不敏感 → 去 provider 前缀尾段 → Levenshtein 相似度），返回候选集供用户下拉确认。同步源：LiteLLM + OpenRouter 双源。
3. **价格设置 UI = 设置中心独立新模块**。在 `SettingsModal.tsx` 新增独立 tab `"model-pricing"`（label「模型价格」），不复用 `providers`，作为单独导航项。
4. 价格存储 = SQLite 表 `model_prices`（v11 migration），后端全局静态缓存（`Lazy<RwLock<HashMap>>`），前端 Zustand store 缓存。
5. 费用计算改造：前后端 `findModelPricing` / `find_history_model_pricing` 改为读 DB 缓存，硬编码表降级为种子+回退。

**Consequences**:
- ✅ 自动发现本地模型 + 高覆盖率同步，用户负担最小。
- ✅ 单一权威数据源（SQLite），前后端价格一致。
- ⚠️ 需移植 Levenshtein 模糊匹配算法（Rust 用 `strsim` crate 或手写）。
- ⚠️ 实现工作量较大（数据层 + 5 个 Rust 命令 + 完整 UI + 费用计算改造）。

---

## Open Questions (RESOLVED)

### 1. 模型列表来源
CPA-Manager-Plus 的「识别本地使用的模型」依赖其 Manager Server 采集的 usage 事件（非扫描 jsonl）。CLI-Manager 是纯本地应用，需自行提取模型列表。

**选项**：
- **A. 从历史 jsonl 扫描提取**（推荐）- 复用 `history_list_sessions` / `history_get_stats` 的模型聚合逻辑（`model_distribution`），自动发现用户实际使用过的模型。
- **B. 从内置种子 + 手动添加** - 不扫描，仅展示已有价格表 + 用户手动输入新模型。
- **C. 混合** - 种子 + 扫描发现（标记为 discovered=true）+ 手动添加。

**我的推荐**：**A**（扫描历史）+ 种子初始化。理由：① 自动发现用户环境中的实际模型（含私有/企业模型）；② 与「历史用量分析」逻辑一致（已有 `model_distribution` 聚合）；③ 无需用户记忆/输入模型 ID。

### 2. 价格表初始化时机
**选项**：
- **A. 首次打开设置页时初始化**（推荐）- 检查 `model_prices` 表为空 → 插入种子数据。
- **B. 应用启动时初始化** - `App.tsx` 加载阶段自动初始化。
- **C. 延迟初始化** - 直到首次执行费用计算时才初始化。

**我的推荐**：**A**（首次打开设置页）。理由：① 不影响应用启动速度；② 用户可能永远不打开该设置（无需预加载）；③ 初始化与 UI 同步，可显示进度。

### 3. 同步功能 MVP 范围
CPA-Manager-Plus 的同步包含：① LiteLLM + OpenRouter 双源；② 模糊匹配 + 候选集；③ 批量确认候选；④ 冲突策略（远程覆盖 vs 保留本地手动价格）。

**选项**：
- **A. MVP 仅实现精确匹配同步** - 调用 LiteLLM API，仅匹配 `model_id` 精确相同的模型，无候选集 UI。
- **B. 完整实现模糊匹配 + 候选确认**（推荐）- 复刻 CPA 的匹配算法（去 provider 前缀 + Levenshtein）+ 候选下拉 UI。
- **C. 暂不实现同步** - MVP 仅手动添加/编辑，同步功能作为后续任务。

**我的推荐**：**B**（完整模糊匹配）。理由：① LiteLLM 的模型 ID 与 Claude Code 日志中的 ID 不完全一致（如 `anthropic/claude-opus-4-8` vs `claude-opus-4-8`），精确匹配覆盖率低；② 模糊匹配算法已在 CPA 验证可行，可直接移植；③ 候选集 UI 让用户明确知道匹配结果，避免静默失败。

### 4. 前端价格缓存策略
后端 SQLite 是权威源，前端需缓存以减少 IPC 调用。

**选项**：
- **A. Zustand store + 应用启动时全量加载**（推荐）- `settingsStore` 新增 `modelPrices` 状态，启动时调 `model_prices_list` 命令加载到内存。
- **B. 按需加载 + LRU 缓存** - 每次计算费用时按模型 ID 查询，前端 LRU 缓存 100 个模型。
- **C. 实时查询，不缓存** - 每次费用计算都调后端命令。

**我的推荐**：**A**（全量加载到 store）。理由：① 模型价格表通常 <100 条，内存开销小；② 费用计算是高频操作（终端实时统计 10s 轮询），实时查询会卡顿；③ 与现有 settings/projects 等数据加载模式一致。

### 5. 后端定价加载时机
后端 `calculate_usage_cost()` 当前每次扫描 jsonl 时都查硬编码常量。改为 DB 后需决定何时加载。

**选项**：
- **A. 应用启动时加载到全局静态变量**（推荐）- 用 `once_cell::sync::Lazy<RwLock<HashMap<String, ModelPrice>>>` 缓存全表，CRUD 命令执行后刷新缓存。
- **B. 每次扫描会话时查询一次** - `scan_session_inner()` 开始时 `SELECT * FROM model_prices` 到局部 HashMap。
- **C. 实时查询** - 每个模型调一次 `SELECT ... WHERE model=?`。

**我的推荐**：**A**（全局静态缓存）。理由：① 历史扫描是 CPU 密集型操作（4000+ 行 Rust 代码），减少 DB I/O 至关重要；② 价格表变更低频（用户手动编辑/同步），适合缓存；③ RwLock 保证线程安全（多并发扫描时共享读锁）。

---

## Technical Approach (定稿)

### 架构：前端拥有 DB + 后端持内存缓存

经代码调查确认：
- 所有现有 SQLite 表写入都在**前端**（`src/lib/db.ts` 的 `getDb()` → `tauri-plugin-sql`）。
- 后端 `sqlx` 仅用于**只读** ccswitch.db（独立路径），不碰 `cli-manager.db`。
- 后端 `reqwest`（json + rustls-tls）已就绪，可做同步请求。
- 费用计算在两处：前端 `modelPricing.ts:103`（终端实时统计回退）、后端 `history.rs:3007 calculate_usage_cost`（历史分析权威）。ccusage 由外部工具算，**不改**。

**决策**：DB 读写全部在前端（与现有表一致，规避后端猜测 plugin-sql 落盘路径的脆弱性）。后端费用计算需要价格 → 前端在启动/价格变更时通过 `model_prices_set_cache` 命令把全表 push 到后端全局缓存 `Lazy<RwLock<HashMap<String, ModelPriceEntry>>>`；后端 `find_history_model_pricing` 改为读缓存（缓存空时回退硬编码种子表）。

### 数据流

```
首屏启动 (App.tsx init)
  → settingsStore.loadModelPrices()
     → getDb() SELECT * FROM model_prices
        → 若空：插入种子（合并前后端硬编码 24 模型，source='builtin'）
     → push 到前端 store.modelPrices
     → invoke('model_prices_set_cache', { prices })  // 同步给后端
        → 后端 *MODEL_PRICE_CACHE.write() = HashMap

终端实时统计 (termStatsUi.tsx:116 calculateCost)
  → 读 store.modelPrices（前端缓存）→ 计算

历史用量分析 (history.rs calculate_usage_cost)
  → find_history_model_pricing 读 *MODEL_PRICE_CACHE（后端缓存）→ 计算

用户编辑/同步价格 (ModelPricingSettingsPage)
  → getDb() upsert/delete → store 刷新 → 再次 invoke('model_prices_set_cache')

同步 (model_prices_sync 命令)
  → 后端 reqwest LiteLLM + OpenRouter → 解析 ×1e6 → 模糊匹配本地模型
  → 返回 { matched, candidates, unmatched } → 前端展示候选 UI → 确认后写 DB
```

### 后端命令（新建 `src-tauri/src/commands/model_pricing.rs`）

| 命令 | 签名 | 职责 |
|---|---|---|
| `model_prices_set_cache` | `(prices: Vec<ModelPriceEntry>) -> Result<(), String>` | 前端 push 全表到后端内存缓存 |
| `model_prices_sync` | `(targets: Vec<String>) -> Result<SyncResult, String>` | reqwest 拉取 LiteLLM+OpenRouter，模糊匹配，返回结果（不写 DB，由前端写） |

> `discover`（识别本地模型）复用现有 `history_get_stats` 的 `model_distribution`，无需新命令；前端取 model 列表与 store.modelPrices diff 即可。CRUD 在前端 `getDb()` 完成，无需后端命令。

### 模糊匹配（移植 CPA-Manager-Plus）

精确 → 大小写不敏感 → 去 provider 前缀尾段（`anthropic/claude-x` ↔ `claude-x`）→ Levenshtein 相似度（手写，避免新增 `strsim` 依赖）。相似度 >0.7 进候选集，按分排序。

### migration v11

```sql
CREATE TABLE IF NOT EXISTS model_prices (
    model               TEXT PRIMARY KEY,
    input_per_1m        REAL NOT NULL DEFAULT 0,
    output_per_1m       REAL NOT NULL DEFAULT 0,
    cache_read_per_1m   REAL NOT NULL DEFAULT 0,
    cache_creation_per_1m REAL NOT NULL DEFAULT 0,
    source              TEXT NOT NULL DEFAULT 'manual',
    source_model_id     TEXT,
    updated_at_ms       INTEGER NOT NULL DEFAULT 0,
    synced_at_ms        INTEGER
);
```

---

## Requirements (Evolving)

### 数据层
- [ ] 新增 SQLite migration v11：`model_prices` 表（字段：model PK, input_per_1m, output_per_1m, cache_read_per_1m, cache_creation_per_1m, source, source_model_id, raw_json, updated_at_ms, synced_at_ms）
- [ ] 后端全局静态缓存：`Lazy<RwLock<HashMap<String, ModelPrice>>>`，启动时从 DB 加载
- [ ] 前端 Zustand store：`settingsStore` 新增 `modelPrices: Record<string, ModelPrice>` 状态

### 后端 Rust 命令（`src-tauri/src/commands/model_pricing.rs`）
- [ ] `model_prices_list() -> Vec<ModelPrice>` - 列出全部价格
- [ ] `model_prices_upsert(prices: Vec<ModelPrice>) -> Result<()>` - 批量插入/更新（用于手动添加、同步结果保存）
- [ ] `model_prices_delete(models: Vec<String>) -> Result<()>` - 批量删除
- [ ] `model_prices_sync(models: Option<Vec<String>>) -> Result<SyncResult>` - 同步远程价格（LiteLLM + OpenRouter），返回 matched/candidates/unmatched
- [ ] `model_prices_discover() -> Vec<String>` - 从历史 jsonl 扫描提取去重模型列表（复用 `history_get_stats` 的 model_distribution）

### 前端 UI（`src/components/settings/pages/ModelPricingSettingsPage.tsx`）
- [ ] 顶部操作栏：「识别本地模型」按钮（调 `discover` + 与已有价格 diff）、「同步远程价格」按钮（带 loading）、「手动添加」按钮
- [ ] 搜索 + 过滤标签：all / missing（发现但无价格）/ saved（已有价格）、候选计数
- [ ] 价格表：列 = 模型名 / 来源（builtin/manual/litellm/openrouter）/ input / output / cache_read / cache_creation / 操作（编辑/删除）
- [ ] 编辑弹窗：model（不可编辑，除非新增）/ 4 个价格输入框 / 保存/取消
- [ ] 候选确认 UI（同步后）：每个未匹配模型显示候选下拉（相似度排序）+ 确认按钮

### 设置中心集成
- [ ] `src/components/SettingsModal.tsx` 修改：新增 tab `"model-pricing"`，label「模型价格」，放在 `providers` 之后
- [ ] 导航与路由：挂载 `ModelPricingSettingsPage` 组件

### 费用计算改造
- [ ] **前端** `src/lib/modelPricing.ts`：`findModelPricing()` 从 store 读取而非硬编码常量；保留硬编码为回退（防止 DB 读取失败导致费用全 0）
- [ ] **后端** `src-tauri/src/commands/history.rs`：`find_history_model_pricing()` 从全局缓存读取而非硬编码常量；保留硬编码为回退

---

## Acceptance Criteria (Testable)

- [ ] 打开「模型价格设置」页，首次加载自动插入种子数据（合并前后端硬编码的 18+21 去重后约 24 个模型，source='builtin'）
- [ ] 点击「识别本地模型」，扫描历史 jsonl，展示用户实际使用过的模型列表，标记哪些缺失价格
- [ ] 手动添加一个自定义模型价格（如 `my-private-model`），保存后在表格中显示，source='manual'
- [ ] 编辑已有模型价格，修改 input_per_1m 从 15.0 → 20.0，保存后立即生效（终端实时统计的预估费用随之变化）
- [ ] 删除一个模型价格，确认后从表格移除，该模型费用计算降级为 0（`unpriced_tokens` 增加）
- [ ] 点击「同步远程价格」，成功拉取 LiteLLM 数据，匹配到至少 10 个模型（精确 + 模糊匹配），更新价格，source='litellm'
- [ ] 同步后有候选集（如 `anthropic/claude-opus-4-8` 候选匹配本地 `claude-opus-4-8`），下拉选择候选并确认，价格应用成功
- [ ] 终端实时统计的「估算费用」= 从 DB 加载的价格计算（非硬编码价格）
- [ ] 历史用量分析的「总费用」= 从 DB 加载的价格计算（非硬编码价格）
- [ ] 应用重启后，模型价格持久化有效（从 SQLite 重新加载）

---

## Definition of Done (Quality Bar)

- [ ] Rust 代码通过 `cargo check` 和 `cargo clippy`
- [ ] 前端代码通过 `npx tsc --noEmit`（无类型错误）
- [ ] 手动测试三个费用统计场景（终端实时 / ccusage / 历史分析）均正常
- [ ] migration v11 在全新 DB 和已有 v10 DB 上均能成功执行
- [ ] 同步功能在网络不可达时优雅降级（显示错误提示，不阻塞 UI）
- [ ] 更新 `CLAUDE.md` 的「最近变更」章节，记录价格表改造
- [ ] 硬编码常量保留为回退（注释标记 `// DEPRECATED: 仅作种子数据和回退，权威源为 model_prices 表`）

---

## Out of Scope (Explicit)

- ❌ 多币种支持（仅 USD）
- ❌ 自动后台同步价格（避免网络依赖与用户隐私担忧）
- ❌ 历史会话回溯重算费用（仅影响新查询）
- ❌ 覆盖 ccusage 工具的费用计算（保持其独立性）
- ❌ 批量导入/导出价格（CSV/JSON）- 后续需求再加
- ❌ 价格变更历史审计日志
- ❌ 按项目/会话自定义价格（全局统一定价）
- ❌ 单元测试（时间紧，手动测试为主；若有余力可补充 Rust 的 `model_prices_sync` 解析测试）

---

## Technical Notes

### 关键文件清单
- **前端价格逻辑**：`src/lib/modelPricing.ts:10-32`（硬编码表）、`:103-121`（calculateCost）
- **后端价格逻辑**：`src-tauri/src/commands/history.rs:3065-3220`（硬编码表）、`:3007-3054`（calculate_usage_cost）
- **SQLite migrations**：`src-tauri/src/lib.rs:19-172`（当前 v1-v10）
- **前端 DB 访问**：`src/lib/db.ts:6`（getDb 单例）
- **设置中心入口**：`src/components/SettingsModal.tsx:15,24,26,117`
- **历史统计类型**：`src/lib/types.ts:148,214-315`（HistorySessionUsage / HistoryStatsPayload 等，含 total_cost_usd / unpriced_tokens）

### 参考资料
- CPA-Manager-Plus 仓库研究报告（已完整分析数据模型、同步 URL、模糊匹配算法、费用计算公式）
- LiteLLM 同步源：`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
- OpenRouter 同步源：`https://openrouter.ai/api/v1/models`

### 约束
- 单位统一：USD / 1M tokens（与现有一致）
- 模型 ID 归一化：移除 `[1m]` 后缀、`us.anthropic.com/` 前缀、`(xhigh)` UI 后缀（复用现有 `normalizeModelId` 函数）
- 并发安全：后端全局缓存用 `RwLock`，支持多线程历史扫描时共享读锁
- 网络隔离：同步功能可选（不影响核心费用计算），失败时不阻塞 UI
