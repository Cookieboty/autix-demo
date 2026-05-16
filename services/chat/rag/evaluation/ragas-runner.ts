/**
 * ragas-runner.ts
 *
 * 第十一章 11.7.3 — 接 RAGAS（Python 微服务）做 faithfulness / answer_relevancy 等评测
 *
 * 设计原则（重要）：
 *   - RAGAS 是独立 Python 服务，通过 HTTP 调用
 *   - 服务挂掉时**必须降级**，不能阻塞主流程 → 返回 null + warn
 *   - 自带 60s 超时 + 重试 3 次的轻量退避
 *
 * 注意：本文件不引入任何 SDK，只用全局 fetch（Bun / Node 20+ 自带）。
 */

export interface RagasSample {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth?: string;
}

export interface RagasRequest {
  samples: RagasSample[];
  metrics: string[];
}

export type RagasResult = Record<string, number> | null;

export interface RagasRunnerOptions {
  endpoint?: string;
  timeoutMs?: number;
  retries?: number;
  /** 注入 fetch，便于单测 mock */
  fetchImpl?: typeof fetch;
  /** 注入 warn，默认 console.warn */
  warn?: (msg: string, err?: unknown) => void;
}

const DEFAULT_ENDPOINT = process.env.RAGAS_ENDPOINT ?? 'http://localhost:7860/evaluate';

export async function runRagas(
  req: RagasRequest,
  options: RagasRunnerOptions = {},
): Promise<RagasResult> {
  const {
    endpoint = DEFAULT_ENDPOINT,
    timeoutMs = 60_000,
    retries = 3,
    fetchImpl = fetch,
    warn = (msg: string, err?: unknown) => console.warn(`[ragas] ${msg}`, err),
  } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        warn(`HTTP ${resp.status} on attempt ${attempt}`);
        if (attempt === retries) return null;
        continue;
      }
      const data = (await resp.json()) as Record<string, number>;
      return data;
    } catch (err) {
      clearTimeout(timer);
      warn(`request failed on attempt ${attempt}`, err);
      if (attempt === retries) return null;
      // 退避：第 i 次失败后等 200*i ms，避免反复砸
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  return null;
}
