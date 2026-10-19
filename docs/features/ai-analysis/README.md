# AI 请求与动漫分析：当前行为

## Purpose and boundaries

既有 HSC AI 列表、动漫分析与管理端连接测试共用传输客户端。动漫分析消费确定性候选与已有证据，仅保存建议，不批准合集、改变成员或确认未知映射；概念见 [领域词汇](../../../CONTEXT.md)。

## Current behavior

- 支持 OpenAI-compatible、OpenAI、Gemini、Claude、Ollama。新装 `AnimeAiProvider` 默认 `OpenAICompatible`，Compatible Base URL/Model/API Key 默认空，无强制兼容服务商域名/模型。
- 既有列表的 `TagConfig.AiProvider` 默认仍为 `OpenAI`；已有配置不统一重置。旧备份 DTO/导入 fallback 仍可能选 `OpenAI`，不能把新装默认说成所有迁移路径默认。
- 动漫命名、结构化合集审查和 OTHER 辅助三个开关独立且默认关闭。合集审查只针对已有分组/关系候选，**不会**把整库无 AniList 编号的条目整批发给模型；开启后会把相关作品名称与外部编号发给所选 AI 服务。
- 名称建议包含原名、建议、依据和可信度；用户已有别名不被覆盖。无充分证据的名称按低可信度处理。
- 审查内容和关系建议须对应真实候选 ID、提供商证据与结构；非法 ID/字段/证据或缓存内容不直接成为可执行决定。
- 失败、无效 JSON、超时、取消或预算不足不替代确定性规划；动漫任务记录分析警告。AI 不可用不能放开任何确定性写入门槛。

## Requests, budgets and cache

[共享客户端](../../../HomeScreenCompanion/AiRequestClient.cs) 使用非流式请求。OpenAI-compatible 接受基础 URL 或完整 chat/completions URL，发送 Bearer 认证和 messages，不强制供应商专有 json_schema。URL 限 HTTP(S)，拒绝嵌入凭据、query、fragment；HTTP 被允许但存在明文凭据传输风险，管理端会警告，不应作为公网配置。

统一传输默认约 30 秒超时，支持调用方取消，禁止自动重定向，限制请求/响应体大小到 256 KiB，不自动重试。错误分类区分认证、限流、服务器等；不把响应正文、请求 URL 或密钥拼进错误。具体边界以源码与 HTTP 测试为准。

动漫分析的三个用途共用每轮预算：默认最多 15 次调用、每次 800 token 上限、每轮 4000 token 上限；达到任一预算停止相应后续调用，不声称能计算供应商真实账单。既有 AI 列表复用传输及每次 token 限制，不因此自动纳入动漫分析服务的整轮预算。

`anime/ai-analysis.json` 保存建议与缓存出处，缓存有效期 30 天。输入、provider/model、endpoint、token cap、规则、别名、前缀等参与缓存身份；重新命中时仍做校验。旧 `anime-ai-decisions.json` 不属于此服务的活动报告。

## Data, permissions and secrets

- 管理接口为 `/HomeScreenCompanionAnime/Ai/TestConnection` POST 和 `/HomeScreenCompanionAnime/Ai/Analysis` GET；声明 Admin 认证。
- [AiSecretPolicy.cs](../../../HomeScreenCompanion/AiSecretPolicy.cs) 导出密钥为空；空/缺失导入保留现有密钥，非空显式值才替换。实际备份调用点也使用此策略。
- 保存到配置的真实密钥仍是需要保护的服务器配置；导出脱敏不等于服务端存储已加密。
- 设置页用文本方式呈现建议，不把模型响应当作 HTML、程序集、脚本或业务命令执行。
- 设置页只显示建议类型、合集 Key、当前/建议名称、涉及作品名称、结论、理由、置信度和审查问题；Emby ID、提供商 ID、关系证据、预算计数与提供商/模型等排查数据仍保存在分析缓存中，不在页面展示。未知枚举值显示为“其他”。
- 管理端属性和静态检查不等于实际 HTTP 权限验收；部分既有 DTO 路由与前端前缀不一致见 [已知缺口](../../fork/delta.md#5-已知缺口与验证边界)。

## Code and test entry points

- [AnimeAiAnalysisService.cs](../../../HomeScreenCompanion/AnimeAiAnalysisService.cs)：候选、预算、缓存、校验和建议报告。
- [AiRequestClient.cs](../../../HomeScreenCompanion/AiRequestClient.cs)、[AiResponseDtos.cs](../../../HomeScreenCompanion/AiResponseDtos.cs)：统一传输与响应结构。
- [ListFetcher.cs](../../../HomeScreenCompanion/ListFetcher.cs)、[HomeScreenCompanionService.cs](../../../HomeScreenCompanion/HomeScreenCompanionService.cs)：已有列表与管理 API 接入。
- [AiAnalysisTests.cs](../../../verification/AiAnalysisTests.cs)、[AiMetadataOnlyTests.cs](../../../verification/AiMetadataOnlyTests.cs)：建议与边界。
- [AiHttpTests.cs](../../../verification/AiHttpTests.cs)、[LocalHttpMock.cs](../../../verification/LocalHttpMock.cs)：OpenAI-compatible loopback HTTP，而非所有 provider 的线上验收。

## Operations and verification limits

先检查 provider、模型/endpoint 配置、预算、候选证据、缓存与错误分类。禁用 AI 可保持确定性任务继续；不得通过忽略校验或放宽批准来“修好”分析。

离线入口见 [本地验证](../../../OMP_LOCAL_HANDOFF.md)。现有测试不验证真实供应商、真实凭据、Emby Admin 路由、备份 HTTP、浏览器渲染或服务器持久化；本次文档初始化未执行这些运行验收。旧列表原先的 provider 特定超时等行为已被统一约束，不能仅因新客户端编译通过就宣称所有旧供应商完全等价。

相关历史：[维护文档初始化](../../changes/archive/2026-10-18-fork-maintenance/summary.md)。
