/**
 * LangGraph Studio 入口文件。
 * 导出编译后的 graph 实例，供 `bunx langgraphjs dev` 使用。
 */
import { ChatOpenAI } from '@langchain/openai';
import { createAnalysisGraph } from './requirement-analysis-graph';

const model = new ChatOpenAI({
  model: process.env.LLM_MODEL || 'gpt-4o',
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  apiKey: process.env.OPENAI_API_KEY,
});

export const graph = createAnalysisGraph(model);
