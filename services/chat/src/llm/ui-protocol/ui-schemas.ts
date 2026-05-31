/**
 * ui-schemas.ts
 *
 * 与 ui-types.ts 一一对应的 Zod Schema，供 LangChain `withStructuredOutput` 约束模型输出。
 * 关键：用 z.discriminatedUnion('type', ...) 基于 type 字段做精确匹配。
 */
import { z } from 'zod';

const textResponseSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
});

const selectionResponseSchema = z.object({
  type: z.literal('selection'),
  title: z.string(),
  description: z.string().optional(),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
        icon: z.string().optional(),
        disabled: z.boolean().optional(),
      }),
    )
    .min(2),
  allowMultiple: z.boolean().optional(),
});

const formResponseSchema = z.object({
  type: z.literal('form'),
  title: z.string(),
  description: z.string().optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(['input', 'textarea', 'select', 'date', 'number']),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        options: z
          .array(z.object({ value: z.string(), label: z.string() }))
          .optional(),
      }),
    )
    .min(1),
  submitLabel: z.string().optional(),
});

const confirmationResponseSchema = z.object({
  type: z.literal('confirmation'),
  title: z.string(),
  summary: z.array(z.object({ label: z.string(), value: z.string() })),
  warning: z.string().optional(),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

const cardResponseSchema = z.object({
  type: z.literal('card'),
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  fields: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      type: z.enum(['text', 'status', 'date']).optional(),
    }),
  ),
  actions: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        variant: z.enum(['primary', 'secondary', 'ghost']).optional(),
      }),
    )
    .optional(),
});

const stepsResponseSchema = z.object({
  type: z.literal('steps'),
  steps: z.array(
    z.object({
      label: z.string(),
      status: z.enum(['pending', 'current', 'completed']),
    }),
  ),
  currentStep: z.number(),
});

const tableResponseSchema = z.object({
  type: z.literal('table'),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string())),
  selectable: z.boolean().optional(),
});

const actionButtonsResponseSchema = z.object({
  type: z.literal('action_buttons'),
  title: z.string().optional(),
  buttons: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      icon: z.string().optional(),
      variant: z.enum(['primary', 'secondary', 'ghost']).optional(),
    }),
  ),
  layout: z.enum(['horizontal', 'vertical']).optional(),
});

export const uiComponentSchema = z.discriminatedUnion('type', [
  textResponseSchema,
  selectionResponseSchema,
  formResponseSchema,
  confirmationResponseSchema,
  cardResponseSchema,
  stepsResponseSchema,
  tableResponseSchema,
  actionButtonsResponseSchema,
]);

export const aiUIResponseSchema = z.object({
  message: z.string().describe('主要文字回复，始终存在'),
  components: z.array(uiComponentSchema).describe('UI 组件列表，可多个'),
  context: z
    .object({
      sessionStage: z.string().optional(),
      collectedData: z.record(z.unknown()).optional(),
    })
    .optional(),
});
