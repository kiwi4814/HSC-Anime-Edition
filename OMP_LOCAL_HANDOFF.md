# 4.3.0.3 开发基线与本地验证

本文保留 2026-10-18 源码开发基线的构建入口和验证结果，不是生产安装授权。历史审查材料见 `HSC-Anime-Edition-Code-Review-2026-10-18.md`；验证结果按 `TEST_REPORT.md` 的日期与范围解释，当前功能事实从 [项目文档索引](docs/README.md) 进入。

## Git 基线

固定基线、已集成上游 SHA、现存差异与已知缺口见 [Fork 台账](docs/fork/delta.md)。后续功能分支和上游集成按 [维护协议](docs/fork/upstream-sync.md) 执行，保留真实历史，不改写基线标签；生产部署另行批准。

## 工具与编译参考

需要 .NET SDK、Python 3、Node.js，以及匹配 Emby 4.10.1.0 的只读 `MediaBrowser.Common.dll`、`MediaBrowser.Controller.dll`、`MediaBrowser.Model.dll`。插件目标是 `netstandard2.0`，回归程序目标是 `net8.0`，运行回归需要 .NET 8 runtime。

源码基线验证使用现有 Windows .NET SDK 10.0.402 编译，并用 WSL .NET 8.0.32 执行新构建的回归 DLL。早期交付使用 SDK 8.0.426；不混用两次结果。项目沿用原有 NuGet 依赖版本；`NuGet.Config` 已恢复官方 `https://api.nuget.org/v3/index.json`，不再依赖预热缓存才能还原。

参考 DLL 放在源码树外，通过 `EmbyReferenceDir` 传入；不把 SDK、包缓存、生产配置、凭据或服务器目录加入 Git。以下环境变量由本机设置：`EMBY_REFERENCE_DIR` 指向三个参考 DLL 所在目录，`DOTNET` 指向用于编译的 dotnet，`DOTNET8` 指向带 .NET 8 runtime 的 dotnet；同一安装具备 SDK 与 runtime 时二者可以相同。

```bash
"$DOTNET" build HomeScreenCompanion/HomeScreenCompanion.csproj -c Release -t:Rebuild "-p:EmbyReferenceDir=$EMBY_REFERENCE_DIR"
"$DOTNET" build verification/AnimeEdition.SmokeTests.csproj -c Release -t:Rebuild "-p:EmbyReferenceDir=$EMBY_REFERENCE_DIR"
"$DOTNET8" verification/bin/Release/net8.0/AnimeEdition.SmokeTests.dll
"$DOTNET8" verification/bin/Release/net8.0/AnimeEdition.SmokeTests.dll --preview-demo
python3 verification/check_static.py
```

从 WSL 调用 Windows SDK 时，`EmbyReferenceDir` 必须使用 Windows 可识别的路径（可用 `wslpath -w` 转换），不要直接把 Linux 路径传给 Windows MSBuild。测试项目不生成平台 apphost，直接通过 dotnet 执行 DLL。

## 2026-10-18 源码基线验证与边界

- 插件 Release 重建：退出 0，0 错误、107 警告，未隐藏或抑制。
- 回归程序 Release 重建：退出 0，0 错误、0 警告。
- 行为、配置、缓存与 localhost AI HTTP：296 条断言通过；夹具为虚构作品和模拟 ID。
- 独立 `--preview-demo`：调用实际生产规划器与写入谓词，四个候选组在 Dry Run 中均禁止写入；不访问 Emby。
- `verification/check_static.py`：项目 XML、源码集成检查和 Node.js JavaScript 语法检查通过。静态源码检查不证明运行时认证、备份 HTTP 或浏览器交互。
- 发布卫生：排除 `artifacts/`、bin/obj、浏览器 Profile 与 Windows `Zone.Identifier`。对五个本地提交的 103 个不同 Git blob 和审查报告进行常见 token/私钥模式扫描，未命中；不宣称完整安全审计。
- 本轮未运行浏览器界面验收、Emby 插件加载、真实配置保存/回读、合集写入/移除/持久化或真实 AI 供应商验证；不把早期生产结果当作当前版本证据。

## 已知问题与后续优先项

1. **设置备份遗漏合集策略。** 当前行为和迁移风险以 [动漫合集：备份限制](docs/features/anime-collections/README.md#备份限制) 为准；恢复后保持 Dry Run 并逐项核对。
2. **107 条编译警告仍在。** 不在保存基线时夹带大规模空值/风格重构；后续按可观测风险逐项处理。
3. **生产验收独立。** 别名仅用于新建合集；既有合集重命名 API 尚未验证。源码验证不等于允许生产部署或真实合集写入。

## 2026-10-18 源码基线整理记录

新增：可追溯的开发分支/基线标签约定与现有附件审查报告入库。

修改：README 与动漫模块说明对齐 4.3.0.3、空默认别名和实际验证边界；NuGet 注释对齐官方源；忽略 Windows 下载标记。

移除：仅移除过时文档断言；未删除本地产物、未改写历史、未修改 C# 或 UI 业务逻辑。早期 `LOCAL_VERIFICATION.json`、`SOURCE_MANIFEST.json` 与 `CHANGELOG_4.3.0.2.md` 作为历史交付记录保留，不代表当前源码/产物清单。
