'use client';

import type { ActionButton } from '@/types/ui-types';

interface Props {
  title?: string;
  buttons: ActionButton[];
  layout?: 'horizontal' | 'vertical';
  onClick: (actionId: string) => void;
}

const variantClass: Record<string, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'border border-slate-300 text-slate-600 hover:bg-slate-50',
  ghost: 'text-indigo-600 hover:bg-indigo-50',
};

export function ActionButtons({ title, buttons, layout, onClick }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {title && <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>}
      <div className={`flex gap-2 ${layout === 'vertical' ? 'flex-col' : 'flex-wrap'}`}>
        {buttons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => onClick(btn.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              variantClass[btn.variant ?? 'secondary']
            }`}
          >
            {btn.icon} {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
