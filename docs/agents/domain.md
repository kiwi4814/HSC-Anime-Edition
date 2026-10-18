# Domain Docs

- single-context：探索前读取根目录 [CONTEXT.md](../../CONTEXT.md) 中相关领域词汇。
- 读取 `docs/adr/` 中与当前改动有关的决策；不存在时继续，仅在真实术语或重要权衡形成后创建。
- 使用词汇表中的名称；发现与 ADR 冲突时明确提出。
- 当前功能行为见 `docs/features/`；历史变化见 `docs/changes/archive/`。
- Fork 差异和同步规则分别见 [delta.md](../fork/delta.md)、[upstream-sync.md](../fork/upstream-sync.md)。
- 规格和任务留在 `.scratch/`，不混入领域词汇表。

## 文档职责

`CONTEXT.md` 只定义领域概念，不存架构、计划、实现清单或 Git 操作。功能文档记录当前行为与代码/验证入口；历史归档记录完成的变化与当时证据，不重新定义当前行为。

ADR 按需编号创建于 `docs/adr/`：仅记录难逆、没有背景会令人意外且存在真实备选方案的重要决策。本次采用单上下文和现有 Git 分支约定不额外制造 ADR。

导航见 [文档索引](../README.md)。未来新增功能时补相应入口，不把规格、任务或临时交接材料当作长期功能说明。
