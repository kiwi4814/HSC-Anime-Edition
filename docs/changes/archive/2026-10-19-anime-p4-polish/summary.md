# 2026-10-19 P4 提醒策略与 AI 配置归入设置

## 目的

P4 打磨 + 职责分离：OpenAI 兼容接口只出现在「设置 → AI 设置」；动漫侧只留建议开关；可选「有提醒先不写入」；命名建议可一键采用显示名；备份含提醒状态。

## 主要变化

- `CompatibleAi*` 输入从设置里的「动漫合集」面板挪到「AI 设置 → OpenAI 兼容接口」；字段仍是同一套配置，无第二套密钥存储。
- 新增 `AnimeSkipWriteWhenReminders`（默认关）：本趟同步为合集产生提醒时跳过写入。
- 提醒/建议 UI：`SuggestedName` + `Reminders/AdoptName` 一键写别名（不假装采纳成员）。
- 备份 v4：Settings 增补跳过写入/映射地址；新分区 `AnimeReminders` 导出/导入 `last-run-summary` 提醒行。
- 空状态与加载失败文案人话化；建议区去掉「合集 Key」等主路径套话。

## 验证

- 插件与 SmokeTests Release 重建；`check_static.py` P4；`node --check`。
- 未 push / 未发 release / 未传 DLL。
