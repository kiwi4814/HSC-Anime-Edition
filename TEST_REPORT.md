# 4.3.0.2 本地验证记录

日期：2026-10-17。基线：既有 source-fixed.zip；本轮无 SSH、生产 Emby HTTP 或外部 AniList 请求。

## 执行结果

| 检查 | 实际结果 |
|---|---|
| 插件 Release 构建（.NET SDK 8.0.426） | 退出 0；0 错误、107 警告（见 evidence 与 final-review 日志） |
| 回归控制台构建（真实 MediaBrowser.Model 引用） | 退出 0；0 错误、0 警告 |
| 回归控制台执行 | PASS: 296 assertions，虚构夹具与本机 HTTP mock，退出 0 |
| 独立 --preview-demo | 退出 0；生成分组/审批/重复诊断 JSON |
| verification/check_static.py | 退出 0：XML、隔离 GUID/路由、15 个设置字段、管理路由与密钥导出调用点、Node.js 语法 |
| 离线设置页（Windows Edge headless，本地 file） | PASS：真实 HTML 控件；空策略接受；通配批准被拒绝。无 Emby 框架或网络 |
| DLL 只读程序集元数据 | HomeScreenCompanionAnimeEdition, Version=4.3.0.2 |
| 新 DLL 的 Emby 运行验收 | 未执行，不连接生产环境 |

构建警告未隐藏或抑制。插件工程 107 条警告来自既有 HSC 代码路径；本轮动漫/AI 新增文件在测试工程中为 0 警告。测试项目 UseAppHost=false，通过 dotnet 执行测试 DLL。第二轮日志在 `artifacts/final-review/round-2-evidence/`（build-final、test-build-final、tests、preview、static、browser-ui）。

## 回归覆盖

- 带类型 Provider ID 的电影/剧集隔离、空白/大小写规范化、不同 Emby ID 重复、同条目重复元数据不误报；共享 AniList 季身份的 TV 与电影不误报。
- 真实报告的 CLANNAD 和鬼灭剧场版 Provider ID 用于重复夹具；诊断前后媒体数据不变。
- Fate 精确成员选择、排除优先、跨提供商同条目冲突拒绝、完整自动分量替换、禁用 SPIN_OFF 后仍有分支需明确规则。
- 未批准、错误 Key、名称冒充 Key、Dry Run 仍开启时均拒绝真实写入；批准自动分支不能绕过明确规则。
- 用户别名覆盖与电锯人、为美好的世界献上祝福！两个默认名。
- 人参果/金猴降妖通过 ID 排除，少于两部不写入。
- 旧合集状态、关系缓存和旧 HSC XML/JSON 配置实际序列化往返；新字段默认空，未知/未迁移旧配置不自动批准。
- 人工 Fate 合集不按名接管、归属 ID 缺失不认领替代品、别名冲突拒绝、未获批分组仍参与拆分保护、显式规则不移除手工追加成员。

## 运行证据边界

--preview-demo 调用实际生产规划器和安全策略，但输入是隔离模拟库：部分 ID 取自真实报告，Fate/KonoSuba 部分成员为合成夹具。它不构成新版真实 Emby API 执行、数据库持久化或网络服务验收。未伪造这些结果。

本轮复用既有 CreateCollection/AddToCollection/RemoveFromCollection API；新集合级门槛的 pure predicate 与成员计划已执行验证，真实 API 行为须部署后受控测试。已有合集重命名 API 未验证，因此本版只为新建合集使用别名。

## 日志

- evidence/build.log
- evidence/test-build.log
- evidence/tests.log
- evidence/preview.log
- evidence/static.log
- evidence/ui-validator-smoke.log
- evidence/metadata.log
- evidence/patch-check.log（交付时对独立基线副本应用补丁并逐文件比较）

源码与 DLL/补丁散列见交付 SHA256SUMS.txt。尚未部署，等待用户决定。
