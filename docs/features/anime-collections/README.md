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

设置页的动漫 IP 合集区读写以下策略。示例均为虚构 ID/名称，不是生产批准名单。

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

## Data and interfaces

任务内部 Key 为 `HscAnimeEditionCollections`，显示名“动漫 IP 合集同步”，默认每日 05:00。动漫任务与已有 HSC 任务独立。

在插件数据目录的 `anime/` 下维护：

| 产物 | 职责 |
|---|---|
| `anibridge-v3.json` | 验证后的映射缓存，默认每七天刷新 |
| `anime-anilist-relations.json` | AniList 关系缓存，任务使用 14 天新鲜度 |
| `owned-collections.json` | 已管理 CollectionId/Anchor/Name/ManagedItemIds |
| `ai-analysis.json` | 可选的 AI 建议报告，详见 [AI 分析](../ai-analysis/README.md) |

任务日志还通过现有 LogStore 持久化。旧 `anime-ai-decisions.json` 不是当前 AI 分析服务的活动报告；兼容 DTO/离线哨兵仍存在，不把旧文件名当成新缓存格式。

Anime Edition 身份与官方插件不同；后续保持既有 Fork GUID、程序集、页面名和接口边界，详见 [差异台账](../../fork/delta.md)。旧 Anime Edition 配置缺少三项策略时按空值加载，不自动批准。

### 备份限制

`HomeScreenCompanionService.cs` 的 `BackupSettings`、设置导出和导入尚未包含 `AnimeCollectionRulesJson`、`AnimeApprovedCollectionKeys`、`AnimeCollectionAliasesJson`。新实例恢复会遗漏这些值，既有实例恢复会保留目标实例原值；不能把插件设置备份当作完整策略迁移。恢复后保持 Dry Run，逐项核对三项策略。后续修复须覆盖三字段往返和旧备份缺字段兼容，本次仅记录。

## Code and test entry points

- [AnimeCollectionTask.cs](../../../HomeScreenCompanion/AnimeCollectionTask.cs)：扫描、映射下载、规划与 Emby 写入协调。
- [AnimeMappingIndex.cs](../../../HomeScreenCompanion/AnimeMappingIndex.cs)、[AnimeAniListClient.cs](../../../HomeScreenCompanion/AnimeAniListClient.cs)、[AnimeGraphExpansion.cs](../../../HomeScreenCompanion/AnimeGraphExpansion.cs)：身份与关系数据。
- [AnimeRelations.cs](../../../HomeScreenCompanion/AnimeRelations.cs)、[AnimeCollectionPolicy.cs](../../../HomeScreenCompanion/AnimeCollectionPolicy.cs)、[AnimeCollectionMembership.cs](../../../HomeScreenCompanion/AnimeCollectionMembership.cs)：确定性规划及安全策略。
- [PluginConfiguration.cs](../../../HomeScreenCompanion/PluginConfiguration.cs)：真实默认值；[Program.cs](../../../verification/Program.cs)：映射、关系、规则、归属、配置兼容与预览。

## Operations and troubleshooting

映射来自 [AniBridge v3](https://github.com/anibridge/anibridge-mappings)，关系来自 [AniList](https://docs.anilist.co/)。检查任务日志的候选 Key、批准/分支/身份阻断及缓存失败；不要用关闭 Dry Run 来修复未知归类。

编译和离线运行入口见 [本地验证](../../../OMP_LOCAL_HANDOFF.md)。离线控制台不链接真实 `AnimeCollectionTask` 或 `AnimeAniListClient`，不验证 Emby API、真实下载、认证、任务并发或部分写入回滚。本轮仅建立文档，没有新的真实服务器验收。

相关历史：[维护文档初始化](../../changes/archive/2026-10-18-fork-maintenance/summary.md)。
