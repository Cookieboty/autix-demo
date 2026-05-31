'use client';

import type { CardAction, CardField } from '@/types/ui-types';

interface Props {
  title: string;
  subtitle?: string;
  icon?: string;
  fields: CardField[];
  actions?: CardAction[];
  onAction: (actionId: string) => void;
}

const variantClass: Record<string, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'border border-slate-300 text-slate-600 hover:bg-slate-50',
  ghost: 'text-indigo-600 hover:bg-indigo-50',
};

export function InfoCard({ title, subtitle, icon, fields, actions, onAction }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-lg">{icon}</span>}
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <div key={field.label} className="text-sm">
            <dt className="text-xs text-slate-500">{field.label}</dt>
            <dd
              className={
                field.type === 'status'
                  ? 'mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700'
                  : 'mt-0.5 text-slate-800'
              }
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
      {actions && actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onAction(action.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                variantClass[action.variant ?? 'secondary']
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
