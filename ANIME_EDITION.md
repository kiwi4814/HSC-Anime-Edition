# HSC Anime Edition — 使用与维护指南（源码交付）

基线：Home Screen Companion `68024c17ef041fb486535c75384a42c3f59af1d0`，上游 `4.3.0.0`。
此源码把插件内部版本设置为 `4.3.0.1`（**非上游正式发布版本**）。

> **状态边界**：这是可用于本地编译与验收的完整源码；尚未获得目标 Emby 服务器匹配的三份 MediaBrowser DLL，因此 **没有证据证明已经成功编译或可在真实 Emby 启动运行**。请执行 `OMP_LOCAL_HANDOFF.md` 中的本地编译、烟雾测试和隔离环境测试。不要把未验收的 DLL 直接放入生产插件目录。

## 1. 做了什么

- 保留官方 HSC 的规则、标签、合集、动态列表、首页、播放列表、AI 列表和 Web 设置功能。
- 独立计划任务 `Anime IP Collection Sync`：由服务器每天 05:00 触发（启用前不会操作合集），也可在 Emby Dashboard 的 Scheduled Tasks 手动执行。
- 使用 [AniBridge Mappings v3](https://github.com/anibridge/anibridge-mappings/releases/tag/v3) 将 Emby 已存在的 TMDb/TVDb/IMDb 电影/电视剧 ID 关联到 AniList 动画 ID。无需安装 AniBridge 服务；每 7 天自动更新映射并验证完整性。
- 通过 AniList GraphQL 拉取明确的 `SEQUEL`、`PREQUEL`、`SIDE_STORY`、`PARENT`、`SPIN_OFF` 等动画关系并做图分组；只创建本地有至少两项媒体的合集。`OTHER`、`ADAPTATION`、`CHARACTER` 等默认不合并。
- 可以选用已配置的 OpenAI/Gemini/Claude/Ollama 对**两部本地已识别动漫之间的 AniList OTHER 关系**作保守复核。AI 不能创造 AniList ID、修改匹配源，不启用则零 AI 开销。
- 自动对“动漫 · ”前缀的新合集进行增量管理；不会采集影片内容、改写 `.strm`、下载视频或触发 Emby 全库扫描。
- 单独的 Anime Dry Run 默认打开。即使关闭该开关，只要 HSC 全局 Dry Run 打开，仍禁止本模块写入。

## 2. 重要设计限制

1. AniBridge Mappings 是**身份映射**，不是完整“动漫 IP 合集名单”。来源没有映射或 AniList 缺少关系的作品可能漏掉。不能保证 100% 自动归类。
2. 关系图的扩展深度为本地种子向外最多两跳；超过请求预算时中止本轮写入并保留缓存，需下次继续执行（首次整理大库尤其如此）。
3. Emby Series 是一个媒体实体，可能包含多个季度；本模块只把 Series / Movie 加入合集，不会逐集加入或改动 Season 0 组织方式。
4. 默认将已明确标注的 `SPIN_OFF` 纳入同一系列。若《Fate》等复杂 IP 被并入过大的总合集，可在设置里关闭该开关；选择关系规则不会得到完美的系列划分。
5. 仅使用 Emby 原有名称推导合集名（优先中文字及共同前缀）。这比任意编造“官方中文 IP 名”更可控，但不一定最美观；已有合集可以在 Emby 手动美化名字和封面，插件管理权以集合 ID 追踪。
6. 不自动删除已创建的合集；既有**人工合集不会被认领**，人工追加的合集成员不会被批量移除。映射失效/网络错误只保留旧数据；重新确认归属到其他 IP 时才可能移除本插件曾管理的旧成员。
7. `AI` 仅复核 AniList 已存在的 `OTHER` 边，**不会对无映射作品做开放式网络搜索或凭空分组**。这属于安全性优先的 V1 边界。
8. 本版未实现一键撤销变更的 Emby 后台按钮。回滚须基于实际 Emby 数据库备份、Dry Run 及 `owned-collections.json` 归属记录进行；不能把该状态文件误当成完整 Emby 集合备份。

## 3. Fork 与上游隔离

- 新插件 GUID：`b5bca829-e903-4af4-9fb2-451d72a487e6`（不同于官方 HSC）。
- 新 DLL：`HomeScreenCompanionAnimeEdition.dll`。
- Web 控制器及 API 路由使用独立名称 `/HomeScreenCompanionAnime/`，以免与官方 HSC 冲突。
- 禁止执行上游自动迁移 AutoTag 的破坏性目录迁移；移除上游版本检查的“官方新版本可直接安装”提示，以免误升级覆盖 Fork。
- 不依赖运行中的官方 HSC，但实际生产环境 **不建议原版与 Fork 同时活跃**：即使 GUID 不同，两套后台任务对同一 Emby 媒体库的操作可能相互干扰。建议在隔离环境验证后，再决定切换方案。
- Fork 的配置存储与原版分离。如需带入原来的规则，在官方 HSC 导出 Backup，并在新插件中导入 Settings / Groups 等配置（不要复制原版插件 DLL 覆盖 Fork）。
- 上游 LICENSE 保持 MIT 授权和作者信息，AniBridge Mappings 本身同为 MIT；正式分发时继续保留各自许可声明。

## 4. 本地构建（Windows PowerShell 示例）

前提：目标 Emby Server 版本**应至少为 4.10.1.0**（HSC v4.3.0.0 上游所列最低要求）；必须拿到相同目标服务器的三份只读编译参考 DLL：

- `MediaBrowser.Common.dll`
- `MediaBrowser.Controller.dll`
- `MediaBrowser.Model.dll`

把它们复制到本机单独的只读目录（例如 `D:\EmbyApiRefs`），**不要从生产服务器移动或修改原件**，也不要复制含 API Token、数据库或用户信息的文件。

```powershell
# 在 ZIP 解压根目录执行，先跑纯算法烟雾测试（无需 Emby DLL）
dotnet run --project ./verification/AnimeEdition.SmokeTests.csproj -c Release

# 再以匹配服务器的只读 DLL 为引用构建插件
$refs = 'D:\EmbyApiRefs'
dotnet build ./HomeScreenCompanion/HomeScreenCompanion.csproj -c Release "-p:EmbyReferenceDir=$refs"
```

完成后在 `HomeScreenCompanion/bin/Release/netstandard2.0/` 查找 `HomeScreenCompanionAnimeEdition.dll`。
请核对它与测试服务器版本匹配，勿仅因为文件已生成就认定运行兼容。

Linux/macOS 同样可以指定 `-p:EmbyReferenceDir=/path/to/emby-system`；Fork 已移除上游构建前调用 Windows `powershell` 修改 HTML 源码的操作。

## 5. 配置和验证顺序（**仅隔离环境**）

1. 备份 Emby 数据库、插件目录以及原 HSC 配置。复制一套测试 Emby 或独立测试实例，不修改主力服务器。
2. 在测试实例安装并确认 `Anime Edition` 版本插件已加载，且原 HSC 配置没有被自动覆盖。
3. 进入 HSC Anime Edition 设置的 **Anime IP Collections**，打开 `Enable`，保持 `Anime Dry Run` 打开。
4. 在 Scheduled Tasks 手动运行 `Anime IP Collection Sync`。根据任务日志判断是否下载和识别成功：AniBridge links、Emby matched titles、AniList requests、Planned collections。
5. 首次媒体很多时可能显示 `Pending: AniList cache warm-up`，表示已缓存一部分数据、并没有修改 Emby。等待 AniList 限流窗口后再次手动运行，直到预览完整。
6. 检查几类作品：跨 Movie/Series 的《银魂》《鬼灭之刃》，复杂系列 Fate，未映射作品，以及已有手工创建的同名合集（应显示冲突、不采用）。
7. 手工确认预览合理且已有可恢复的 Emby 数据库备份，再在**测试实例**关闭 `Anime Dry Run` 并再次运行，核对合集成员。
8. 测试新加电影的增量行为、数据库异常时不删除旧合集，以及“人工加入一个额外合集成员”后再次同步是否会保留。
9. 生产部署、停用原版插件和清理历史数据是独立授权动作；默认不执行。

## 6. 状态、缓存、恢复

Emby 的计划任务日志（Server Log 中带 `[Anime]` 前缀）是首要排障入口。插件数据目录里的 `anime/` 只保存本功能的数据：

| 文件 | 用途 |
|---|---|
| `anibridge-v3.json` | 映射缓存，超过 7 天后更新 |
| `anime-anilist-relations.json` | AniList 关系缓存，默认 14 天有效 |
| `anime-ai-decisions.json` | 可选 AI 复核结果，60 天有效 |
| `owned-collections.json` | 插件自己创建的合集 ID 及其管理过的成员 |

如需回滚：先关闭 `Anime Collections`，不运行任何自动任务；恢复事先备份的 Emby 数据库及对应插件设置；必要时让 OMP 在**测试实例**对比旧快照生成逐集合修复计划，确认后才能执行。不要直接删除或篡改运行服务器的数据库、STRM 或缓存文件。

## 7. 参考与许可证

- HSC: https://github.com/soderlund91/HomeScreenCompanion
- AniBridge Mappings v3: https://github.com/anibridge/anibridge-mappings
- AniList GraphQL: https://docs.anilist.co/
- Emby 官方插件与版本说明：https://emby.media/community/
- 本项目基于上游 MIT 源码改造；保持根目录的 `LICENSE`。
