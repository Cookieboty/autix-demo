'use client';

import { useState } from 'react';
import type { SelectionOption } from '@/types/ui-types';

interface Props {
  title: string;
  description?: string;
  options: SelectionOption[];
  allowMultiple?: boolean;
  onSelect: (selectedId: string | string[]) => void;
}

export function SelectionCard({ title, description, options, allowMultiple, onSelect }: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  const handleClick = (id: string) => {
    if (allowMultiple) {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
      );
    } else {
      onSelect(id);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={opt.disabled}
              onClick={() => handleClick(opt.id)}
              className={`flex flex-col items-start rounded-md border p-3 text-left transition ${
                active
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
              } disabled:opacity-40`}
            >
              <span className="text-sm font-medium text-slate-800">
                {opt.icon} {opt.label}
              </span>
              {opt.description && (
                <span className="mt-1 text-xs text-slate-500">{opt.description}</span>
              )}
            </button>
          );
        })}
      </div>
      {allowMultiple && selected.length > 0 && (
        <button
          type="button"
          onClick={() => onSelect(selected)}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          确认选择（{selected.length}）
        </button>
      )}
    </div>
  );
}
