import { Injectable } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  RequirementResultSchema,
  type RequirementResult,
} from '@autix/contracts';
import { createChatModel } from './model.factory';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt';

@Injectable()
export class RequirementService {
  private model = createChatModel();

  private prompt = ChatPromptTemplate.fromMessages([
    ['system', REQUIREMENT_SYSTEM_PROMPT],
    ['human', REQUIREMENT_USER_TEMPLATE],
  ]);

  async extract(input: string): Promise<RequirementResult> {
    const messages = await this.prompt.formatMessages({ input });
    const structuredModel = this.model.withStructuredOutput(
      RequirementResultSchema
    );
    return structuredModel.invoke(messages);
  }
}
