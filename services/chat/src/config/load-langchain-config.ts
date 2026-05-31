import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export type LangChainAppConfig = {
  llm: {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  retrieval: {
    enabled: boolean;
    topK: number;
  };
  tools: {
    enableConstraintCheck: boolean;
    enableEntityLookup: boolean;
  };
  features: {
    enableStructuredOutput: boolean;
    enableStreaming: boolean;
  };
};

export function loadLangChainConfig(): LangChainAppConfig {
  const filePath = path.join(process.cwd(), 'config', 'langchain.yaml');
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) as LangChainAppConfig;
}

export function getApiKeys() {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    embeddingApiKey:
      process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    vectorDbUrl: process.env.VECTOR_DB_URL,
    vectorDbApiKey: process.env.VECTOR_DB_API_KEY,
  };
}
