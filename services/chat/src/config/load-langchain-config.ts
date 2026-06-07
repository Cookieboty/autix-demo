import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnvFile } from 'node:process';
import * as yaml from 'js-yaml';

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

let localEnvLoaded = false;

function loadLocalEnv() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    loadEnvFile(envPath);
  }
}

export function loadLangChainConfig(): LangChainAppConfig {
  const filePath = path.join(process.cwd(), 'config', 'langchain.yaml');
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.load(raw) as LangChainAppConfig;
}

export function getApiKeys() {
  loadLocalEnv();

  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    embeddingApiKey:
      process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    vectorDbUrl: process.env.VECTOR_DB_URL,
    vectorDbApiKey: process.env.VECTOR_DB_API_KEY,
  };
}
