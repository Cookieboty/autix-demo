// 与后端 services/chat/src/llm/ui-protocol/ui-types.ts 保持一致的前端类型。

export interface TextResponse {
  type: 'text';
  content: string;
}

export interface SelectionOption {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
}

export interface SelectionResponse {
  type: 'selection';
  title: string;
  description?: string;
  options: SelectionOption[];
  allowMultiple?: boolean;
}

export interface FormField {
  name: string;
  label: string;
  type: 'input' | 'textarea' | 'select' | 'date' | 'number';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface FormResponse {
  type: 'form';
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface ConfirmationResponse {
  type: 'confirmation';
  title: string;
  summary: { label: string; value: string }[];
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface CardField {
  label: string;
  value: string;
  type?: 'text' | 'status' | 'date';
}

export interface CardAction {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface CardResponse {
  type: 'card';
  title: string;
  subtitle?: string;
  icon?: string;
  fields: CardField[];
  actions?: CardAction[];
}

export interface Step {
  label: string;
  status: 'pending' | 'current' | 'completed';
}

export interface StepsResponse {
  type: 'steps';
  steps: Step[];
  currentStep: number;
}

export interface TableResponse {
  type: 'table';
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
  selectable?: boolean;
}

export interface ActionButton {
  id: string;
  label: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface ActionButtonsResponse {
  type: 'action_buttons';
  title?: string;
  buttons: ActionButton[];
  layout?: 'horizontal' | 'vertical';
}

export type UIResponse =
  | TextResponse
  | SelectionResponse
  | FormResponse
  | ConfirmationResponse
  | CardResponse
  | StepsResponse
  | TableResponse
  | ActionButtonsResponse;

export interface AIUIResponse {
  message: string;
  components: UIResponse[];
  context?: {
    sessionStage?: string;
    collectedData?: Record<string, unknown>;
  };
}

export interface UIAction {
  componentType: UIResponse['type'];
  payload:
    | { type: 'select'; selectedId: string | string[] }
    | { type: 'submit'; formData: Record<string, unknown> }
    | { type: 'confirm'; confirmed: boolean }
    | { type: 'click'; actionId: string }
    | { type: 'row_select'; rowIndex: number };
}
