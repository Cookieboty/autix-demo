/**
 * llm-tracer.ts
 *
 * 一个 LangChain BaseCallbackHandler，旁路观测每一次真实 LLM/工具调用：
 * - 记录 token 用量、延迟
 * - 带上当前请求的 traceId（来自 trace-context），与 HTTP 日志串联
 * - 喂给 Prometheus 指标（llm_calls_total / llm_tokens_total / llm_call_duration_seconds）
 * 不依赖任何外部 SaaS；LangSmith 仅在 LANGSMITH_TRACING=true 时另行启用。
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import { createLogger } from './logger';
import { recordLlmCall } from './metrics';

const log = createLogger('llm');

/**
 * 从 callback 的 LLMResult 里抠真实 token 用量。
 * 兼容两处来源（与 cost/with-token-usage.ts 的字段口径一致）：
 *   1) llmOutput.tokenUsage（OpenAI 经 callbacks 的常见落点）
 *   2) generations[].message.usage_metadata（LangChain v2 标准化字段）
 */
export function extractUsageFromLLMResult(output: LLMResult): {
  inputTokens: number;
  outputTokens: number;
} {
  const tu =
    (output.llmOutput as Record<string, any> | undefined)?.tokenUsage ??
    (output.llmOutput as Record<string, any> | undefined)?.usage;
  if (tu) {
    const inputTokens = tu.promptTokens ?? tu.prompt_tokens ?? tu.input_tokens ?? 0;
    const outputTokens =
      tu.completionTokens ?? tu.completion_tokens ?? tu.output_tokens ?? 0;
    if (inputTokens || outputTokens) return { inputTokens, outputTokens };
  }
  for (const gen of output.generations ?? []) {
    for (const g of gen ?? []) {
      const um = (g as any)?.message?.usage_metadata;
      if (um) {
        return {
          inputTokens: um.input_tokens ?? 0,
          outputTokens: um.output_tokens ?? 0,
        };
      }
    }
  }
  return { inputTokens: 0, outputTokens: 0 };
}

export class LlmTracer extends BaseCallbackHandler {
  name = 'llm-tracer';
  // runId → 开始时间，用于算单次调用延迟
  private starts = new Map<string, number>();

  handleLLMStart(llm: Serialized, prompts: string[], runId: string): void {
    this.starts.set(runId, Date.now());
    log.debug(
      { runId, model: (llm as any)?.id?.at?.(-1), promptChars: prompts.join('').length },
      'llm_start',
    );
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const latencyMs = Date.now() - (this.starts.get(runId) ?? Date.now());
    this.starts.delete(runId);
    const { inputTokens, outputTokens } = extractUsageFromLLMResult(output);
    log.info({ runId, latencyMs, inputTokens, outputTokens }, 'llm_end');
    recordLlmCall({ latencyMs, inputTokens, outputTokens, ok: true });
  }

  handleLLMError(err: Error, runId: string): void {
    const latencyMs = Date.now() - (this.starts.get(runId) ?? Date.now());
    this.starts.delete(runId);
    log.error({ runId, latencyMs, err: String(err).slice(0, 200) }, 'llm_error');
    recordLlmCall({ latencyMs, inputTokens: 0, outputTokens: 0, ok: false });
  }

  handleToolStart(tool: Serialized, input: string, runId: string): void {
    log.debug({ runId, tool: (tool as any)?.id?.at?.(-1), inputChars: input?.length ?? 0 }, 'tool_start');
  }

  handleToolEnd(output: unknown, runId: string): void {
    const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
    log.debug({ runId, outputChars: text.length }, 'tool_end');
  }
}
