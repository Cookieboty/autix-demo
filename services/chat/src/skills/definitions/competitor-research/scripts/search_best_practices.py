#!/usr/bin/env python3
"""
行业最佳实践搜索工具

属于 competitor-research Skill，跟随 SKILL.md 一起分发。
搜索指定主题的行业最佳实践和常见陷阱。

用法：
  echo '{"topic": "批量数据导入"}' | python search_best_practices.py
  python search_best_practices.py '批量数据导入'
"""
import json
import sys

PRACTICES_DB = {
    "批量导入": [
        {"title": "批量导入最佳实践", "source": "AWS 架构白皮书", "summary": "分批处理 + 异步队列 + 进度反馈，单批不超过 1000 条"},
        {"title": "批量导入常见陷阱", "source": "技术博客", "summary": "避免单事务写入大量数据，注意内存溢出和超时"},
        {"title": "CSV 导入安全要点", "source": "OWASP", "summary": "校验文件类型、限制文件大小、防止 CSV 注入"},
    ],
    "项目管理": [
        {"title": "敏捷项目管理最佳实践", "source": "Atlassian 博客", "summary": "Sprint 2 周、站会 15 分钟、回顾会驱动改进"},
        {"title": "需求管理常见陷阱", "source": "行业报告", "summary": "避免需求蔓延、明确 MVP 范围、用户故事需有验收标准"},
    ],
    "API 设计": [
        {"title": "RESTful API 设计指南", "source": "Google API Design Guide", "summary": "资源命名、版本控制、错误码标准化"},
        {"title": "API 安全最佳实践", "source": "OWASP API Top 10", "summary": "认证鉴权、限流、输入校验、日志审计"},
    ],
}


def search(topic: str) -> dict:
    practices = []
    topic_lower = topic.lower()

    for key, items in PRACTICES_DB.items():
        if key in topic_lower or topic_lower in key:
            practices = items
            break

    if not practices:
        practices = [
            {"title": f"{topic} 最佳实践", "source": "行业报告", "summary": "标准做法参考"},
            {"title": f"{topic} 常见陷阱", "source": "技术博客", "summary": "需要避免的问题"},
        ]

    return {"topic": topic, "practices": practices}


if __name__ == "__main__":
    if len(sys.argv) > 1:
        topic = sys.argv[1]
    else:
        raw = sys.stdin.read().strip()
        try:
            data = json.loads(raw)
            topic = data.get("topic", raw)
        except json.JSONDecodeError:
            topic = raw

    result = search(topic)
    print(json.dumps(result, ensure_ascii=False, indent=2))
