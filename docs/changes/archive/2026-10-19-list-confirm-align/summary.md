# 2026-10-19 确认清单对齐探索定稿

## 目的

按 `hsc-logs/ux-list-confirm-explore-2026-10-19.md` 对齐手动确认交互：统一清单、黄标、创建后短提示、设置里恢复废弃。

## 主要变化

1. **确认清单**：去掉「有疑问 / 没问题」两区；一张清单列出本次全部候选；吃不准行黄标 + 人话原因；可选筛选「全部 / 吃不准」（默认全部）。不挡一键创建。
2. **一键创建后**：关 overlay；`Dashboard.alert`「新建 N · 更新 M」（来自 LastRunSummary.Created/Updated）；刷新合集一览与状态。
3. **废弃恢复**：废弃仍永久跳过；可选保存显示名（`key\tname`）；设置 → 动漫合集「已废弃的合集」列表（只显示名）+ 恢复。新增 `GET Anime/Discarded`、`POST Anime/Restore`。
4. **保持**：无关系图、无提醒主路径、无动漫 dry-run；定时直接写；批准名单不挡写入；确认框跟主题。

## 审查补刀

- 黄标读取卡片 `HasReminder`；ConfirmCreate 废弃键补 `anilist:` 校验；摘要失败时不弹「新建 0 · 更新 0」。

## 验证

- `dotnet build` Release；SmokeTests；`check_static.py`；`node --check` configPage.js。
- 未 push / 未发 release / 未传 DLL。
