# 2026-10-19 批次 3：备份策略、AI 隐私、主屏幕仅预览

## 做了什么

- 设置备份 v3 导出/导入三项动漫策略（规则 / 批准名单 / 别名）；归属文件仍不备份。
- 关闭「整库无 AniList → AI mapping」候选；审查只针对分组/关系；面板补隐私说明。
- `HomeSectionSyncTask` 尊重全局 `DryRunMode`；修正「仅预览」文案。
- 可配置映射 URL、失败中文提示与轻量重试；扫描读取媒体 AniList 编号；兼容 AI 字段仅在 OpenAICompatible 时显示；共存警示；Issues → kiwi4814；动漫面板启用时默认展开；别名校验用词；减少扫描 DEBUG / 重复提示级别。

## 未做（搁置）

归属进备份、主屏幕快照恢复、Task Key 重命名、运行时探测官方插件、顶级动漫 Tab、整页 a11y、放宽 AI Validate。

## 验证

本地 Rebuild 插件与 smoke、`--preview-demo`、`check_static`；详见 `/workspace/projects/hsc-logs/batch3-2026-10-19.md`。
