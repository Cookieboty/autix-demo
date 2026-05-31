import { ChatPromptTemplate } from '@langchain/core/prompts';
import {
  REQUIREMENT_SYSTEM_PROMPT,
  REQUIREMENT_USER_TEMPLATE,
} from './prompts/requirement.prompt';

export const requirementPrompt = ChatPromptTemplate.fromMessages([
  ['system', REQUIREMENT_SYSTEM_PROMPT],
  ['human', REQUIREMENT_USER_TEMPLATE],
]);
