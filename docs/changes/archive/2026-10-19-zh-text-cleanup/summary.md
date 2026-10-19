# 2026-10-19 中文文案清理（fix/zh-text-cleanup）

依据 2026-10-19 文案审计，分批修正日志标记、术语统一、动漫面板内部细节与文案语气。只改文本、日志着色正则及个别消息的日志级别，不改业务逻辑。

## 批次 1：日志级别标记与日志查看器着色

- `RunLog.Debug` 恢复官方 `[DEBUG]` 标记（汉化后为 `[调试]`，前端只识别 `[DEBUG]`，调试行失去灰色样式且前缀未剥离）。
- 服务器日志组件前缀恢复官方英文：`[Home Screen]`、`[Migration]`、`[Real-Time]`、`[TopList]`、`[LibraryAccess]`、`[Access]`、`[CW Bump]`、`[Top-list merge]`、`[Dry run]`；动漫任务前缀用 `[Anime]`。
- 汇总标题中的 `[清理]` 恢复为 `[Cleanup]`；`结果`/`汇总`/`首页同步` 等中文标题保留，`configPage.js` 的标题正则改为匹配实际输出。

验证：插件 Release 重建 0 错误、107 警告（与基线相同）；回归程序 0 警告；296 条断言通过；`--preview-demo` 与 `check_static.py` 通过。未做浏览器或 Emby 运行时验收。
