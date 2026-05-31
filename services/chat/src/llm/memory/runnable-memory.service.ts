import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import {
  RunnableWithMessageHistory,
  RunnablePassthrough,
} from '@langchain/core/runnables';
import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { trimMessages, type BaseMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory';

@Injectable()
export class RunnableMemoryService {
  private store = new Map<string, InMemoryChatMessageHistory>();
  private model = createChatModel();

  private prompt = ChatPromptTemplate.fromMessages([
    ['system', '你是一名需求分析助手，请结合历史对话理解用户诉求并给出回答。'],
    new MessagesPlaceholder('history'),
    ['human', '{input}'],
  ]);

  // 长对话下控制 Token：保留最近且必要的上下文
  private trimmer = trimMessages({
    maxTokens: 2000,
    strategy: 'last',
    tokenCounter: this.model,
    includeSystem: true,
    allowPartial: false,
  });

  // 在进入 prompt 之前先对历史做裁剪
  private chain = RunnablePassthrough.assign({
    history: (input: { input: string; history?: BaseMessage[] }) =>
      this.trimmer.invoke(input.history ?? []),
  })
    .pipe(this.prompt)
    .pipe(this.model);

  private getSessionHistory = (sessionId: string) => {
    if (!this.store.has(sessionId)) {
      this.store.set(sessionId, new InMemoryChatMessageHistory());
    }
    return this.store.get(sessionId)!;
  };

  private withHistory = new RunnableWithMessageHistory({
    runnable: this.chain,
    getMessageHistory: this.getSessionHistory,
    inputMessagesKey: 'input',
    historyMessagesKey: 'history',
  });

  async chat(sessionId: string, input: string) {
    const response = await this.withHistory.invoke(
      { input },
      { configurable: { sessionId } }
    );
    return { response: response.content };
  }

  async getHistory(sessionId: string) {
    return this.getSessionHistory(sessionId).getMessages();
  }

  async appendMessage(sessionId: string, human: string, ai: string) {
    const history = this.getSessionHistory(sessionId);
    await history.addUserMessage(human);
    await history.addAIMessage(ai);
  }

  clearSession(sessionId: string) {
    this.store.delete(sessionId);
  }
}
