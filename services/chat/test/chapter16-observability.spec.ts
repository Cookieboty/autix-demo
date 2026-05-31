/**
 * chapter16-observability.spec.ts
 *
 * 第十六章《可观测性》配套测试
 *
 * Layer 1：零 LLM 依赖（确定性）
 *   - trace-context：ALS 在嵌套异步里保持同一 traceId
 *   - logger.traceMixin：从 ALS 读到当前 traceId
 *   - metrics：注册自定义指标 + recordLlmCall 累加
 *   - llm-tracer：extractUsageFromLLMResult 兼容两种 usage 来源；handleLLMEnd 不抛错
 *   - wrapNodeUsage（opt-in）：无 usageService 裸跑；有则把真实 token 写进 recordUsage
 * Layer 2：真实图端到端（需 OPENAI_API_KEY 且 RUN_LLM_OBS_TESTS=1）
 *   - createAnalysisGraph({ usageService }) 跑一次分析 → 注入的计量服务收到 ≥1 条真实记录
 *
 * 运行方式：
 *   bun test test/chapter16-observability.spec.ts
 */
import { describe, it, expect } from 'bun:test';
import { ChatOpenAI } from '@langchain/openai';
import { config } from 'dotenv';
import {
  runWithTrace,
  getTraceId,
  getElapsedMs,
  newTraceId,
} from '../src/observability/trace-context';
import { traceMixin } from '../src/observability/logger';
import { registry, recordLlmCall } from '../src/observability/metrics';
import { LlmTracer, extractUsageFromLLMResult } from '../src/observability/llm-tracer';
import {
  wrapNodeUsage,
  createAnalysisGraph,
  type GraphObservability,
} from '../src/llm/graph/requirement-analysis-graph';
import type { TokenUsageRecord, TokenUsageService } from '../src/llm/cost/token-usage.service';

config({ path: new URL('../.env', import.meta.url).pathname });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const LLM_OBS_TEST_MODEL = process.env.LLM_OBS_TEST_MODEL || 'gpt-5.4';
const RUN_LLM_OBS_TESTS = process.env.RUN_LLM_OBS_TESTS === '1';
const SKIP_LLM = !OPENAI_API_KEY || !RUN_LLM_OBS_TESTS;

if (SKIP_LLM) {
  console.warn('⚠️  LLM 集成测试将跳过：需要 OPENAI_API_KEY 且 RUN_LLM_OBS_TESTS=1');
}

/** 内存版计量服务：实现 recordUsage 契约，便于断言「被调用 + 收到的字段」。 */
function makeCapturingUsageService() {
  const records: TokenUsageRecord[] = [];
  const service = {
    recordUsage: async (r: TokenUsageRecord) => {
      records.push(r);
    },
  } as unknown as TokenUsageService;
  return { service, records };
}

// ============================================================================
// Layer 1：零 LLM 依赖
// ============================================================================

describe('16.2 trace-context：AsyncLocalStorage', () => {
  it('上下文外读到 no-trace', () => {
    expect(getTraceId()).toBe('no-trace');
  });

  it('嵌套异步调用链里保持同一 traceId', async () => {
    const id = newTraceId();
    const seen: string[] = [];
    await runWithTrace(id, async () => {
      seen.push(getTraceId());
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      seen.push(getTraceId());
      await (async () => {
        seen.push(getTraceId());
      })();
    });
    expect(seen).toEqual([id, id, id]);
  });

  it('并发的两个请求互不串台', async () => {
    const a = newTraceId();
    const b = newTraceId();
    const [ra, rb] = await Promise.all([
      runWithTrace(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getTraceId();
      }),
      runWithTrace(b, async () => {
        await new Promise((r) => setTimeout(r, 2));
        return getTraceId();
      }),
    ]);
    expect(ra).toBe(a);
    expect(rb).toBe(b);
  });

  it('getElapsedMs 在上下文内 >= 0，上下文外为 0', async () => {
    expect(getElapsedMs()).toBe(0);
    const elapsed = await runWithTrace(newTraceId(), async () => {
      await new Promise((r) => setTimeout(r, 3));
      return getElapsedMs();
    });
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});

describe('16.2 logger：traceMixin 自动注入 traceId', () => {
  it('mixin 在上下文内返回当前 traceId', async () => {
    const id = newTraceId();
    const injected = await runWithTrace(id, async () => traceMixin());
    expect(injected).toEqual({ traceId: id });
  });

  it('mixin 在上下文外返回 no-trace', () => {
    expect(traceMixin()).toEqual({ traceId: 'no-trace' });
  });
});

describe('16.5.1 metrics：注册与累加', () => {
  it('registry 暴露自定义与默认指标名', async () => {
    const text = await registry.metrics();
    expect(text).toContain('llm_calls_total');
    expect(text).toContain('llm_tokens_total');
    expect(text).toContain('llm_call_duration_seconds');
    expect(text).toContain('http_request_duration_seconds');
    expect(text).toContain('sse_active_connections');
    // collectDefaultMetrics 的进程指标
    expect(text).toContain('process_cpu_user_seconds_total');
  });

  it('recordLlmCall 让 llm_calls_total 增加', async () => {
    const before = await registry.getSingleMetricAsString('llm_calls_total');
    recordLlmCall({ latencyMs: 1200, inputTokens: 100, outputTokens: 40, ok: true });
    const after = await registry.getSingleMetricAsString('llm_calls_total');
    // 至少出现一个 ok="true" 的计数样本
    expect(after).toContain('llm_calls_total{ok="true"}');
    expect(after).not.toBe(before);
  });
});

describe('16.3 llm-tracer：usage 提取与回调', () => {
  it('从 llmOutput.tokenUsage 提取（OpenAI callbacks 口径）', () => {
    const usage = extractUsageFromLLMResult({
      generations: [],
      llmOutput: { tokenUsage: { promptTokens: 30, completionTokens: 12 } },
    } as any);
    expect(usage).toEqual({ inputTokens: 30, outputTokens: 12 });
  });

  it('从 generations[].message.usage_metadata 提取（v2 口径）', () => {
    const usage = extractUsageFromLLMResult({
      generations: [[{ message: { usage_metadata: { input_tokens: 7, output_tokens: 3 } } } as any]],
      llmOutput: {},
    } as any);
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('拿不到 usage 时返回 0 而不抛错', () => {
    expect(extractUsageFromLLMResult({ generations: [], llmOutput: {} } as any)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('handleLLMStart/End 不抛错并喂给指标', () => {
    const tracer = new LlmTracer();
    expect(() => {
      tracer.handleLLMStart({ id: ['ChatOpenAI'] } as any, ['hello'], 'run-1');
      tracer.handleLLMEnd(
        { generations: [], llmOutput: { tokenUsage: { promptTokens: 5, completionTokens: 2 } } } as any,
        'run-1',
      );
    }).not.toThrow();
  });
});

describe('16.4 wrapNodeUsage：opt-in 接入契约', () => {
  it('无 usageService 时只裸跑 fn，不记录', async () => {
    let called = 0;
    const result = await wrapNodeUsage(undefined, 'summaryStep.actor', 'summary', async () => {
      called++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(called).toBe(1);
  });

  it('有 usageService 时把真实 token 写进 recordUsage', async () => {
    const { service, records } = makeCapturingUsageService();
    const obs: GraphObservability = {
      usageService: service,
      conversationId: 'conv-123',
      modelName: 'gpt-5.4',
    };
    // 模拟一次返回了 usage 元数据的 LLM 响应
    const fakeResponse = {
      content: '报告正文',
      response_metadata: { usage: { prompt_tokens: 120, completion_tokens: 48 } },
    };
    const result = await wrapNodeUsage(obs, 'summaryStep.actor', 'summary', async () => fakeResponse);
    expect(result).toBe(fakeResponse);
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({
      graphName: 'requirement-analysis',
      nodeName: 'summaryStep.actor',
      agentName: 'summary',
      modelName: 'gpt-5.4',
      conversationId: 'conv-123',
      inputTokens: 120,
      outputTokens: 48,
      isEstimated: false,
    });
  });
});

// ============================================================================
// Layer 2：真实图端到端（需 OPENAI_API_KEY + RUN_LLM_OBS_TESTS=1）
// ============================================================================

describe('16.4 真实图接入 Token 计量（Layer 2）', () => {
  it.skipIf(SKIP_LLM)(
    'createAnalysisGraph({ usageService }) 跑一次分析 → 收到 ≥1 条真实 token 记录',
    async () => {
      const model = new ChatOpenAI({
        model: LLM_OBS_TEST_MODEL,
        temperature: 0,
        configuration: { baseURL: OPENAI_BASE_URL },
        apiKey: OPENAI_API_KEY,
      });
      const { service, records } = makeCapturingUsageService();
      const graph = createAnalysisGraph(model, {
        usageService: service,
        conversationId: 'obs-e2e',
      });

      await graph.invoke({
        input: '给电商后台加一个支持百万行的订单异步导出功能',
        retrievedContext: '',
        messages: [],
      });

      expect(records.length).toBeGreaterThan(0);
      // 至少有一条拿到真实 token（input>0），且归属在 requirement-analysis 图
      expect(records.every((r) => r.graphName === 'requirement-analysis')).toBe(true);
      expect(records.some((r) => r.inputTokens > 0 && !r.isEstimated)).toBe(true);
    },
    600_000,
  );
});
