#!/usr/bin/env python3
"""
需求完整性分析工具

属于 requirement-analysis Skill，跟随 SKILL.md 一起分发。
接收 JSON 输入（stdin 或命令行参数），输出 JSON 结果。

用法：
  echo '{"requirementText": "作为管理员，我需要..."}' | python analyze_completeness.py
  python analyze_completeness.py '作为管理员，我需要能够批量导入用户数据'
"""
import json
import sys
import re

DIMENSIONS = [
    {"name": "用户角色", "keywords": ["用户", "角色", "作为", "管理员", "运营", "客户"]},
    {"name": "功能描述", "keywords": ["能够", "可以", "支持", "实现", "需要", "提供"]},
    {"name": "验收标准", "keywords": ["验收", "标准", "应该", "必须", "预期", "条件"]},
    {"name": "优先级",   "keywords": ["优先", "P0", "P1", "P2", "紧急", "重要"]},
    {"name": "非功能需求", "keywords": ["性能", "安全", "并发", "响应时间", "可用性", "容量"]},
    {"name": "边界条件", "keywords": ["边界", "异常", "限制", "最大", "最小", "超过"]},
]


def analyze(requirement_text: str) -> dict:
    covered = []
    missing = []

    for dim in DIMENSIONS:
        if any(kw in requirement_text for kw in dim["keywords"]):
            covered.append(dim["name"])
        else:
            missing.append(dim["name"])

    score = round(len(covered) / len(DIMENSIONS) * 100)

    return {
        "completenessScore": score,
        "coveredDimensions": covered,
        "missingDimensions": missing,
        "suggestion": f"建议补充：{'、'.join(missing)}" if missing else "需求完整",
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

    result = analyze(text)
    print(json.dumps(result, ensure_ascii=False, indent=2))
