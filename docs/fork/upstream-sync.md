# 同步上游与持续维护

适用：检查上游更新、把官方 HSC 变化合入 Anime Edition，或完成任意本地功能调整。当前差异与已集成上游提交以 [delta.md](delta.md) 为准；构建入口见 [本地验证](../../OMP_LOCAL_HANDOFF.md)。

## 分支职责

- `upstream/main`：官方远端跟踪分支；fetch 后可前进，不等于已经集成。
- `origin/develop`：个人 Fork 的共享开发分支；本地 `develop` 跟踪它。
- `main`：当前本地仍跟踪官方 `upstream/main`，不是 Anime Edition 的发布分支。
- `feature/<name>`：本地功能分支；`sync/upstream-YYYY-MM-DD`：单次上游集成分支。
- `baseline-2026-10-18`：固定源码基线，保持不变；上游同步不移动旧标签。

默认用 **merge 保留双方历史**。公共开发分支不 rebase、不强推；不用整树覆盖把官方版本替换进 Fork。若只取一个补丁，记录来源提交与理由，不能据此宣称整个上游提交已集成。

## 1. 检查与固定目标

开始前确认工作区没有 staged、unstaged 或普通 untracked 改动。用户未完成的修改先由其决定如何保存，不自动 stash/reset。以下是维护时执行的步骤，本次文档初始化没有执行合并。

```bash
git status --short --branch
git remote -v
git fetch origin
git switch develop
git merge --ff-only origin/develop
git fetch upstream --prune
UPSTREAM_TARGET=$(git rev-parse refs/remotes/upstream/main)
git log --oneline develop.."$UPSTREAM_TARGET"
git diff --stat develop..."$UPSTREAM_TARGET"
```

核对 remote URL 与差异台账。把 `UPSTREAM_TARGET` 的完整 SHA 记录到本次本地任务；从此按该 SHA 评审，不把移动中的分支名当作版本。若官方重写了历史、登记的已集成上游不再是目标的祖先，或存在无法解释的双方提交，先解释原因，不自动“修复”分支。

只有 fetch 或检查，没有合并时：可更新“上次检查”记录，**不能**前移台账中的“已集成上游”。没有上游新提交时，记录检查结果，不造空合并。

## 2. 在独立分支合并

分支名撞名时先检查已有工作，使用新后缀，不覆盖旧分支。下面使用同一个 shell 中固定的 `UPSTREAM_TARGET`：

```bash
SYNC_BRANCH="sync/upstream-$(date -u +%F)"
git switch -c "$SYNC_BRANCH"
git merge --no-ff --no-commit "$UPSTREAM_TARGET"
```

冲突发生时，在当前合并中逐块处理：读取双方提交意图及原始来源；必要时使用 `resolving-merge-conflicts`。不整文件选择 ours/theirs；保留用户无关改动，不以重新拉取、硬重置或重新克隆代替冲突分析。

按 [差异台账](delta.md) 逐项保留本地意图，重点：

1. 插件身份、路由、程序集名及任务 Key；不能把本地配置、缓存或已管理合集无意切换到另一身份。
2. 中文 UI 与任务/日志文案；对照技术标识，不能把协议字段也翻译。
3. 动漫精确规则、批准门槛、Dry Run、人工成员/合集归属保护。
4. 统一 AI 请求与响应 DTO、密钥导出规则、新装和旧配置的不同默认语义。
5. `PluginConfiguration`、备份 DTO、导出/导入、前端加载/保存的所有受影响调用点；不要只消除编译冲突。
6. 官方修复是否已经替代本地实现。确有等价证据时删除多余本地差异，并在历史中记录原因。

若上游新增数据迁移、外部集成或配置语义，按 `ask-matt` 路由其适用检查；集成分支不自动授权生产部署。

## 3. 验证并更新知识

按 [本地构建文档](../../OMP_LOCAL_HANDOFF.md) 在匹配的编译引用下执行 Release 重建、离线回归、独立预览及静态/JS 检查。覆盖受影响的真实运行路径；只有离线证据时明确未验证的 Emby/浏览器/外部服务边界。用户可见 UI 改动要补浏览器实测，不能仅凭语法通过。

本轮验证后，同一变更集更新：

| 内容变化 | 必须更新 |
|---|---|
| 新增/修改/删除本地功能 | 相关 `docs/features/<feature>/README.md`、`delta.md` |
| 新改了官方文件或本地差异被上游替代 | `delta.md` 的文件覆盖、维护意图与冲突热点 |
| 领域术语或重要权衡确实改变 | `CONTEXT.md`；达到 ADR 条件时写 `docs/adr/` |
| 完成并验证的功能/修复/同步 | `docs/changes/archive/YYYY-MM-DD-<slug>/summary.md` |
| 仅初始化/修改工作流 | 对应 `docs/agents/` 或本维护文档；没有行为变化就明确说明 |

文档是当前行为的单一事实入口；历史归档保存当时结果；`.scratch/` 保存规格与任务。维护入口、详细行为、历史证据相互链接，不把同一规则复制到多个“最新”文档。

**差异覆盖检查**：对登记的固定上游 SHA 运行 `git diff --name-status <SHA> HEAD`，另检查 staged、unstaged、普通 untracked。每个实际差异路径都应在 `delta.md` 的对应文件行或明确目录覆盖规则中有维护归属；新增上游文件也要评估，不能只看冲突文件。禁止只改日期却不复核行为。

文档不会自行理解新功能；代理收尾规则和评审负责语义同步。本仓库当前没有自动阻断文档漂移的 CI，不宣称“永远自动最新”。

## 4. 完成与发布

对实际变更创建不可变 review snapshot，检查规范与规格；处理必修问题后刷新受影响证据。用户已授权常规任务完成且验证通过后自动总结并创建本地 commit，按任务范围显式暂存，不夹带无关改动、不创建空提交。上游同步产生的 merge commit、push、PR 和合并共享分支仍须当前任务另行授权，不因为文档提供了命令就自动执行。

经授权，可推送同步分支并向个人 Fork 的 `develop` 提 PR；不要默认向官方仓库发 PR。`develop` 接受该集成后，台账登记的上游 SHA 应是该分支祖先；已集成值只前移到真正合入的固定目标。

交付报告区分：检查了什么、选中了哪个 SHA、实际合入什么、保留/删除哪些本地差异、发生哪些冲突、运行了哪些验证、尚未验证什么。生产安装、容器操作与真实合集写入另行批准。
