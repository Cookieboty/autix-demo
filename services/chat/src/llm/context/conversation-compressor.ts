/**
 * conversation-compressor.ts
 *
 * 第十章 10.5：会话摘要压缩。
 * 当历史消息过长时，把早期消息压缩为摘要，保留最近 N 条原文。
 */
import {
  BaseMessage,
  SystemMessage,
  HumanMessage,
  AIMessage,
} from '@langchain/core/messages';

export interface CompressOptions {
  keepRecent?: number;
  summaryMaxTokens?: number;
}

export interface SummaryModel {
  invoke(messages: { role: string; content: string }[]): Promise<{ content: string }>;
}

/**
 * 压缩对话历史。
 * - 消息数不超过 keepRecent 时，直接返回原 messages。
 * - 超过时，早期消息交给 summaryModel 生成摘要，最近 keepRecent 条保留原文。
 * - 摘要用 SystemMessage 形式插入，内容以 [对话摘要] 开头。
 * - 不修改 RequirementAnalysisState 的业务字段。
 */
export async function compressConversation(
  messages: BaseMessage[],
  summaryModel: SummaryModel,
  options: CompressOptions = {},
): Promise<BaseMessage[]> {
  const { keepRecent = 10, summaryMaxTokens = 500 } = options;

  const systemMsgs = messages.filter((m) => m instanceof SystemMessage);
  const nonSystemMsgs = messages.filter((m) => !(m instanceof SystemMessage));

  if (nonSystemMsgs.length <= keepRecent) {
    return messages;
  }

  const earlyMsgs = nonSystemMsgs.slice(0, -keepRecent);
  const recentMsgs = nonSystemMsgs.slice(-keepRecent);

  const conversationText = earlyMsgs
    .map((m) => `${m._getType()}: ${m.content}`)
    .join('\n');

  const summaryResponse = await summaryModel.invoke([
    {
      role: 'system',
      content: `把以下对话压缩为摘要，保留关键信息（需求编号、功能描述、用户意图、已完成的操作）。最多 ${summaryMaxTokens} 个 token。`,
    },
    {
      role: 'user',
      content: conversationText,
    },
  ]);

  const summaryMsg = new SystemMessage(
    `[对话摘要] ${summaryResponse.content}`,
  );

  return [...systemMsgs, summaryMsg, ...recentMsgs];
}
