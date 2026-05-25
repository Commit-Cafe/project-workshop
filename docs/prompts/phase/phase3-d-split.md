根据已确认的 PRD，将需求拆解为开发任务清单。

## 输出要求
以 JSON 数组格式输出，每个任务包含：
```json
[
  {
    "title": "任务标题",
    "description": "详细描述",
    "techNotes": "技术要点提示",
    "acceptanceCriteria": ["标准1", "标准2"],
    "priority": 1
  }
]
```

## 规则
- priority: 1 最高，按依赖关系排序
- 每个任务应独立可测试
- 标注任务间的依赖关系
