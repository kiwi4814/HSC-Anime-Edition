# 4.3.0.2 本地构建与验收

不连接生产 Emby，不安装 DLL，不重启服务。

## 前提

.NET SDK 8（本次 8.0.426）、Python 3、Node.js，以及本机已有的 Emby 4.10.1.0 `MediaBrowser.Common.dll`、`MediaBrowser.Controller.dll`、`MediaBrowser.Model.dll` 编译参考。NuGet 包版本沿用项目文件，无新增依赖。测试也使用真实 MediaBrowser.Model，不使用伪造 Emby 类型。

源码根目录 `NuGet.Config` 清空远程源：本次仅用已有本地 NuGet 缓存完成构建。如在全新环境编译，请自行配置批准的包源/缓存，不要将生产配置、凭证、SDK 或整个服务器目录加入源码包。

```powershell
$refs = 'D:\EmbyApiRefs'
$cache = 'D:\NuGetCache'
dotnet build HomeScreenCompanion/HomeScreenCompanion.csproj -c Release "-p:EmbyReferenceDir=$refs" "-p:RestorePackagesPath=$cache"
dotnet build verification/AnimeEdition.SmokeTests.csproj -c Release "-p:EmbyReferenceDir=$refs" "-p:RestorePackagesPath=$cache"
dotnet verification/bin/Release/net8.0/AnimeEdition.SmokeTests.dll
dotnet verification/bin/Release/net8.0/AnimeEdition.SmokeTests.dll --preview-demo
python verification/check_static.py
```

测试项目不生成平台 apphost，直接通过 dotnet 执行 DLL，避免 Windows SDK 在 WSL UNC 输出路径替换 EXE 的平台限制。预览模式明确使用隔离模拟库：Provider ID 案例取自已报告的真实结果，部分 Fate/KonoSuba 成员为显式合成夹具，不代表本次再次扫描服务器。

## 已验证与未验证

- Release 构建：0 错误、107 警告。警告在既有 HSC 文件；AI/动漫新增代码在测试工程构建中 0 警告。
- 行为、配置、缓存与本机 AI HTTP：296 条断言通过。输入为虚构作品与 localhost mock，不是生产 Emby。
- 独立 `--preview-demo`：实际生产规则/分组/写入谓词产生候选、批准阻断及重复诊断，退出 0；不调用 Emby。
- 静态：项目 XML、隔离 GUID/路由、15 个设置字段、管理路由与备份密钥调用点、Node JavaScript 语法通过。
- Windows Edge headless 打开真实 `configPage.html`：空策略接受，通配批准键被拒绝。未进入生产后台，未改浏览器安装配置。
- 新 DLL 的程序集身份通过只读元数据检查，版本为 4.3.0.2。
- 新版 Emby 插件加载、真实 API 写入/移除成员及重启持久化未运行。未将旧版 4.3.0.1 生产 Dry Run 验收冒充新版运行证据。

别名仅应用于新建合集。Emby 既有重命名 API 未验证，不自动改名。实际写入仍须部署后在受控环境验收；本次仅复用已有 CreateCollection/AddToCollection/RemoveFromCollection 调用。

## 交付核对

完整源码 ZIP、独立 DLL、相对原 `source-fixed.zip` 的补丁、`TEST_REPORT.md`、`CHANGELOG_4.3.0.2.md`、证据日志与 SHA256SUMS 一并交付。补丁应在 4.3.0.1 源码根目录以 `git apply --check` 检查后应用；本次用独立解压副本实际执行 `patch --dry-run` 与应用/字节比对验证，不改生产代码。
