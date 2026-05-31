/**
 * tool-policy.ts —— 工具权限分级 + 白名单（第十八章 18.4）。
 * 把第十二章 12.10 停留在测试里的概念模型，落成生产可用的配置。
 *
 * 两个黄金原则：
 *   - 默认 deny：未登记的工具按最高危（admin）处理、不暴露给 Agent
 *   - 白名单过滤：只有在册工具才进 Agent 的工具集
 */
export type ToolLevel = 'read' | 'write' | 'admin';

// 工具分级配置（未登记 = 默认 admin + 不在白名单）
const TOOL_LEVELS: Record<string, ToolLevel> = {
  analyze_completeness: 'read',
  estimate_complexity: 'read',
  search_competitors: 'read',
  search_best_practices: 'read',
  search_knowledge_base: 'read',
  web_search: 'read',
  create_requirement: 'write',
  save_report: 'write',
  delete_requirement: 'admin',
};

// 白名单：只有在册的工具才暴露给 Agent
const ALLOWLIST = new Set(Object.keys(TOOL_LEVELS));

/** 未知工具按 admin（最严），实现「默认 deny」 */
export function classify(toolName: string): ToolLevel {
  return TOOL_LEVELS[toolName] ?? 'admin';
}

export function isAllowed(toolName: string): boolean {
  return ALLOWLIST.has(toolName);
}

/** 写 / admin 级需人工审批（HITL）；read 级放行 */
export function requiresApproval(toolName: string): boolean {
  const level = classify(toolName);
  return level === 'write' || level === 'admin';
}
