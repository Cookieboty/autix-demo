import { Injectable } from '@nestjs/common';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createChatModel } from './model.factory';
import { requirementPrompt } from './requirement.prompt-builder';
import { requirementChain } from './requirement.chain';
import {
  checkConstraintValidityTool,
  lookupEntityDefinitionTool,
} from './tools/basic.tools';

@Injectable()
export class LlmService {
  private model = createChatModel();

  // 3.4.2 invoke：一次请求拿到最终结果
  async invokeDemo(input: string): Promise<string> {
    const systemMessage = new SystemMessage('你是一名需求结构化抽取助手');
    const humanMessage = new HumanMessage(
      `请从下面文本中抽取 action、constraints、entities：\n${input}`
    );
    const messages: BaseMessage[] = [systemMessage, humanMessage];
    const response = await this.model.invoke(messages);
    return response.content.toString();
  }

  // 3.4.3 stream：边生成边返回
  async streamDemo(input: string) {
    return this.model.stream([
      new SystemMessage('你是一名需求结构化抽取助手'),
      new HumanMessage(`请逐步分析并输出结构化抽取结果：\n${input}`),
    ]);
  }

  // 3.4.4 batch：一次处理多条输入
  async batchDemo(inputs: string[]) {
    const messageGroups = inputs.map((input) => [
      new SystemMessage('你是一名需求结构化抽取助手'),
      new HumanMessage(`请抽取 action、constraints、entities：\n${input}`),
    ]);

    const responses = await this.model.batch(messageGroups);
    return responses.map((item) => item.content.toString());
  }

  // 3.5.4 仅渲染模板，不调模型
  async promptPreview(input: string) {
    const promptValue = await requirementPrompt.invoke({ input });
    return { rendered: promptValue.toString() };
  }

  // 3.5.5 模板 → 消息 → 模型
  async promptToModel(input: string) {
    const messages = await requirementPrompt.formatMessages({ input });
    const response = await this.model.invoke(messages);
    return { result: response.content };
  }

  // 3.6.3 chain.invoke：固定流程的一次性结果
  async chainInvoke(input: string) {
    const result = await requirementChain.invoke({ input });
    return { result };
  }

  // 3.6.4 chain.stream：固定流程边执行边返回
  async chainStream(input: string) {
    return requirementChain.stream({ input });
  }

  // 3.6.5 chain.batch：固定流程批量执行
  async chainBatch(inputs: string[]) {
    const results = await requirementChain.batch(
      inputs.map((input) => ({ input }))
    );
    return results.map((result, i) => ({ index: i + 1, result }));
  }

  // 3.8.2 bindTools：模型声明工具调用
  async toolBindDemo(input: string) {
    const modelWithTools = this.model.bindTools([
      checkConstraintValidityTool,
      lookupEntityDefinitionTool,
    ]);

    const response = await modelWithTools.invoke([
      new SystemMessage('你可以按需要调用工具来校验约束和查询实体定义。'),
      new HumanMessage(`请分析下面需求：${input}`),
    ]);

    return {
      result: response.content.toString(),
      toolCalls: response.tool_calls,
    };
  }

  // 3.8.4 工具执行闭环
  async toolLoopDemo(input: string) {
    const tools: StructuredToolInterface[] = [
      checkConstraintValidityTool,
      lookupEntityDefinitionTool,
    ];
    const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));
    const modelWithTools = this.model.bindTools(tools);

    const messages: BaseMessage[] = [
      new SystemMessage('你可以调用工具来帮助完成需求抽取后的校验。'),
      new HumanMessage(
        `先抽取 action、constraints、entities，再按需要调用工具：${input}`
      ),
    ];

    const firstResponse = await modelWithTools.invoke(messages);
    messages.push(firstResponse);

    for (const toolCall of firstResponse.tool_calls ?? []) {
      const targetTool = toolMap[toolCall.name];
      if (!targetTool) continue;
      const toolResult = await targetTool.invoke(toolCall.args);
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? '',
          content: JSON.stringify(toolResult),
        })
      );
    }

    const finalResponse = await modelWithTools.invoke(messages);
    return { result: finalResponse.content };
  }
}
