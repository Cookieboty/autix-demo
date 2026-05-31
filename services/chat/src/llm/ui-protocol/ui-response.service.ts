/**
 * ui-response.service.ts
 *
 * 用 LangChain 的 withStructuredOutput 把模型输出约束成 UI 协议。
 * 结构化输出只约束"格式"，System Prompt 负责约束"在什么场景用什么组件"。
 */
import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory';
import { aiUIResponseSchema } from './ui-schemas';
import type { AIUIResponse } from './ui-types';

const UI_SYSTEM_PROMPT = `你是一名需求分析助手。你的回复必须包含结构化的 UI 组件，让前端可以渲染出友好的交互界面。

## 组件选择指南

根据对话场景，选择合适的组件类型：

1. selection：用户从明确选项中选择（需求类型、分析维度、优先级）
2. form：需要用户补充多个字段信息（需求详情、验收标准）
3. confirmation：即将执行重要操作（确认提交、确认生成）
4. card：展示结构化信息（需求详情、分析报告）
5. steps / table / action_buttons / text：进度、数据、操作入口、纯文本

组合规则：message 必填；components 可多个；常见组合 card + action_buttons。
上下文管理：context.sessionStage 跟踪阶段，collectedData 记录已收集数据。`;

@Injectable()
export class UIResponseService {
  private model = createChatModel();
  private structuredModel = this.model.withStructuredOutput(aiUIResponseSchema);

  private prompt = ChatPromptTemplate.fromMessages([
    ['system', UI_SYSTEM_PROMPT],
    new MessagesPlaceholder('history'),
    ['human', '{input}'],
  ]);

  private chain = this.prompt.pipe(this.structuredModel);

  async generateUIResponse(
    input: string,
    history: BaseMessage[] = [],
    context?: Record<string, unknown>,
  ): Promise<AIUIResponse> {
    const enrichedInput = context
      ? `${input}\n\n[当前上下文] ${JSON.stringify(context)}`
      : input;

    return this.chain.invoke({ input: enrichedInput, history }) as Promise<AIUIResponse>;
  }
}
