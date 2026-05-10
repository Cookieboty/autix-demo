/**
 * budget-policy.ts
 *
 * 第十章 10.9：预算策略选择器。
 * 根据预算使用率、Agent 角色和需求风险等级决定 allow / downgrade / reject。
 */

export type BudgetAction = 'allow' | 'downgrade' | 'reject';

export interface BudgetPolicyInput {
  budgetUsedPercent: number;
  agentName: string;
  requirementRiskLevel?: 'low' | 'medium' | 'high';
  activeExperts?: string[];
}

export interface BudgetPolicyResult {
  action: BudgetAction;
  reason: string;
}

const HIGH_RISK_AGENTS = ['supervisor', 'security_expert', 'compliance_expert', 'critic', 'summary_agent'];

export function resolveBudgetAction(input: BudgetPolicyInput): BudgetPolicyResult {
  const { budgetUsedPercent, agentName, requirementRiskLevel } = input;

  if (budgetUsedPercent < 80) {
    return { action: 'allow', reason: `budget OK (${budgetUsedPercent}%)` };
  }

  if (budgetUsedPercent < 100) {
    const isHighRisk = HIGH_RISK_AGENTS.includes(agentName);
    const isHighRiskReq = requirementRiskLevel === 'high';

    if (isHighRisk && isHighRiskReq) {
      return { action: 'allow', reason: `high-risk agent+requirement, no downgrade (${budgetUsedPercent}%)` };
    }

    if (isHighRisk) {
      return { action: 'allow', reason: `high-risk agent, no downgrade (${budgetUsedPercent}%)` };
    }

    return { action: 'downgrade', reason: `budget tight, low-risk agent can downgrade (${budgetUsedPercent}%)` };
  }

  if (agentName === 'compressor') {
    return { action: 'allow', reason: 'compressor allowed even over budget (cost reduction purpose)' };
  }

  return { action: 'reject', reason: `budget exceeded (${budgetUsedPercent}%)` };
}
