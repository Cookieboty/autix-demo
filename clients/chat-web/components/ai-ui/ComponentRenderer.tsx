'use client';

import { SelectionCard } from './SelectionCard';
import { DynamicForm } from './DynamicForm';
import { ConfirmationDialog } from './ConfirmationDialog';
import { InfoCard } from './InfoCard';
import { StepsProgress } from './StepsProgress';
import { DataTable } from './DataTable';
import { ActionButtons } from './ActionButtons';
import type { UIResponse, UIAction } from '@/types/ui-types';

interface Props {
  component: UIResponse;
  onAction: (action: UIAction) => void;
}

export function ComponentRenderer({ component, onAction }: Props) {
  switch (component.type) {
    case 'text':
      return (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-slate-700">
          {component.content}
        </div>
      );

    case 'selection':
      return (
        <SelectionCard
          title={component.title}
          description={component.description}
          options={component.options}
          allowMultiple={component.allowMultiple}
          onSelect={(selectedId) =>
            onAction({ componentType: 'selection', payload: { type: 'select', selectedId } })
          }
        />
      );

    case 'form':
      return (
        <DynamicForm
          title={component.title}
          description={component.description}
          fields={component.fields}
          submitLabel={component.submitLabel}
          onSubmit={(formData) =>
            onAction({ componentType: 'form', payload: { type: 'submit', formData } })
          }
        />
      );

    case 'confirmation':
      return (
        <ConfirmationDialog
          title={component.title}
          summary={component.summary}
          warning={component.warning}
          confirmLabel={component.confirmLabel}
          cancelLabel={component.cancelLabel}
          onConfirm={(confirmed) =>
            onAction({ componentType: 'confirmation', payload: { type: 'confirm', confirmed } })
          }
        />
      );

    case 'card':
      return (
        <InfoCard
          title={component.title}
          subtitle={component.subtitle}
          icon={component.icon}
          fields={component.fields}
          actions={component.actions}
          onAction={(actionId) =>
            onAction({ componentType: 'card', payload: { type: 'click', actionId } })
          }
        />
      );

    case 'steps':
      return <StepsProgress steps={component.steps} currentStep={component.currentStep} />;

    case 'table':
      return (
        <DataTable
          columns={component.columns}
          rows={component.rows}
          selectable={component.selectable}
          onRowSelect={(rowIndex) =>
            onAction({ componentType: 'table', payload: { type: 'row_select', rowIndex } })
          }
        />
      );

    case 'action_buttons':
      return (
        <ActionButtons
          title={component.title}
          buttons={component.buttons}
          layout={component.layout}
          onClick={(actionId) =>
            onAction({ componentType: 'action_buttons', payload: { type: 'click', actionId } })
          }
        />
      );

    default: {
      // 未知组件降级：前端不崩溃（对应 6.5.2 Fallback）
      const unknown = component as { type: string };
      console.warn(`Unknown component type: ${unknown.type}`);
      return (
        <div className="rounded bg-slate-50 p-3 text-sm text-slate-500">
          [不支持的组件类型: {unknown.type}]
        </div>
      );
    }
  }
}
