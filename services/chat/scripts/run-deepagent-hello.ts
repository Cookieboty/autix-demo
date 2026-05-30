/**
 * DeepAgent Hello World — 第十四章 14.4 配套脚本
 *
 * 演示最小可运行的 DeepAgent：
 * 1. 一个自定义工具 get_weather
 * 2. createDeepAgent 一行装好 write_todos / 虚拟文件系统 / task 子 Agent
 * 3. 打印最终回复、todos、files
 *
 * 运行：
 *   cd services/chat && bun run scripts/run-deepagent-hello.ts
 */
import { createDeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { config } from 'dotenv';

config({ path: new URL('../.env', import.meta.url).pathname });

const getWeather = new DynamicStructuredTool({
  name: 'get_weather',
  description: '获取指定城市的天气',
  schema: z.object({ city: z.string().describe('城市名') }),
  func: async ({ city }) => `${city}：晴，28°C，微风`,
});

const agent = createDeepAgent({
  model: new ChatOpenAI({
    model: process.env.DEEPAGENT_MODEL || 'gpt-5.4',
    temperature: 0,
    configuration: { baseURL: process.env.OPENAI_BASE_URL },
  }),
  tools: [getWeather],
  systemPrompt: '你是一个天气助手。用户问天气时，调用 get_weather 工具获取数据。',
});

const result = await agent.invoke({
  messages: [{ role: 'user', content: '北京今天天气怎么样？' }],
});

const lastMsg = result.messages[result.messages.length - 1];
console.log('🤖 回复:', lastMsg.content);
console.log('📋 todos:', JSON.stringify(result.todos ?? [], null, 2));
console.log('📁 files:', Object.keys(result.files ?? {}));
