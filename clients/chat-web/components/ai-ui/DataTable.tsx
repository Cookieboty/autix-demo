'use client';

interface Props {
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
  selectable?: boolean;
  onRowSelect: (rowIndex: number) => void;
}

export function DataTable({ columns, rows, selectable, onRowSelect }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-2 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => selectable && onRowSelect(i)}
              className={`border-t border-slate-100 ${
                selectable ? 'cursor-pointer hover:bg-indigo-50' : ''
              }`}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2 text-slate-700">
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
