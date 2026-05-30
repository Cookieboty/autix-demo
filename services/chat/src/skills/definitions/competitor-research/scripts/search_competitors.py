#!/usr/bin/env python3
"""
竞品搜索工具

属于 competitor-research Skill，跟随 SKILL.md 一起分发。
根据关键词返回竞品信息（Demo 使用本地数据，生产环境可替换为真实搜索 API）。

用法：
  echo '{"query": "项目管理工具"}' | python search_competitors.py
  python search_competitors.py '项目管理工具'
"""
import json
import sys

COMPETITOR_DB = {
    "项目管理": [
        {"name": "Jira", "positioning": "企业级项目管理，面向中大型团队", "pricing": "$7.75/人/月起", "url": "https://atlassian.com"},
        {"name": "Linear", "positioning": "现代研发项目管理，面向技术团队", "pricing": "免费版 + $8/人/月", "url": "https://linear.app"},
        {"name": "Notion", "positioning": "全能知识管理 + 轻量项目管理", "pricing": "免费版 + $8/人/月", "url": "https://notion.so"},
        {"name": "飞书项目", "positioning": "协作优先的项目管理，面向中国市场", "pricing": "按版本付费", "url": "https://feishu.cn"},
    ],
    "设计工具": [
        {"name": "Figma", "positioning": "协作设计平台，业界标准", "pricing": "免费版 + $15/人/月", "url": "https://figma.com"},
        {"name": "Sketch", "positioning": "Mac 原生设计工具", "pricing": "$10/人/月", "url": "https://sketch.com"},
    ],
    "文档协作": [
        {"name": "Notion", "positioning": "All-in-one 知识管理", "pricing": "免费版 + $8/人/月", "url": "https://notion.so"},
        {"name": "Confluence", "positioning": "企业级 Wiki", "pricing": "$5.75/人/月起", "url": "https://atlassian.com/confluence"},
        {"name": "语雀", "positioning": "面向中国市场的知识管理", "pricing": "免费版 + 企业版", "url": "https://yuque.com"},
    ],
}


def search(query: str) -> dict:
    query_lower = query.lower()
    results = []

    for category, competitors in COMPETITOR_DB.items():
        if category in query_lower or any(c["name"].lower() in query_lower for c in competitors):
            results = competitors
            break

    if not results:
        results = [
            {"name": f"{query} 产品 A", "positioning": "市场领先者", "pricing": "按需定价", "url": "https://example.com/a"},
            {"name": f"{query} 产品 B", "positioning": "新兴挑战者", "pricing": "免费增值", "url": "https://example.com/b"},
        ]

    return {
        "query": query,
        "results": results,
        "summary": f"找到 {len(results)} 个竞品",
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = sys.argv[1]
    else:
        raw = sys.stdin.read().strip()
        try:
            data = json.loads(raw)
            query = data.get("query", raw)
        except json.JSONDecodeError:
            query = raw

    result = search(query)
    print(json.dumps(result, ensure_ascii=False, indent=2))
