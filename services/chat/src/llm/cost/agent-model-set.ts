/**
 * agent-model-set.ts
 *
 * 第十章 10.7：按 Agent 角色配置默认模型 + 运行时覆盖。
 */

export interface AgentModelSet {
  supervisorModelConfigId: string;
  functionalModelConfigId: string;
  performanceModelConfigId: string;
  securityModelConfigId: string;
  complianceModelConfigId: string;
  riskModelConfigId: string;
  summaryModelConfigId: string;
  criticModelConfigId: string;
  compressorModelConfigId: string;
}

export const DEFAULT_AGENT_MODEL_SET: AgentModelSet = {
  supervisorModelConfigId: 'demo-gpt-4o',
  functionalModelConfigId: 'demo-gpt-4o-mini',
  performanceModelConfigId: 'demo-gpt-4o-mini',
  securityModelConfigId: 'demo-gpt-4o',
  complianceModelConfigId: 'demo-gpt-4o',
  riskModelConfigId: 'demo-gpt-4o-mini',
  summaryModelConfigId: 'demo-gpt-4o',
  criticModelConfigId: 'demo-gpt-4o',
  compressorModelConfigId: 'demo-deepseek-chat',
};

export type AgentName =
  | 'supervisor'
  | 'functional_expert'
  | 'performance_expert'
  | 'security_expert'
  | 'compliance_expert'
  | 'risk_agent'
  | 'summary_agent'
  | 'critic'
  | 'compressor';

const AGENT_TO_CONFIG_KEY: Record<AgentName, keyof AgentModelSet> = {
  supervisor: 'supervisorModelConfigId',
  functional_expert: 'functionalModelConfigId',
  performance_expert: 'performanceModelConfigId',
  security_expert: 'securityModelConfigId',
  compliance_expert: 'complianceModelConfigId',
  risk_agent: 'riskModelConfigId',
  summary_agent: 'summaryModelConfigId',
  critic: 'criticModelConfigId',
  compressor: 'compressorModelConfigId',
};

const HIGH_RISK_AGENTS: AgentName[] = [
  'supervisor',
  'security_expert',
  'compliance_expert',
  'critic',
  'summary_agent',
];

export interface ResolveModelInput {
  agentName: AgentName;
  defaultModelSet?: AgentModelSet;
  requirementComplexity?: 'low' | 'medium' | 'high';
  activeExperts?: string[];
  budgetStatus?: { usedPercent: number };
}

export interface ResolveModelResult {
  selectedModelConfigId: string;
  overrideReason: string | null;
}

/**
 * 根据 Agent 角色、需求复杂度和预算状态选择模型。
 * 两层逻辑：
 * 1. 默认按角色查表
 * 2. 运行时根据复杂度/预算覆盖
 */
export function resolveModelForAgent(input: ResolveModelInput): ResolveModelResult {
  const modelSet = input.defaultModelSet || DEFAULT_AGENT_MODEL_SET;
  const configKey = AGENT_TO_CONFIG_KEY[input.agentName];
  if (!configKey) {
    return { selectedModelConfigId: modelSet.functionalModelConfigId, overrideReason: `unknown agent: ${input.agentName}` };
  }

  const defaultId = modelSet[configKey];
  const isHighRisk = HIGH_RISK_AGENTS.includes(input.agentName);
  const budgetPercent = input.budgetStatus?.usedPercent ?? 0;

  if (budgetPercent >= 100) {
    if (input.agentName === 'compressor') {
      return { selectedModelConfigId: defaultId, overrideReason: null };
    }
    return { selectedModelConfigId: defaultId, overrideReason: 'budget_exceeded_reject' };
  }

  if (budgetPercent >= 80 && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: `budget_tight_downgrade (${budgetPercent}%)`,
    };
  }

  if (input.requirementComplexity === 'low' && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: 'low_complexity_downgrade',
    };
  }

  return { selectedModelConfigId: defaultId, overrideReason: null };
}
