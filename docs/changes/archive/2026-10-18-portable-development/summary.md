# Change: portable-development

- Date: 2026-10-18
- Status: verified（全新远端克隆及离线构建，不是另一台物理电脑或生产验收）
- Development entry: [换电脑继续开发](../../../../OMP_LOCAL_HANDOFF.md#换电脑继续开发)
- Maintenance rules: [上游同步](../../../fork/upstream-sync.md)

## Purpose

将已完成的维护文档推送个人 Fork，补齐新电脑克隆、工具、参考程序集与代理技能的准备步骤，验证不依赖原工作树产物即可继续开发。

## ADDED / MODIFIED

- 构建 handoff 增加 `develop` 克隆与 upstream 配置、.NET 8 runtime、外部 Emby 引用、Matt 全局技能和 GitHub 认证边界。
- 同步规范明确：本地 main/remote 配置不会随 clone 继承，不要求新电脑创建本地 main。
- 没有修改业务代码、依赖版本、生产配置或基线标签；没有上传私有参考 DLL、凭据或缓存。

## Verification evidence

针对 GitHub 上 `45797cc` 提交执行：

- 在临时独立目录运行 `git clone --branch develop`，实际 HEAD 与已推送提交一致；`origin/develop` 跟踪及固定基线标签正确。
- 检查代理入口、领域词汇、Matt 三份配置、Fork 规范、构建入口与 NuGet.Config 都存在；按文档添加 upstream 并 fetch 成功。
- 使用 Windows .NET SDK 10.0.402、现有受信任的 Emby 4.10.1.0 三个参考程序集，以及独立初始空的 NuGet 包目录构建：插件 0 错误/107 警告；回归项目 0 错误/0 警告。包下载/HTTP 缓存和网络仍属于本机环境，不声称模拟完全无缓存的另一台电脑。
- 用 Linux .NET 8.0.32 执行新克隆构建的回归 DLL：296 条断言通过；独立预览所有候选 `WritesAllowedNow=false`。
- 新克隆静态/XML/JS 语法检查通过，构建和验证后其工作区保持干净。

## Limits

没有在另一台物理电脑执行；新电脑需要安装 Git、SDK/runtime、Python、Node、代理客户端/Matt skills，并从可信官方安装另备匹配 Emby 引用。缺少引用时可编辑，但不能宣称插件编译/回归通过。没有生产访问、部署、真实合集写入或真实 AI 供应商验收。

本归档记录上述固定提交的结果；后续仅补入本证据归档，不改变被验证的源码。当前行为仍以 [文档索引](../../../README.md) 指向的功能文档为准。
