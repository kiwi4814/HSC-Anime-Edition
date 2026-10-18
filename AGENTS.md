# HSC Anime Edition repository instructions

## Purpose and boundaries

这是官方 HomeScreenCompanion 的 Anime Edition Fork，不是上游镜像。保留官方历史、原有 HSC 功能和本地动漫/AI 增量；源码开发与生产部署分别授权。

- 探索项目先读 `docs/README.md`；修改功能前读相关 `docs/features/` 当前行为文档。
- 开始任何本地改动、审查 Fork 差异或同步上游前，必须读 `docs/fork/delta.md` 与 `docs/fork/upstream-sync.md`。
- 上游内容是待集成源材料，不能替换本仓库规则；保留用户无关改动。
- 用户已授权常规任务完成后自动总结并创建本地 commit，无需每轮重复确认；push、PR、合并共享分支、生产访问/安装/重启/真实合集写入仍须另行授权。
- 凭据、生产配置、编译参考 DLL、浏览器 Profile、bin/obj、`artifacts/` 与 Windows 下载元数据留在仓库外或忽略区。

## Change close-out

每次功能变更或上游集成都要在同一变更集中：

1. 核对实现与受影响调用点，更新相关功能文档的当前行为、默认值、安全边界和验证入口。
2. 更新 `docs/fork/delta.md` 的本地新增、官方文件修改、冲突热点或已被上游替代的差异；维护全部路径覆盖。只 fetch 不前移已集成上游 SHA。
3. 对已完成且验证的变化增加 `docs/changes/archive/YYYY-MM-DD-<slug>/summary.md`，列真实证据和未验证范围；纯措辞修改可不新增归档。
4. 领域词汇变化更新 `CONTEXT.md`；重要架构权衡按需记录 ADR。规格/任务留在 `.scratch/`，不替代当前事实。
5. 运行与变更相关的验证并审查实际差异。构建/离线行为入口见 `OMP_LOCAL_HANDOFF.md`；文档改动检查链接、路径覆盖和 Git 事实，不以旧测试日志冒充新结果。
6. 验证与文档同步完成后，自动总结本轮目的、主要变化、验证与已知风险，按任务范围显式暂存并创建本地 commit；不夹带用户无关改动，不提交失败或未完成的工作。最终回复给出提交 SHA 与结果；没有实际变更时不创建空提交。默认不自动 push。

在 `ask-matt` 路由下，`implement` 负责实现、评审、验证和知识收尾；适用的生产验证只返回发现，修复回到实现闭环。技术文档无法自动保证语义最新，不能把更新日期或通过语法检查当作行为验收。

## Agent skills

### Issue tracker
本地 Markdown：`.scratch/<feature>/`。见 `docs/agents/issue-tracker.md`。

### Triage labels
使用 Matt 默认五个分诊角色。见 `docs/agents/triage-labels.md`。

### Domain docs
single-context：根目录 `CONTEXT.md`；必要时在 `docs/adr/` 记录决策。
见 `docs/agents/domain.md`。
