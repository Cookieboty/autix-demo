/**
 * token-estimator.ts
 *
 * 第十章 10.2：Token 成本近似估算。
 * 用于在 provider 不返回 usage metadata 时做回退估算。
 */

const PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00, cachedInput: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cachedInput: 0.075 },
  'claude-sonnet': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'claude-haiku': { input: 0.80, output: 4.00, cachedInput: 0.08 },
  'deepseek-chat': { input: 0.27, output: 1.10 },
};

/**
 * 近似估算文本 token 数。
 * 中文字符按 1 token，英文/数字每 4 个字符约 1 token。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}

export function getModelPricing(modelName: string) {
  return PRICING[modelName] || PRICING['gpt-4o-mini'];
}

export interface GraphNodeCostInput {
  nodeName: string;
  modelName: string;
  systemPrompt: string;
  toolSchemas?: string;
  messages?: string;
  outputText: string;
}

export interface GraphNodeCostResult {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/**
 * 估算单个图节点的 Token 成本。
 */
export function estimateGraphNodeCost(input: GraphNodeCostInput): GraphNodeCostResult {
  const inputText = [
    input.systemPrompt,
    input.toolSchemas || '',
    input.messages || '',
  ].join('\n');

  const inputTokens = estimateTextTokens(inputText);
  const outputTokens = estimateTextTokens(input.outputText);
  const pricing = getModelPricing(input.modelName);

  const estimatedCostUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return { inputTokens, outputTokens, estimatedCostUsd };
}
