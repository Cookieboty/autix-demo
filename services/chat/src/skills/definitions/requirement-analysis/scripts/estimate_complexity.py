#!/usr/bin/env python3
"""
需求复杂度估算工具

属于 requirement-analysis Skill，跟随 SKILL.md 一起分发。
根据需求文本中的关键特征词估算技术复杂度。

用法：
  echo '{"requirementText": "批量导入，需要第三方 API 集成"}' | python estimate_complexity.py
  python estimate_complexity.py '批量导入用户数据，需要第三方 API 集成'
"""
import json
import re
import sys

FACTORS = [
    {"pattern": r"集成|第三方|API|对接", "name": "外部集成", "weight": 3},
    {"pattern": r"批量|导入|导出|迁移|同步", "name": "数据处理", "weight": 2},
    {"pattern": r"实时|推送|WebSocket|SSE", "name": "实时通信", "weight": 2},
    {"pattern": r"AI|智能|模型|机器学习", "name": "AI/ML", "weight": 3},
    {"pattern": r"权限|RBAC|多租户|隔离", "name": "权限体系", "weight": 2},
    {"pattern": r"分布式|微服务|消息队列|MQ", "name": "分布式架构", "weight": 3},
]

SIZE_MAP = {
    range(0, 3): ("S", "1-3天"),
    range(3, 5): ("M", "3-7天"),
    range(5, 7): ("L", "1-3周"),
    range(7, 100): ("XL", "3周以上"),
}


def estimate(requirement_text: str) -> dict:
    score = 0
    matched_factors = []

    for factor in FACTORS:
        if re.search(factor["pattern"], requirement_text):
            score += factor["weight"]
            matched_factors.append(factor["name"])

    size, days = "S", "1-3天"
    for r, (s, d) in SIZE_MAP.items():
        if score in r:
            size, days = s, d
            break

    return {
        "size": size,
        "estimatedDays": days,
        "complexityScore": score,
        "factors": matched_factors,
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        text = sys.argv[1]
    else:
        raw = sys.stdin.read().strip()
        try:
            data = json.loads(raw)
            text = data.get("requirementText", raw)
        except json.JSONDecodeError:
            text = raw

    result = estimate(text)
    print(json.dumps(result, ensure_ascii=False, indent=2))
