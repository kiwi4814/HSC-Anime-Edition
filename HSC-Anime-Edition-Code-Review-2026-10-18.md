# HSC Anime Edition 4.3.0.3 · 交付包审查与实测放行结论

审查日期：2026-10-18
审查材料：用户上传的 `artifacts.zip`，SHA256 `94bf21089c51a0e78b37c035d9ee4cb8d7fde6aa5c19ca24fd9b37d179153e25`。
当前安装的生产版：此前用户已验证 HSC Anime Edition 4.3.0.1 在 Emby 4.10.1.0 加载与 Dry Run 成功。本次审查**没有**连接生产 Emby，也没有编译或运行该 4.3.0.3 候选 DLL。

## 决策

**CONDITIONAL GO：先在本地重新构建最终已提交源码且验证一致性，然后才允许在现有 Emby 上做限定范围的加载和 Dry Run 实测。当前附件内的 DLL 不能直接认定为已审批准予覆盖。正式合集写入仍为 NO-GO。**

## 已独立核实的证据

- 外层 ZIP CRC 通过；内层 `source-clean.zip` CRC 通过。
- `history.bundle` 使用 `git bundle verify` 验证成功；上游提交 `68024c1...` 到最终 `47237da...` 的真实提交图可恢复。
- 用 Git Bundle 恢复的最终代码树与 `source-clean.zip` 中的 61 个文件逐字节一致。
- 最终源码本身的 `.csproj` 版本 `4.3.0.3`，DLL AssemblyInformationalVersion 为 `4.3.0.3+c46de635...`（前一提交标识）。仅凭此信息不能证明 DLL 源码错误，但**无法替代在最终 HEAD 进行一次干净编译**。
- 源码静态脚本 `verification/check_static.py` 实际执行成功，Node `--check` 通过。
- 开发者提供的日志有一轮 Release 编译 `0 errors, 107 warnings` 以及 `PASS: 296 assertions`。这些是外部提供的成功日志，本次会话并未复现 C# 构建/测试。
- 生产源码 `.cs/.js/.html/.json` 对指定真实动漫标题的复查未发现硬编码，测试夹具使用虚构作品名和 ID。
- `AnimeCollectionPolicy.CanWrite` 需要 Dry Run 关闭、成员数不少于二、且在精确批准名单中；分支待审查的组还要求显式规则。`AnimeCollectionTask` 默认单独 Dry Run 开启，且支持只写入自己创建的合集，保留人工成员。
- OpenAI-compatible Chat Completions 模块存在，支持 URL/模型/密钥、禁止默认重定向；Admin 认证保护新增测试接口。AI 命名、审查、OTHER 关系代码存在且默认不开启。

## 标准轴——发现与修复要求

### P1 · 可复现构建阻塞

**位置**：`NuGet.Config:3-4`；`final-review/logs/build-final.log`；`HomeScreenCompanion/HomeScreenCompanion.csproj:38-40`。

`NuGet.Config` 把所有包源 `<clear />`，注释声称依赖已经全部缓存，但最终本地日志明确报出 `NETStandard.Library`、`SkiaSharp`、`Microsoft.CSharp`、`System.Memory` 四项 `NU1100`。即使 CI 曾在预装缓存的机器上成功，也不能作为可复现的发布构建。

**最小修复**：在本地源码维护目录恢复可用且可信的 NuGet 官方源，或使用显式受信任的包源恢复依赖；保持锁定的依赖版本及 Emby 4.10.1.0 官方 DLL 引用；将修复提交到 Git；在**干净提交 HEAD** 上运行 Release 完整构建、296 项测试和静态检查。重新生成 DLL 并记录 Git SHA、程序集版本、DLL SHA-256。若无法成功，停止安装。

### P1 · DLL 未通过最终 HEAD 独立重建

**位置**：`final-review/FINAL-REVIEW.md`、`round-2-report.md`、候选 DLL、`round-2-evidence/build-final.log`。

报告自己指出，提交前编译成功，提交后无法重建。当前 DLL informational version 的 SourceRevisionId 是 `c46de63`（最终提交的父提交），最终源码 HEAD 是 `47237da`。这符合“未提交改动先编译，再提交”的场景，不等于能断言代码不同，但发布前需要由 OMP 针对新 HEAD 再构建一次，不能仅以当前候选 DLL 替换生产。

**核验**：一次完成 `git status` clean → `dotnet restore` → `dotnet build -c Release` → tests → 产物 SHA/版本与构建日志归档，并人工确认生成的候选与上传 DLL 的关系。可将新的程序集信息版本记录为新的正式提交 SHA。

### P2 · 总交付 ZIP 混入浏览器 Profile

**位置**：外层 `artifacts.zip` 的 `final-review/edge-smoke-profile/`。

该目录包含 174 个浏览器 Profile 文件，其中 103 个非空，约 5.49 MB 解压内容，包括浏览器缓存与配置目录。这些文件并不是源码审查所需材料，可能含环境或隐私痕迹，不适合作为分享用归档。

**最小修复**：排除整个该目录、浏览器 Cookie/缓存与会话文件；打包源码、历史、DLL、测试日志与 UI 证据即可。共享前对压缩包做凭据扫描。

### P2 · 运行时验证尚缺（验收门槛而非已证实缺陷）

**位置**：`round-2-report.md`、`round-2-evidence/browser-ui.log`、`AnimeCollectionTask.cs`。

HTML 离线打开、Mock HTTP 和纯算法测试都不能证明它能在 Emby 4.10.1.0 启动、保存配置或同步合集。必须在控制风险下做真实加载 + Dry Run。当前仍有中文文案人工复核未完成，不应宣称完整翻译验收。

## 规格轴——已覆盖与边界

已见覆盖：用户审批白名单、基于稳定 ID 的覆盖排除和别名、重复报告、Dry Run、现有归属保护、OpenAI-compatible 默认类型、AI 三用途的建议性输出、基础汉化、官方 HSC 功能保留。

尚未验证：新 DLL Emby 运行时加载；Emby API 配置真实保存/回读；用户旧配置实际迁移；长时间运行与定时任务行为；真实 AI 供应商；实体合集写入与回滚。用户最初希望完整自动识别 IP，但源数据覆盖仍受 AniBridge + AniList 限制。

关于 Fork：交付 Git 仅含 upstream remote，无用户个人 Fork URL；这不影响本地 Dry Run，但不符合先前希望同步个人 Fork 的交付愿望。

## 允许进入 Emby 实测的放行门槛

1. 在 `Code/HSC-Anime-Edition` 以最终修复后**干净的已提交 HEAD**完成 SDK/引用 DLL 确认、NuGet 还原、Release 构建、自动化测试和静态检查，得到可溯源 DLL 与散列。
2. 配置初始快照：`AnimeEnabled=true`、`AnimeDryRun=true`、`DryRunMode` 不被改变、`AnimeApprovedCollectionKeys` **为空**、AI 三功能全部关闭；如果现值不同，应先停下来说明，而不是假设。
3. 用 SSH 只操作现有 `emby` 容器，维护窗口内冷备 `/config`，先验证备份，保存原 DLL，再更换单个 DLL，必要时仅重启 `emby`。
4. 查看启动日志/HTTP/插件加载/UI 配置，手工执行一轮 **Dry Run**，核对缓存和关系图及合集快照，并保存差异和日志。
5. 如加载失败/出现未授权合集写入/关键异常，立即停止，提出回滚。部署回滚允许恢复旧 DLL 并仅重启 Emby，但如果数据已更改，恢复数据库需独立判断和明确批准。
6. **禁止**首次真实合集写入、关闭 Dry Run、修改人工合集、修改 STRM/NanShare、改其他容器、执行系统清理或重建镜像。

本报告仅是已上传文件的静态审查+外部证据核对；实际服务验证仍由 OMP/用户现场完成。
