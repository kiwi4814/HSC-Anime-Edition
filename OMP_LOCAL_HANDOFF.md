# HSC Anime Edition — OMP 本地验收交接（无 Docker / 不启动 Emby）

**来源**：`HSC-Anime-Edition-source.zip`（基于 HSC 官方 `68024c17ef041fb486535c75384a42c3f59af1d0`，Fork 源码版本 `4.3.0.1`）。

**唯一任务**：在 Windows 本地完成源码/静态检查、C# 烟雾测试、尽可能完成 Emby 插件 DLL 编译，并交付日志及产物。**到编译和产物检查为止，绝不运行任何 Emby 实例。**

## 禁止事项（硬边界）

- 不安装、不启动 Docker / Docker Desktop / WSL 容器；不运行 Emby Server（包括便携版、测试版、生产版）。
- 不访问、扫描、连接或复制生产 Emby 服务器的任何目录或服务。不要连接 NAS、Plex、NanShare、115、302 或修改 STRM。
- 不安装插件、不改动现有 Emby DLL 或配置、不修改 Windows 服务、系统代理、端口、反代和防火墙。
- 不对 GitHub Fork、Push、建 PR 或发布 Release。
- 缺 SDK / NuGet 源 / Emby 参考 DLL 时不得自动安装全局软件、猜测版本或造假 DLL；记录阻塞并提出最小需求。
- 允许在**新建的独立工作目录**运行 `dotnet restore/build/run` 和 Python/Node 语法检查；如需临时配置，只作用于该工作目录。
- 不为了让编译通过而删除功能、注释关键代码、使用空接口桩替代真正的 Emby DLL，或伪造测试结果。

## A. 独立准备与静态检查

1. 找到用户提供的 `HSC-Anime-Edition-source.zip`。新建唯一空目录解压，不覆盖既有源码。
2. 记录 ZIP SHA-256、系统版本、`dotnet --info`、`node --version`、`python --version`（可用即记录；缺失直接标注 SKIP）。
3. 确认 `ANIME_EDITION.md`、`verification/`、`AnimeMappingIndex.cs`、`AnimeAniListClient.cs`、`AnimeRelations.cs`、`AnimeCollectionTask.cs` 存在。
4. Python 可用则运行 `python ./verification/check_static.py`，记录 stdout/stderr 和退出码。Node 可用时可另运行 `node --check ./HomeScreenCompanion/Configuration/configPage.js`。
5. 检查项目 `HomeScreenCompanion/HomeScreenCompanion.csproj` 中 `TargetFramework=netstandard2.0`、`AssemblyName=HomeScreenCompanionAnimeEdition`；`verification/AnimeEdition.SmokeTests.csproj` 目标 `net8.0`。

## B. 不依赖 Emby 的 C# 烟雾测试

如果本机安装了兼容的 .NET SDK：

```powershell
# 在解压根目录；保存日志及 exit code
$ErrorActionPreference = 'Continue'
dotnet run --project ./verification/AnimeEdition.SmokeTests.csproj -c Release *> smoke.log
$smokeExit = $LASTEXITCODE
Write-Host "smoke_exit=$smokeExit"
Get-Content smoke.log
```

测试针对 AniBridge ID/季度映射与动漫关联分组算法，**不启动 Emby，不连接服务器，不调用真实 AniList API**。

如果缺 .NET SDK 或 NuGet 还原失败，先记录完整错误，再继续无需 SDK 的静态检查。不要擅自安装 SDK；把建议安装版本发回用户决定。

## C. 插件 DLL 编译（有真实参考 DLL 才执行）

项目编译需三份与**目标 Emby Server 版本相匹配**的原始二进制引用：

- `MediaBrowser.Common.dll`
- `MediaBrowser.Controller.dll`
- `MediaBrowser.Model.dll`

优先使用用户**事先提供的离线 DLL 包**，或已存放在本机、来自相同版本 Emby 安装包的 DLL。参考 DLL 必须复制到独立只读目录；验证文件来源、版本和 SHA-256。**本轮不要为获取 DLL 而访问运行中的 Emby 服务器**。如果 DLL 不齐或版本无法证实，此步状态记为 `BLOCKED_REFERENCE_DLL`，不要跳过引用强制编译，也不要模拟“成功”。

当三份引用齐全后：

```powershell
$refs = 'D:\EmbyApiRefs'   # 修改为真实的本地离线引用目录
$names = @('MediaBrowser.Common.dll','MediaBrowser.Controller.dll','MediaBrowser.Model.dll')
foreach ($name in $names) {
  if (-not (Test-Path (Join-Path $refs $name))) { throw "Missing reference: $name" }
}

dotnet build ./HomeScreenCompanion/HomeScreenCompanion.csproj -c Release "-p:EmbyReferenceDir=$refs" *> build.log
$buildExit = $LASTEXITCODE
Write-Host "build_exit=$buildExit"
Get-Content build.log
```

如果出现 CS 编译错误：对照**实际 DLL 类型和方法签名**做必要的最小 C# 修复，保留原 HSC 功能，保存统一差异 Patch；重复执行烟雾测试、静态检查和完整构建。不要编造接口或改动运行中的服务。

若编译成功，核对 `HomeScreenCompanion/bin/Release/netstandard2.0/HomeScreenCompanionAnimeEdition.dll`（实际路径以编译输出为准），记录 SHA-256、文件大小、构建 warning 数量、生成目录；该 DLL 只能作为**待运行验收的候选产物**。

## D. 到这里立即停止

**不要**进一步安装插件、启动 Emby、测试 Emby 配置页、调用 Emby API、连接生产媒体库、修改合集或下载实际动漫媒体。Emby 阶段由用户自行完成。

如果 C# 烟雾测试通过但缺参考 DLL，应交付现有结果并标记编译未完成；若用户日后愿意提供只读 DLL，再继续编译，不需要运行 Emby。

## 必须返回给 ChatGPT Web 的验收材料

1. `OFFLINE_VERIFICATION_REPORT.md`：逐项 PASS / FAIL / SKIP / BLOCKED，注明命令、退出码及证据；不要把静态测试通过写成插件成功编译。
2. `smoke.log`、`build.log`（未运行则注明原因）、静态脚本结果。
3. 如生成：`HomeScreenCompanionAnimeEdition.dll` + SHA-256 + 引用 DLL 版本信息（避免暴露路径中的敏感信息）。
4. 如修改源码：完整修改后 ZIP、最小 `.patch`、变更原因，以及修复后的重新运行结果。
5. 最后单独写明：**未使用 Docker；未启动 Emby；未触碰生产；未执行任何 Emby 运行时验证。**

验收截止点：编译产物检查。Emby 插件运行、媒体合集操作、网络 API 联调及发布均**不属于本轮**。
