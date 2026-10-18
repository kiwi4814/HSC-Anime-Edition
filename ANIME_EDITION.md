# HSC Anime Edition 4.3.0.3

保留官方 HSC 历史及两轮本地增量修改；沿用 AniBridge Mappings v3、AniList 和 Emby 原有合集实现。未引入数据库、后台服务或新运行依赖。

## 本地验证边界

当前 4.3.0.3 开发基线已使用 .NET SDK 10.0.402 和已有 Emby 4.10.1.0 编译参考重新完成 Release 构建、296 条离线行为/兼容性断言、离线预览和 JavaScript/静态检查。回归程序在 .NET 8.0.32 运行。本轮未连接生产服务器，未验证新 DLL 在 Emby 中的加载或真实集合写入。4.3.0.1 的生产验收不能代替新版本验收。

## 安全默认

- `AnimeEnabled`、`AnimeDryRun`、原版 HSC 配置默认值均保持兼容。
- 新字段 `AnimeCollectionRulesJson`、`AnimeApprovedCollectionKeys`、`AnimeCollectionAliasesJson` 默认空字符串。
- 任一全局/动漫 Dry Run 开启时均不写合集或 `owned-collections.json`。
- 即使关闭两项 Dry Run，批准名单为空也不允许任何合集/归属写入。
- 分支歧义自动分组即使已批准，仍须明确成员规则才能写入。不能把关闭 SPIN_OFF 理解为严格主线。
- 重复媒体仅按带类型的 TMDb/TVDb/IMDb ID 报警，不删除、合并、过滤或修改媒体。同一 Emby Series 和剧场版共享 AniList 季身份不算 Provider ID 重复。
- 原有人工合集永不按名称/重叠成员接管。新名字/别名与他人合集冲突时跳过。

## 配置入口与格式

HSC Anime Edition → 设置 → 动漫 IP 合集。第二轮扩展了原版 HSC 页面的简体中文文案；不代表已完成人工全量翻译验收。任务显示名为“动漫 IP 合集同步”；内部 Key 始终是 `HscAnimeEditionCollections`，每天 05:00 的既有触发方式不变。

### 明确成员规则

`AnimeCollectionRulesJson` 是数组。例如下例仅说明格式与排除优先，使用虚构 ID，不是可直接投入生产的名单：

```json
[{"Key":"anilist:1900000101","IncludeIds":["anilist:1900000101","anilist:1900000102","anilist:1900000103"],"ExcludeIds":["anilist:1900000103"]}]
```

- Key 必须是规范 `anilist:<正 Int32>`，不能有前导零；显式规则固定 Key，不依赖中文标题。
- IncludeIds 是完整精确选择，不是对自动成员的追加。匹配本地条目的任一个 ID 即可选择该条目；ExcludeIds 匹配任何 ID 均优先排除该条目。
- 支持 `anilist`、`tmdb_movie`、`tmdb_show`、`tvdb_movie`、`tvdb_show`、`imdb_movie`、`imdb_show`。电影和剧集类型隔离。
- Series 是一个整体条目：若其多季 ID 中任何一项被排除，排除整个 Series，不拆分季。
- 被规则提及的自动连通分量整体被显式选择替代，避免遗漏成员又从残留自动组回流。
- 规则可选择有 Provider ID 但未映射 AniList 的本地条目。未知 ID 不生成虚构媒体。
- 不同规则选中同一实际媒体、重复 Key、错误 JSON 或未知字段，在任何集合写入前中止。
- 规则选中不足两项时只保留预览，不清空或删除既有合集。显式规则只移除本插件以前管理、当前不再允许的成员，不移除人工追加成员。

排除可疑自动归类时，用核实后的稳定 ID 配置 `ExcludeIds`；规则结果不足两项时不写入。不要靠标题改名猜测作品 ID。

### 合集级批准名单

`AnimeApprovedCollectionKeys` 每行一个 Key。无通配符、无名称匹配、无自动批准。例如：

```text
anilist:1900000101
anilist:1900000104
```

预览会输出 Key、候选及未获批/需复核原因。只有获批且无未解决分支歧义、至少两项成员、无身份冲突的组才有资格写入。Dry Run 始终优先。自动分组的最小本地 AniList Anchor 若改变，新 Key 必须重新批准。

### 中文别名

`AnimeCollectionAliasesJson` 是稳定 Key 到显示名称的 JSON 对象：

```json
{"anilist:1900000101":"星桥纪事","anilist:1900000104":"雾港"}
```

上述为虚构格式示例；生产默认别名为空，无作品专属内置规则。别名不改变身份、成员或批准状态。现有合集保留现名；因未验证 Emby 重命名 API，本版不自动重命名已创建合集。日志会明确提示。

## 兼容性与缓存

插件 GUID 保持 `b5bca829-e903-4af4-9fb2-451d72a487e6`，程序集名称及 `/HomeScreenCompanionAnime/` 路由不变。`anibridge-v3.json`、`anime-anilist-relations.json`、`anime-ai-decisions.json` 的格式不变；`owned-collections.json` 的 CollectionId/Anchor/Name/ManagedItemIds 结构不变，无新身份旁路文件。旧 XML/JSON 配置缺少三个新字段时以空值加载，因此升级后真实写入默认被批准门槛拦截。

新模块仍会读写映射、关系缓存和任务日志；Dry Run 不是整个文件系统只读。关系图不完整、请求失败或无本地映射时不会据此删除媒体或清空合集。

**设置备份限制**：`BackupSettings` 及设置导出/导入尚未包含 `AnimeCollectionRulesJson`、`AnimeApprovedCollectionKeys`、`AnimeCollectionAliasesJson`。在新实例恢复会遗漏这些策略，在既有实例恢复会保留目标实例原有策略；不要把插件设置备份当作完整策略备份，恢复后保持 Dry Run 并逐项核对。见 `HomeScreenCompanionService.cs` 的备份 DTO、`ExportBackupRequest` 与 `ImportBackupRequest` 处理路径。

## 构建与离线检查

参见 `OMP_LOCAL_HANDOFF.md`。源码包不附带 SDK、NuGet 包或 Emby 私有参考 DLL；使用本机已有工具和匹配的只读编译引用。部署、停止/重启 Emby 或首次真实同步均是独立决策，本交付不执行。

许可证及上游信息见 `LICENSE`、`README.md`。AniBridge：https://github.com/anibridge/anibridge-mappings；AniList：https://docs.anilist.co/。
