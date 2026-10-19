# 动漫合集：当前行为

## Purpose

在既有 HSC 中增加基于本地媒体、AniBridge 映射与 AniList 关系的确定性候选分组，并在显式审批后维护插件自己的合集。候选组不等于现实作品系列的完整全集；[领域词汇](../../../CONTEXT.md) 区分映射、候选、批准与归属。

## Current behavior and rules

- 默认 `AnimeEnabled=false`、`AnimeDryRun=true`、包含 SPIN_OFF；成员规则、批准名单、别名均默认空。任一全局或动漫 Dry Run 开启时不写合集/归属状态；缓存和日志仍可写。
- 本地 Movie/Series 经带类型提供商 ID 映射到 AniList；Series 是完整条目，规则排除其任一季对应身份时排除整个 Series，不按季拆分。
- `SEQUEL`、`PREQUEL`、`SIDE_STORY`、`PARENT` 及可选 `SPIN_OFF` 可连接候选组。`OTHER` 等关系不自动建立确定性合集关系；AI 只返回建议。
- 关系扩展受请求/节点预算、两跳与缓存新鲜度限制。不完整图、失败请求或未知映射不能冒充完整关系后清空已有合集。
- 自动分支/歧义组要求明确成员规则，即使批准也不能绕过。关闭 SPIN_OFF 不等于已经解决全部主线分支。
- 真正写入同时要求：两项 Dry Run 都关闭、至少两个本地成员、精确合集键已批准、分支已处理、身份/归属/拆分检查通过。
- 人工合集不按同名或重叠成员接管；已有归属 ID 缺失时不认领同名替代品；名称/别名冲突时跳过。
- 明确规则或批准的重新归组可移除插件以前管理且本次不再允许的成员；人工追加成员不移除、不自动纳入管理。任务没有删除合集的操作。
- 重复媒体按带类型 TMDb/TVDb/IMDb 身份报警，不删除、合并或修改媒体。共享 AniList 季身份不等于 Provider ID 重复。

## Configuration contracts

设置页的“动漫合集”面板读写以下策略。示例均为虚构 ID/名称，不是生产批准名单。

### 明确成员规则

`AnimeCollectionRulesJson` 是严格 JSON 数组：

```json
[{"Key":"anilist:1900000101","IncludeIds":["anilist:1900000101","anilist:1900000102","anilist:1900000103"],"ExcludeIds":["anilist:1900000103"]}]
```

- Key 为规范 `anilist:<正 Int32>`，无前导零。允许的身份类型是 `anilist`、`tmdb_movie/show`、`tvdb_movie/show`、`imdb_movie/show`，电影和剧集隔离。
- IncludeIds 是完整精确选择，不是追加。条目任一身份匹配即可选中；ExcludeIds 匹配任一身份优先排除。
- 相关自动连通分量由显式选择整体替代，不让遗漏成员从剩余自动组回流。
- 可通过已知 Provider ID 选择未映射 AniList 的本地条目；未知 ID 不创建虚构媒体。
- 不同规则选中同一条目、重复 Key、错误 JSON、未知字段等在写入前拒绝。
- 少于两项只保留预览，不清空或删除既有合集。

### 合集批准名单

`AnimeApprovedCollectionKeys` 每行一个精确 Key，无通配符、名称批准或自动批准：

```text
anilist:1900000101
anilist:1900000104
```

预览输出候选 Key 与阻断原因。自动锚点变化导致新 Key 时须重新批准，别名不能代替批准。

### 合集别名

`AnimeCollectionAliasesJson` 为 Key 到显示名的对象：

```json
{"anilist:1900000101":"星桥纪事","anilist:1900000104":"雾港"}
```

无作品专属内置别名。别名仅用于新建合集；已有合集保留原名，未验证的 Emby 重命名 API 不自动调用。


### P4 策略与 AI 归位

- `AnimeSkipWriteWhenReminders`（默认 `false`）：开启后，本趟同步为某合集产生提醒时跳过该合集写入；其它合集照常。不削弱默认全自动写入。
- OpenAI 兼容接口（BaseURL / 模型 / 密钥）仅在「设置 → AI 设置」；动漫面板只保留「要不要出建议」开关与供应商选择，共用 `CompatibleAi*` 字段。
- 命名提醒可一键「采用建议显示名」→ 写入 `AnimeCollectionAliasesJson`；不自动改已有 Emby 合集名。
- 备份分区 `AnimeReminders`（BackupVersion ≥ 4）保存提醒与已处理标记；旧备份仍可读。

## Data and interfaces

任务内部 Key 为 `HscAnimeEditionCollections`，显示名“动漫合集同步”，分类“Home Screen Companion 动漫版”，默认每日 05:00。动漫任务与已有 HSC 任务独立。

在插件数据目录的 `anime/` 下维护：

| 产物 | 职责 |
|---|---|
| `anibridge-v3.json` | 验证后的映射缓存，默认每七天刷新 |
| `anime-anilist-relations.json` | AniList 关系缓存，任务使用 14 天新鲜度 |
| `owned-collections.json` | 已管理 CollectionId/Anchor/Name/ManagedItemIds |
| `last-run-summary.json` | 上次同步摘要：计数、合集/预览卡片、**提醒列表**（P1）。界面「提醒 N」、卡片黄点、提醒区块都读这里；不另建 `reminders.json` |
| `ai-analysis.json` | 可选的 AI 建议报告，详见 [AI 分析](../ai-analysis/README.md) |

任务日志通过 LogStore（key=`anime`）持久化，设置页「日志」弹窗的「动漫」选项卡与 `/HomeScreenCompanionAnime/Anime/Status` 可读。旧 `anime-ai-decisions.json` 不是当前 AI 分析服务的活动报告；兼容 DTO/离线哨兵仍存在，不把旧文件名当成新缓存格式。

### 同步提醒（P1）

同步结束写入 `anime/last-run-summary.json`（字段 `ReminderItems` + 计数 `Reminders`）。同 Id 去重更新，保留用户「已处理」标记。

| Type | 界面文案 | 来源 |
|---|---|---|
| `branch` | 系列结构复杂 | `ReviewRequired`（无明确成员规则时） |
| `cross_ip` | 可能混进其它作品 | AI `ReviewIssues`（有则接，无则不造） |
| `duplicate` | 片源重复 | 组内多成员共享 Provider 身份；或 AI duplicate |
| `naming` | 名称不太合适 | AI 命名建议 |
| `missing_local` | 库里可能还缺 | AI `missing_local` |
| `cannot_write` | 没法写入 | 跳过/冲突等人话原因 |

有提醒的合集**默认仍写入**。只读 `GET .../Anime/LastRunSummary`；`POST .../Anime/Reminders/Handled` 切换已处理。「去处理」与合集卡片点击打开 **合集编辑** 子视图（P2）：改显示名称、勾选/搜索添加成员、保存或改回自动归类。

### 合集可视编辑（P2）

主路径子视图（非 JSON 弹窗）：

- **显示名称** → 写入 `AnimeCollectionAliasesJson`（界面不说别名表）；已有 Emby 合集不会自动改名，别名主要影响新建与界面展示。
- **成员勾选/搜索添加** → 保存时写成该合集的精确 `IncludeIds` 规则（`AnimeCollectionRulesJson`）；若批准名单非空则自动补上该 Key。
- **改回自动归类** → 删除该合集的手工成员规则，别名保留；下次同步再走自动分组。
- 保存或改回自动时可把该合集相关提醒标为已处理。

API（Admin）：`GET .../Anime/CollectionEditor`、`GET .../Anime/MediaSearch`、`POST .../Anime/CollectionEditor/Save`、`POST .../Anime/CollectionEditor/ClearRule`。

### 手动同步：预览确认框

- 「立即同步」**始终**先跑仅预览（不写库），再打开「确认创建」面板：一张清单列出本次全部候选；每行可改名 / 废弃；吃不准的行加黄标 + 人话原因（不挡一键创建）。可选筛选「全部 / 吃不准」，默认全部。
- 「一键创建」成功后关掉清单，弹出短结果「新建 N · 更新 M」，并刷新合集一览与上次状态。
- 计划任务直接写入全部候选（仅受全局「仅预览」约束）；手动仍走预览→清单→创建。
- 废弃写入 `AnimeDiscardedCollectionKeys`（可附带显示名；界面只显示名、不展示内部 Key）；之后预览与写入都跳过。设置 → 动漫合集里可查看「已废弃的合集」并恢复。
- API（Admin）：`POST .../Anime/ManualPreview`、`POST .../Anime/Discard`、`GET .../Anime/Discarded`、`POST .../Anime/Restore`、`POST .../Anime/ConfirmCreate`。

编辑合集子视图**不再**提供关系图 UI；成员仍用勾选列表。

### 合集 Key 稳定性与归属恢复

- 合集 Key 仍为 `anilist:{Anchor}`。`Anchor` 取连通分量中**本地媒体 ∪ AniList 关系扩展节点**的最小 AniList ID（不再仅取库内最小 ID），避免补更早一季后 Key 悄悄变化。
- 若归属记录与候选成员有交集但 Anchor 不同，同步时**沿用归属中的 Anchor**（粘滞），已批准的 Key 继续有效。
- 仅批准、从未成功写入（无归属）的配置，若图内 min 与旧「仅本地 min」不同，升级后可能需改批准名单/别名一次；日志会提示。
- 归属指向的 Emby 合集已不存在时，自动清除该归属行；若 Key 仍在批准名单中，将按新建处理。同名其他合集仍跳过，不会自动认领。

### 跳过原因与预览成员

- 跳过日志区分：未在批准名单 / 成员不足两部 / 系列有分支需明确成员规则。
- 开启「包含衍生作品」时，仅因 SPIN_OFF/SIDE_STORY/PARENT 不再强制要求 JSON 规则；`ALTERNATIVE*` 与续作/前作分叉仍要求。
- 预览/写入日志用 `Detail` 列出成员片名（最多 20）；Emby ID 仅在扩展日志（DEBUG）。

### AniList 配额与上限

- 默认每次最多新增 **300** 次 AniList 请求（设置页可调 10–600）；请求间隔约 2.1 秒。
- AniList 关系扩展节点硬上限 **8000**；触顶时状态为「失败：作品关系超过上限」，不会写入合集。
- 配额用尽时状态为「等待：AniList 请求配额已用完，请再次运行」，可再次运行继续灌缓存。
- 关系缓存新鲜度仍为 **14 天**（本批未改）。
- 对 AniList 的 429/5xx/超时最多重试 3 次（退避 5s→15s→45s，尊重 Retry-After，上限约 120s）。

Anime Edition 身份与官方插件不同；后续保持既有 Fork GUID、程序集、页面名和接口边界，详见 [差异台账](../../fork/delta.md)。旧 Anime Edition 配置缺少三项策略时按空值加载，不自动批准。

### 备份

勾选「设置」导出/导入时，备份格式为 **v5**，设置区含规则/批准/别名/`AnimeDiscardedCollectionKeys`；v4 及更旧备份仍可读，缺字段时保留目标机现值。`owned-collections.json`（合集归属）**仍不在**设置备份中；换机后需重新预览/批准。可选 `AnimeMappingUrl` 写入插件配置（随设置备份）；留空使用内置 AniBridge GitHub 地址。

## Code and test entry points

- [AnimeCollectionTask.cs](../../../HomeScreenCompanion/AnimeCollectionTask.cs)：扫描、映射下载、规划与 Emby 写入协调。
- [AnimeMappingIndex.cs](../../../HomeScreenCompanion/AnimeMappingIndex.cs)、[AnimeAniListClient.cs](../../../HomeScreenCompanion/AnimeAniListClient.cs)、[AnimeGraphExpansion.cs](../../../HomeScreenCompanion/AnimeGraphExpansion.cs)：身份与关系数据。
- [AnimeRelations.cs](../../../HomeScreenCompanion/AnimeRelations.cs)、[AnimeCollectionPolicy.cs](../../../HomeScreenCompanion/AnimeCollectionPolicy.cs)、[AnimeCollectionMembership.cs](../../../HomeScreenCompanion/AnimeCollectionMembership.cs)：确定性规划及安全策略。
- [AnimeCollectionEditorSupport.cs](../../../HomeScreenCompanion/AnimeCollectionEditorSupport.cs)：可视编辑改写与废弃名单（P2 / 预览确认）。
- [PluginConfiguration.cs](../../../HomeScreenCompanion/PluginConfiguration.cs)：真实默认值；[Program.cs](../../../verification/Program.cs)：映射、关系、规则、归属、配置兼容与预览。

## Operations and troubleshooting

本地扫描除 TMDb/TVDB/IMDb 外，也会读取媒体上的 AniList 编号。映射来自 [AniBridge v3](https://github.com/anibridge/anibridge-mappings)，关系来自 [AniList](https://docs.anilist.co/)。检查任务日志的候选 Key、批准/分支/身份阻断及缓存失败；不要用关闭 Dry Run 来修复未知归类。

编译和离线运行入口见 [本地验证](../../../OMP_LOCAL_HANDOFF.md)。离线控制台不链接真实 `AnimeCollectionTask` 或 `AnimeAniListClient`，不验证 Emby API、真实下载、认证、任务并发或部分写入回滚。本轮仅建立文档，没有新的真实服务器验收。

相关历史：[维护文档初始化](../../changes/archive/2026-10-18-fork-maintenance/summary.md)。
