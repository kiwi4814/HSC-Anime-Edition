# 项目文档

## 维护入口

| 需要做什么 | 先读 |
|---|---|
| 了解 Fork 改了什么、哪些官方文件被修改 | [Fork 差异台账](fork/delta.md) |
| 同步官方分支，或完成任意本地改动 | [上游同步与持续维护](fork/upstream-sync.md) |
| 了解领域术语 | [CONTEXT.md](../CONTEXT.md) |
| 查动漫确定性行为与安全门槛 | [动漫合集](features/anime-collections/README.md) |
| 查 AI 请求、建议、预算与密钥边界 | [AI 分析](features/ai-analysis/README.md) |
| 构建与离线验证 | [本地验证入口](../OMP_LOCAL_HANDOFF.md)、[历史验证记录](../TEST_REPORT.md) |
| 读取已完成变化 | [本次初始化归档](changes/archive/2026-10-18-fork-maintenance/summary.md)；其余按 `docs/changes/archive/` 查找 |
| 使用 Matt 规格/任务与分诊 | [任务跟踪](agents/issue-tracker.md)、[分诊标签](agents/triage-labels.md)、[领域文档规则](agents/domain.md) |

## 事实与工作产物

- `docs/features/`：当前行为的权威入口；代码与文档矛盾时先核实并修复漂移。
- `docs/fork/`：相对固定上游基点的当前差异与维护协议。
- `CONTEXT.md`：仅领域词汇；`docs/adr/`：达到条件后才创建的重要决策，不制造空目录/占位决策。
- `docs/changes/archive/`：完成并验证的历史，不冒充当前事实。
- `.scratch/<feature>/spec.md`、`issues/`：本地工作规格和任务，按需建立；不是另一套功能说明。

根目录 `LOCAL_VERIFICATION.json`、`SOURCE_MANIFEST.json`、`CHANGELOG_4.3.0.2.md` 以及附件审查报告保留原有交付语境。它们不构成当前文件清单、新功能验收或生产放行。最新功能状态通过上表进入，不靠给旧报告改日期。

后续功能收尾或上游集成必须按 [维护协议](fork/upstream-sync.md) 更新受影响文档和差异归属；本次未设置自动阻断漂移的 CI。
