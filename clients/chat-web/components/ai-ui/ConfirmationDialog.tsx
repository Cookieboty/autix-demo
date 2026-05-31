'use client';

interface Props {
  title: string;
  summary: { label: string; value: string }[];
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (confirmed: boolean) => void;
}

export function ConfirmationDialog({
  title,
  summary,
  warning,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <dl className="mt-3 space-y-1.5">
        {summary.map((item) => (
          <div key={item.label} className="flex gap-2 text-sm">
            <dt className="w-20 shrink-0 text-slate-500">{item.label}</dt>
            <dd className="text-slate-800">{item.value}</dd>
          </div>
        ))}
      </dl>
      {warning && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠️ {warning}</p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onConfirm(true)}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {confirmLabel ?? '确认'}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(false)}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          {cancelLabel ?? '取消'}
        </button>
      </div>
    </div>
  );
}
