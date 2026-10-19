# 2026-10-19 中文文案清理（fix/zh-text-cleanup）

依据 2026-10-19 文案审计，分批修正日志标记、术语统一、动漫面板内部细节与文案语气。只改文本、日志着色正则及个别消息的日志级别，不改业务逻辑。

## 批次 1：日志级别标记与日志查看器着色

- `RunLog.Debug` 恢复官方 `[DEBUG]` 标记（汉化后为 `[调试]`，前端只识别 `[DEBUG]`，调试行失去灰色样式且前缀未剥离）。
- 服务器日志组件前缀恢复官方英文：`[Home Screen]`、`[Migration]`、`[Real-Time]`、`[TopList]`、`[LibraryAccess]`、`[Access]`、`[CW Bump]`、`[Top-list merge]`、`[Dry run]`；动漫任务前缀用 `[Anime]`。
- 汇总标题中的 `[清理]` 恢复为 `[Cleanup]`；`结果`/`汇总`/`首页同步` 等中文标题保留，`configPage.js` 的标题正则改为匹配实际输出。

验证：插件 Release 重建 0 错误、107 警告（与基线相同）；回归程序 0 警告；296 条断言通过；`--preview-demo` 与 `check_static.py` 通过。未做浏览器或 Emby 运行时验收。

## 批次 2：术语统一

- 按 `CONTEXT.md`「界面用语（zh-CN）」统一：主屏幕（原 主页/首页）、栏目（原 分区/版块/区块/主页行）、项目（原 条目）、仅预览（原 试运行/预演/模拟运行）、计划（原 定时）、角标、艺术家、电视模式、智能列表、AI 提供商、Token、批准名单。
- 同一英文原句的不同译法合并（Show this section → 显示此栏目；Home Section Settings → 主屏幕栏目设置；Schedule → 计划）。
- 帮助文本中的按钮/任务名与实际界面一致（同步主屏幕、同步标签和合集、同步榜单栏目）。
- 6 个计划任务统一归入分类 `Home Screen Companion 动漫版`；插件描述（Plugin.cs）翻译为中文；去掉未翻译的 `<collection>` 占位符。
