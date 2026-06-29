import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface LlmConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface RetrievalConfig {
  enabled: boolean;
  topK: number;
  /** 检索模式：simple=纯向量；hybrid=向量+BM25 多召回再重排（第二十章 20.2，默认 hybrid） */
  mode?: 'simple' | 'hybrid';
  /**
   * 检索整体超时（毫秒）。检索是"锦上添花"，绝不能拖垮主链路：
   * embedding 模型首次下载、向量库不可达等"挂起"场景下，超时即降级为空上下文，主链继续。
   * 默认 8000ms。
   */
  timeoutMs?: number;
}

export interface ToolsConfig {
  enableWordCount: boolean;
  enableKeywordExtract: boolean;
}

export interface FeaturesConfig {
  enableStructuredOutput: boolean;
  enableStreaming: boolean;
}

export interface LangChainConfig {
  llm: LlmConfig;
  retrieval: RetrievalConfig;
  tools: ToolsConfig;
  features: FeaturesConfig;
}

export interface ApiKeys {
  openaiApiKey: string;
  openaiBaseUrl: string;
  embeddingApiKey: string;
  vectorDbUrl: string;
  vectorDbApiKey: string;
}

let cachedConfig: LangChainConfig | null = null;

export function loadLangChainConfig(): LangChainConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = path.resolve(
    process.cwd(),
    "config",
    "langchain.yaml"
  );
  const fileContents = fs.readFileSync(configPath, "utf8");
  cachedConfig = yaml.load(fileContents) as LangChainConfig;
  return cachedConfig;
}

export function getApiKeys(): ApiKeys {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    embeddingApiKey: process.env.EMBEDDING_API_KEY ?? "",
    vectorDbUrl: process.env.VECTOR_DB_URL ?? "http://localhost:6333",
    vectorDbApiKey: process.env.VECTOR_DB_API_KEY ?? "",
  };
}
