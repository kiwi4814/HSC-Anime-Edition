# Triage Labels

| Matt 角色 | 本地 Status |
|---|---|
| needs-triage | needs-triage |
| needs-info | needs-info |
| ready-for-agent | ready-for-agent |
| ready-for-human | ready-for-human |
| wontfix | wontfix |

分类使用 `Category: bug` 或 `Category: enhancement`。
分诊角色与 Wayfinder 的 claimed/resolved 生命周期分别解释。

- `needs-triage`：维护者需评估；`needs-info`：等待补充事实。
- `ready-for-agent`：需求与验收已明确；`ready-for-human`：需人工操作或判断。
- `wontfix`：不采取行动，记录理由。

这五个字符串是本地 Markdown 元数据，不创建 GitHub 标签。分诊项只保留一个分类和一个分诊角色；角色冲突先解决再执行。
