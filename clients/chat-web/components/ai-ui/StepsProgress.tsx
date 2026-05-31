'use client';

import type { Step } from '@/types/ui-types';

interface Props {
  steps: Step[];
  currentStep: number;
}

const dotClass: Record<Step['status'], string> = {
  completed: 'bg-emerald-500 text-white',
  current: 'bg-indigo-600 text-white ring-4 ring-indigo-100',
  pending: 'bg-slate-200 text-slate-500',
};

export function StepsProgress({ steps }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <ol className="flex items-center justify-between">
        {steps.map((step, i) => (
          <li key={step.label} className="flex flex-1 flex-col items-center">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${dotClass[step.status]}`}
            >
              {step.status === 'completed' ? '✓' : i + 1}
            </span>
            <span className="mt-1.5 text-center text-xs text-slate-600">{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
