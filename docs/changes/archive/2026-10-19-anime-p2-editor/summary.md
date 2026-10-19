# 2026-10-19 P2 合集可视编辑

## 目的

在「动漫合集」页提供小白向的合集编辑：改显示名称、勾选/搜索成员、保存为内部精确成员规则，或改回自动归类。接上 P1「去处理」真正打开编辑器。

## 主要变化

- 新增 `AnimeCollectionEditorSupport`：改写 `AnimeCollectionRulesJson` / `AnimeCollectionAliasesJson`，空批准名单保持全开，非空时保存补 Key。
- 服务 API：`CollectionEditor` 读取、`MediaSearch`、`Save`、`ClearRule`；保存可把该合集提醒标已处理。
- 配置页：合集编辑子视图；卡片点击与「去处理」打开编辑器；主路径无 Key/JSON/批准名单等词。
- 卡片摘要补充 `MemberIncludeIds`；归属卡片带 `Key`。

## 验证

- 插件与 SmokeTests Release 重建；冒烟含编辑器改写断言；`check_static.py` P2 断言；`node --check` 含于静态脚本。
- 未做 Emby 浏览器实机点选验收；未 push / 未发 release / 未传 DLL。

## 已知限制

- 显示名称写入别名表，**不会**自动重命名已有 Emby 合集。
- 搜索为片名包含匹配的最小可用实现。
- 未做 P3 关系图；未迁移 AI 密钥到设置（按方案留给后续）。
