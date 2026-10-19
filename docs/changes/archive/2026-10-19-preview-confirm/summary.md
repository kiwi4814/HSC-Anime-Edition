# 2026-10-19 手动同步预览确认框 + 去掉关系图 UI

## 目的

替换「预览卡片 + 关系图」路径：手动同步先预览再确认创建；关系图整块从界面移除；定时是否写库用单独开关。

## 主要变化

- UI：删除编辑页关系图区块/样式/JS；新增「确认创建」面板（有疑问/没问题、改名、废弃、一键创建）。
- 页上「先预览 / 写入媒体库」→「定时自动写入」（`AnimeDryRun` 取反）；「立即同步」与速度拨号均走 ManualPreview→确认框。
- 配置：`AnimeDiscardedCollectionKeys`；任务跳过废弃指纹；手动预览/确认写入一次性标志。
- API：`POST Anime/ManualPreview`、`Anime/Discard`、`Anime/ConfirmCreate`。
- **删除**：`AnimeCollectionGraphSupport.cs`、`GET Anime/CollectionGraph` 及冒烟子图用例（仅服务图谱 UI）。
- **保留**：合集编辑（改名+成员）、提醒、AniList 关系扩展（`AnimeGraphExpansion`）、Policy、备份可读升级。
- 备份格式 **v5**（含废弃名单）；旧备份仍可读。

## 验证

- `dotnet build` Release；SmokeTests；`check_static.py`；`node --check` configPage.js。
- 未 push / 未发 release / 未传 DLL。
