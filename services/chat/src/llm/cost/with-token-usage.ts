/**
 * with-token-usage.ts
 *
 * 第十章 10.8：节点级 Token usage 自动采集包装器。
 * 包装模型调用函数，自动记录 usage + latency。
 */
import { TokenUsageService, TokenUsageRecord } from './token-usage.service';
import { estimateTextTokens, getModelPricing } from './token-estimator';

export interface WithTokenUsageOptions {
  graphName: string;
  nodeName: string;
  agentName: string;
  modelConfigId?: string;
  modelName: string;
  provider?: string;
  conversationId?: string;
  messageId?: string;
  threadId?: string;
  overrideReason?: string;
}

/**
 * 包装一个模型调用函数，自动采集 Token usage 并持久化。
 * recordUsage 失败不影响模型调用结果。
 */
export async function withTokenUsage<T>(
  options: WithTokenUsageOptions,
  usageService: TokenUsageService | null,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - start;

  if (!usageService) return result;

  try {
    // 尝试从 response metadata 读取 usage
    const usage = extractUsageFromResponse(result);
    const pricing = getModelPricing(options.modelName);

    let inputTokens: number;
    let outputTokens: number;
    let cachedInputTokens: number;
    let isEstimated: boolean;

    if (usage) {
      inputTokens = usage.inputTokens;
      outputTokens = usage.outputTokens;
      cachedInputTokens = usage.cachedInputTokens || 0;
      isEstimated = false;
    } else {
      // 回退到估算（provider 没回 usage 时才走这里）。
      // 倍率 5 来自第十章 10.2 的真实样本（输入 ≈ 5.8x 输出），取保守圆整。
      // 不同场景比例在 3-7 之间波动，估算只是兜底，应优先依赖 provider 真实 usage。
      const content = extractContentFromResponse(result);
      outputTokens = estimateTextTokens(content);
      inputTokens = outputTokens * 5;
      cachedInputTokens = 0;
      isEstimated = true;
    }

    const normalInputTokens = inputTokens - cachedInputTokens;
    const estimatedCostUsd =
      (normalInputTokens / 1_000_000) * pricing.input +
      (cachedInputTokens / 1_000_000) * (pricing.cachedInput || pricing.input) +
      (outputTokens / 1_000_000) * pricing.output;

    const record: TokenUsageRecord = {
      ...options,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens,
      estimatedCostUsd,
      isEstimated,
      latencyMs,
    };

    await usageService.recordUsage(record);
  } catch (err) {
    console.warn('[withTokenUsage] Failed to record usage, skipping:', err);
  }

  return result;
}

function extractUsageFromResponse(response: any): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
} | null {
  // LangChain ChatOpenAI 把 usage 放在 response_metadata.usage 或 usage_metadata
  const metadata = response?.response_metadata || response?.usage_metadata;
  if (!metadata) return null;

  const usage = metadata.usage || metadata.token_usage || metadata;
  if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens || 0,
    };
  }
  // LangChain v2 format
  if (usage?.input_tokens != null && usage?.output_tokens != null) {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedInputTokens: usage.cache_read_input_tokens || 0,
    };
  }
  return null;
}

function extractContentFromResponse(response: any): string {
  if (typeof response === 'string') return response;
  if (response?.content) return String(response.content);
  if (response?.text) return String(response.text);
  return '';
}
