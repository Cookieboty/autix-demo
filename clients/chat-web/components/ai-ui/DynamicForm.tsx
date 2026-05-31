'use client';

import { useState } from 'react';
import type { FormField } from '@/types/ui-types';

interface Props {
  title: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
  onSubmit: (formData: Record<string, unknown>) => void;
}

export function DynamicForm({ title, description, fields, submitLabel, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  const baseInput =
    'mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none';

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      <div className="mt-3 space-y-3">
        {fields.map((field) => (
          <div key={field.name}>
            <label className="text-xs font-medium text-slate-600">
              {field.label}
              {field.required && <span className="text-rose-500"> *</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                rows={3}
                required={field.required}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) => setValue(field.name, e.target.value)}
                className={baseInput}
              />
            ) : field.type === 'select' ? (
              <select
                required={field.required}
                value={values[field.name] ?? ''}
                onChange={(e) => setValue(field.name, e.target.value)}
                className={baseInput}
              >
                <option value="">请选择</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                required={field.required}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) => setValue(field.name, e.target.value)}
                className={baseInput}
              />
            )}
          </div>
        ))}
      </div>
      <button
        type="submit"
        className="mt-4 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        {submitLabel ?? '提交'}
      </button>
    </form>
  );
}
