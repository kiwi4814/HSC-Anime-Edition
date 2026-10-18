# Change: fork-maintenance

- Date: 2026-10-18
- Status: verified（文档与离线范围；不是生产发布）
- Current feature docs: [动漫合集](../../../features/anime-collections/README.md)、[AI 分析](../../../features/ai-analysis/README.md)
- Current maintenance docs: [Fork 差异](../../../fork/delta.md)、[同步协议](../../../fork/upstream-sync.md)

## Purpose

核对官方 Fork 后的本地新增和官方文件修改，建立可持续维护的差异台账及上游集成流程；按用户确认的 `setup-matt-pocock-skills` 配置本地 Markdown 跟踪、默认分诊标签、单领域文档和 `AGENTS.md` 入口。

## ADDED

- `docs/fork/`：按固定官方 SHA 审计的逐文件台账、兼容/冲突热点和安全同步步骤。
- `AGENTS.md`：代理消费入口与同一变更集更新功能事实、Fork 差异、历史的收尾规则。
- `CONTEXT.md`：媒体身份、候选、批准、归属、Dry Run 与 AI 建议的领域词汇。
- `docs/agents/`：本地 `.scratch/<feature>/` 任务、默认五个分诊角色及 single-context 消费规则；未开启 GitHub Issues/创建标签。
- `docs/features/` 与文档索引：当前动漫/AI 行为、真实默认/兼容边界、代码和验证入口。

## MODIFIED

- `ANIME_EDITION.md` 转为导航入口，详细行为集中到功能文档；修正旧 AI 文件名被当作活动缓存的文档漂移。
- README 和构建 handoff 接入维护文档，区分源码基线结果、当前功能事实及早期交付证据。
- 登记源码审计发现：部分旧 DTO 路由与前端 Anime 前缀不一致、反馈链接仍指向官方、旧 AI 列表受共享传输约束。它们是源级事实/待验证风险，本次不修业务代码。

## REMOVED

- 移除当前入口文档中的重复详细规则，改为单一事实链接；没有删除源码、历史报告、本地产物或已有 Git 历史。

## Verification evidence

- 官方 `main` 经 `git ls-remote` 仍为 `68024c17ef041fb486535c75384a42c3f59af1d0`，源码审计为 `90e94b15c28a41dd25c04a43e80cf1349196c996`；未对实际项目执行 fetch/merge 同步。
- 固定两树差异为 48 路径（26 新增、22 修改）；逐个检查台账均有精确路径，当前新增治理文件另有明确目录归属规则。
- 检查 `AGENTS.md` 只有一个 `Agent skills` 块，三份 Matt 配置存在、五标签映射一致、single-context 已声明，`.scratch/` 示例任务路径未被忽略。
- 文档中的 Bash 代码块通过 `bash -n`；固定上游为基线祖先，基线标签仍指向原提交。
- 检查本轮 14 份 Markdown 的 83 个本地链接（含锚点）及两个 JSON 示例；初次发现一处归档相对路径错误，修正后全部通过。
- 在临时本地官方/Fork/工作仓库中执行文档的 Git 步骤：无冲突合并保留本地文件并停在未提交待审状态；冲突合并保留未合并路径及固定 MERGE_HEAD。临时仓库已清除，没有修改实际项目的分支或合并状态。
- 对本轮不可变快照进行独立 Standards/Spec 双轴评审，均无发现；评审结果不代替实际运行验证。
- 再次执行既有新构建离线 DLL：`PASS: 296 assertions; fictional fixtures and localhost HTTP only`。
- 再次执行 `--preview-demo`：四个候选组均 `WritesAllowedNow=false`。
- 再次执行 `python3 verification/check_static.py`：源码集成/项目 XML 与 Node.js 语法检查通过；不是实际 HTTP 认证或浏览器验收。
- 本次只改 Markdown，没有 C#/UI/构建或运行配置变更；未重新构建插件，不把早先 107 警告的构建当作本次重建。

本次没有生产访问、部署、服务重启、真实合集写入、真实供应商请求或浏览器验收；没有安装全局 skill，也没有建立自动阻断文档漂移的 CI。

## Related ADRs / domain context

[CONTEXT.md](../../../../CONTEXT.md)。本次没有达到需新建 ADR 的重要架构决策；后续有真实权衡时按需记录。

## Historical development artifacts

> 此处引用的旧报告是历史证据，不是当前功能规格。

原始请求及确认在本次会话：仓库规范文档而非全局 skill；本地 Markdown；默认标签；创建 `AGENTS.md`。早期报告继续保留在根目录，当前事实通过 [文档索引](../../../README.md) 查阅。
