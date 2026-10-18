# Issue tracker: Local Markdown

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`spec.md`。
- 任务：`issues/<NN>-<slug>.md`，每个任务独立文件，从 01 编号。
- 实现任务顶部记录 `Status:`；评论追加到 `## Comments`。
- 引用任务时使用完整路径，避免不同功能目录的编号混淆。
- “发布到 issue tracker”指创建或更新本地文件，不调用 GitHub Issues。
- Wayfinder 使用 `map.md` 和独立子任务；子任务用 `Type:`、`Status: claimed/resolved`、`Blocked by:` 记录决策工作。
- 工作产物不替代当前功能文档或历史归档；默认随 Git 保留。

## 消费约定

`to-spec` 写入对应 `spec.md`；`to-tickets` 写入独立任务文件；`implement` 按传入的完整任务路径读取内容和阻塞关系。分诊角色见 [triage-labels.md](triage-labels.md)。

普通实现任务的分诊角色保存在 `Status:`，执行进度可另用 `Execution: not-started/in-progress/completed`；已关闭项记录 `Resolution:` 与实际证据，不把“通过分诊”当作“实现完成”。Wayfinder 的 `claimed/resolved` 是决策任务生命周期，不替换实现任务的分诊词汇。

临时跨会话 execution packet/state 按生产者声明处理；只有明确指定为临时的精确路径才排除，不能用整个 `.scratch/` 的忽略规则隐藏任务。不要把生产密钥、个人环境或运行时配置写入本地任务。
