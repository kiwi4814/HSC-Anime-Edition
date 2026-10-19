# Fork 差异台账

本文件记录本地维护意图及相对官方代码的差异归属，不是发行说明。操作协议见 [upstream-sync.md](upstream-sync.md)；实际行为见 [动漫合集](../features/anime-collections/README.md) 与 [AI 分析](../features/ai-analysis/README.md)。

## 1. 来源与核对范围

| 项目 | 固定事实 |
|---|---|
| 官方仓库 | https://github.com/soderlund91/HomeScreenCompanion |
| 个人 Fork | https://github.com/kiwi4814/HSC-Anime-Edition |
| 本分支已集成上游提交 | `68024c17ef041fb486535c75384a42c3f59af1d0`（官方 main；不是“永远最新”的别名） |
| 本次源码审计提交 | `90e94b15c28a41dd25c04a43e80cf1349196c996`（develop；后续本轮只修改文档） |
| 固定开发基线 | `baseline-2026-10-18` |
| 上次远端检查 | 2026-10-18：`git ls-remote upstream refs/heads/main` 返回同一官方 SHA；未执行同步合并 |

审计快照相对官方为 **48 个差异路径：26 新增、22 修改，无删除**。这是上述两棵提交树的历史统计，不包含本轮新建维护文档，不作为会自动增长的当前计数。当前清单使用下面的文件行和目录覆盖规则；每次变更须重新对照 Git，不能只沿用此数字。

真实本地提交依次为：`62d3ad5`（导入 4.3.0.1）、`9a7ebfe`（第一轮 4.3.0.2）、`c46de63`（移除作品专属默认规则）、`47237da`（第二轮 AI/汉化）、`60ef252`（恢复官方 NuGet 源）、`90e94b1`（验证开发基线）。导入提交是当时记录的快照，不伪装成原始逐步开发史。

## 2. 本地新增生产代码

以下路径均相对固定上游为新增；当前没有要求上游采用这些实现。

| 路径 | 本地意图 | 同步时保留/复核 |
|---|---|---|
| `HomeScreenCompanion/AnimeMappingIndex.cs` | 解析 AniBridge v3 提供商身份映射 | 电影/剧集类型隔离、季身份折叠、跳过剧集范围正文 |
| `HomeScreenCompanion/AnimeRelations.cs` | 本地媒体/关系模型与确定性候选组规划 | 安全关系集合、分支待审查，不把 OTHER 当确定关系 |
| `HomeScreenCompanion/AnimeGraphExpansion.cs` | 有预算的关系图扩展 | 两跳/节点/请求边界、取消、部分图不能冒充完整图 |
| `HomeScreenCompanion/AnimeAniListClient.cs` | AniList GraphQL 与关系缓存 | 请求/身份校验；真实服务未由离线测试验收 |
| `HomeScreenCompanion/AnimeCollectionPolicy.cs` | 精确成员、批准、别名、身份和重复诊断 | 排除优先、完整替代、无默认作品规则、写入门槛 |
| `HomeScreenCompanion/AnimeCollectionMembership.cs` | 维护已管理成员集合 | 只追踪插件管理成员，保留人工成员 |
| `HomeScreenCompanion/AnimeCollectionTask.cs` | 扫描、映射、规划、审批后调用 Emby 合集 API | 动漫独立开关/Dry Run、归属保护、失败不清空合集 |
| `HomeScreenCompanion/AiRequestClient.cs` | 五种 provider 共用 HTTP 传输 | 超时/取消、体积边界、禁重定向、脱敏错误 |
| `HomeScreenCompanion/AiResponseDtos.cs` | 统一 provider 响应 DTO | 是响应模型单一归属；不要在旧 DTO 文件重建重复类 |
| `HomeScreenCompanion/AiSecretPolicy.cs` | 密钥导出清空、空导入保留 | 覆盖实际导出/导入调用点，而非只保留 helper |
| `HomeScreenCompanion/AnimeAiAnalysisService.cs` | 命名、结构化审查、OTHER 辅助及映射检索建议 | 默认关闭、共用预算/缓存、输入输出校验、仅建议 |

## 3. 修改过的官方生产文件

“主要汉化”表示在本次固定差异中未见实质业务流程改动，不表示已经验证官方所有功能或未来可机械取任一方。

| 官方路径 | 相对官方的本地改动 | 冲突重点 |
|---|---|---|
| `HomeScreenCompanion/Plugin.cs` | 独立插件 GUID/名称/设置页资源名 | Fork 身份与事件/合集镜像行为共同保留 |
| `HomeScreenCompanion/HomeScreenCompanion.csproj` | 独立程序集/产品名、4.3.0.3、PathMap、外置 EmbyReferenceDir；移除旧绝对引用和构建时 HTML 版本注入 | 不还原官方程序集身份，不引入机器路径 |
| `HomeScreenCompanion/PluginConfiguration.cs` | Compatible AI 与动漫配置、空默认策略、独立预算 | 新装默认与已有配置/旧备份分别处理 |
| `HomeScreenCompanion/Configuration/configPage.html` | 新动漫/AI 控件、独立 controller、广泛汉化 | ID、控件绑定及技术标识；页面仍有指向官方 Issues 的链接 |
| `HomeScreenCompanion/Configuration/configPage.js` | Fork GUID/请求路径、动漫加载保存与校验、AI 测试/建议展示、版本查询替代更新器及汉化 | 大面积字符串差异中夹有逻辑；不能整文件取上游 |
| `HomeScreenCompanion/HomeScreenCompanionService.cs` | 大部分路由隔离、AI Admin 接口、备份 v3/密钥语义与汉化 | 路由、DTO、处理器、配置往返必须一起审查 |
| `HomeScreenCompanion/DTOs.cs` | 删除重复 provider 响应类，转由新增文件持有 | 部分旧路由仍在；见下方已知缺口 |
| `HomeScreenCompanion/ListFetcher.cs` | 移除各 provider 的重复 HTTP helper，改用共享客户端 | 既有列表选择仍沿用；共同超时/令牌上限改变旧路径语义 |
| `HomeScreenCompanion/ServerEntryPoint.cs` | 禁止调用旧 AutoTag 自动迁移，另有日志汉化 | 防止迁移/删除其他插件数据；保留现有监听及镜像逻辑 |
| `HomeScreenCompanion/HomeScreenCompanionTask.cs` | 主要汉化状态/日志及格式 helper 调用 | 大文件与状态前缀/计数调用；不丢失原同步逻辑 |
| `HomeScreenCompanion/RunLog.cs` | 中文耗时格式、`Plural(count, unit)` 签名；`[DEBUG]` 标记与各任务的服务器日志前缀保持官方英文 | 前端日志着色按 `[DEBUG]`、✔⚠✖– 与标题文本（`结果`/`汇总`/`[Cleanup]` 等）识别，改日志标题须同步 `configPage.js` 的 `renderLogLines` |
| `HomeScreenCompanion/ContinueWatchingBumpEntryPoint.cs` | 日志汉化 | 事件、去抖与处理逻辑保持 |
| `HomeScreenCompanion/ContinueWatchingBumpTask.cs` | 任务显示名/描述/日志汉化 | 原内部 Key/调度保持 |
| `HomeScreenCompanion/ContinueWatchingBumper.cs` | 提示/结果日志汉化 | 原 LastPlayedDate 与 Dry Run 行为保持 |
| `HomeScreenCompanion/HomeSectionSyncTask.cs` | 任务显示文案/日志汉化 | 原 Key 与触发行为保持 |
| `HomeScreenCompanion/LibraryAccessManager.cs` | 权限同步日志汉化 | 延迟权限同步逻辑保持 |
| `HomeScreenCompanion/MergeTopListVersionsTask.cs` | 任务显示文案/日志与计数汉化 | 合并、探测与镜像调用保持 |
| `HomeScreenCompanion/ShowTopList.cs` | 日志汉化 | 原目录/清单/文件生成行为保持 |
| `HomeScreenCompanion/TopListCollectionMirror.cs` | 镜像增删/同步日志汉化 | 状态锁、去抖、归属与事件处理保持 |
| `HomeScreenCompanion/TopListSyncTask.cs` | 任务显示文案/权限/同步日志汉化 | 原 Key、权限协调与排除行为保持 |

### 身份与兼容边界

- Fork 插件 GUID：`b5bca829-e903-4af4-9fb2-451d72a487e6`；程序集：`HomeScreenCompanionAnimeEdition`；页面资源：`HomeScreenCompanionAnimeEdition` / `HomeScreenCompanionAnimeEditionJS`。
- 相对官方 GUID 与主要 API 前缀已经改变，**不是官方配置可无条件原位接管**。后续维护应保留的是既有 Anime Edition 身份与兼容性。
- 主服务使用 `/HomeScreenCompanionAnime/`，但还存在下面登记的旧 DTO 路由，不宣称全部完成隔离。
- 原有任务 Key 保留；新动漫任务 Key 为 `HscAnimeEditionCollections`。显示名翻译不等于内部 Key 迁移。
- `ServerEntryPoint.Run()` 不调用 `RunAutoMigration()`；方法仍在源码，不意味着允许重新启用。

## 4. 验证、构建与文档差异

| 路径 | 归属/维护意图 |
|---|---|
| `verification/Program.cs` | 确定性行为、配置/缓存兼容及独立预览入口 |
| `verification/AiAnalysisTests.cs` | AI 候选、校验、预算、缓存、取消与密钥策略 |
| `verification/AiHttpTests.cs` | OpenAI-compatible localhost HTTP；不是所有 provider 的真实验收 |
| `verification/AiMetadataOnlyTests.cs` | 无图边时的显式组建议与身份边界 |
| `verification/LocalHttpMock.cs` | 离线 loopback 测试基础设施 |
| `verification/AnimeEdition.SmokeTests.csproj` | net8.0 控制台与生产文件链接；不直接链接真实 Emby 任务/AniList 客户端 |
| `verification/check_static.py` | XML/源码集成/JS 语法，不是浏览器或 HTTP 认证验收 |
| `NuGet.Config` | 官方 NuGet feed，清洁环境可还原依赖 |
| `.gitignore` | 本地产物和 Windows 下载元数据排除；不整体隐藏本地任务 |
| `README.md` | Fork 入口与开发基线说明，保留官方功能介绍 |
| `ANIME_EDITION.md` | 动漫版入口，详细当前行为转向功能文档 |
| `OMP_LOCAL_HANDOFF.md` | 可执行构建与离线验证入口，不是生产授权 |
| `TEST_REPORT.md` | 按日期保留实际验证结果，不重标旧日志为当前结果 |
| `CHANGELOG_4.3.0.2.md` | 早期版本变化的历史记录 |
| `LOCAL_VERIFICATION.json` | 早期 4.3.0.2 产物/环境证据，非当前验收 |
| `SOURCE_MANIFEST.json` | 早期交付清单，非当前文件清单 |
| `HSC-Anime-Edition-Code-Review-2026-10-18.md` | 当时附件审查结论，非当前生产放行 |

本轮新增的治理路径由以下规则覆盖：`AGENTS.md`（代理入口）、`CONTEXT.md`（领域词汇）、`docs/README.md`（导航）、`docs/agents/*.md`（Matt 消费配置）、`docs/fork/*.md`（本台账和同步协议）、`docs/features/*/README.md`（当前功能事实）、`docs/changes/archive/*/summary.md`（已验证变化）。新增其他目录或源码文件必须显式扩充归属；不能用“所有 docs”掩盖未知功能。`.scratch/<feature>/spec.md` 与 `.scratch/<feature>/issues/*.md` 是按需创建的本地工作产物，不计作生产功能。

## 5. 已知缺口与验证边界

1. **设置备份漏三项合集策略**：当前结果与迁移风险见 [动漫合集：备份限制](../features/anime-collections/README.md#备份限制)。本次不修业务代码。
2. **部分前端/DTO 路由前缀不一致**：`DTOs.cs` 的 `Hsc/UserSections` GET/POST、`Hsc/ApplyTagHomeSections`、`TestAiSource` 仍声明 `/HomeScreenCompanion/...`，而 `configPage.js` 请求 `/HomeScreenCompanionAnime/...`。这是源码核对发现，不宣称已实测 404；需要真实路由验证与一致性修复。`Hsc/SectionSchema`、`Hsc/DebugMethods` 声明同样保留旧前缀，集成时一并核对。
3. **反馈目标未随开发工作流迁移**：设置页中的 Issues 链接仍指官方仓库。本地 Markdown 是开发任务跟踪选择，不会自动重定向产品 UI；不把 Fork 特有问题直接归给官方。
4. **旧 AI 列表语义变化**：共享请求客户端统一超时与上限；未验证所有真实 provider，不宣称与旧 Ollama 等路径完全等价。
5. **编译与运行证据有边界**：源码基线曾重建成功，296 条离线断言通过，但插件有 107 条编译警告。无本轮 Emby 加载、配置 HTTP、真实写入、持久化、浏览器或真实 AI 供应商验收。具体命令及当时结果见 `TEST_REPORT.md`；本次文档审计不重新制造生产证据。

## 6. 何时更新本文件

新增本地功能、改官方文件、删除/替代本地实现、改变身份/配置/外部接口、同步上游或完成新验证时，在同一变更集更新相关行与引用。若只有文档组织变化，保留源码审计提交并说明本轮无源码变化；不要为了写当前文档而循环引用尚未产生的自身提交 SHA。

每次同步记录：原已集成 SHA、目标 SHA、最终实际合入 SHA、冲突文件、保留/删除的差异、验证证据及未验证范围。历史细节进入归档，当前表只保留仍成立的维护意图。
