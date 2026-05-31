'use client';

import { useState } from 'react';
import type { RequirementResult } from '@autix/contracts';

export default function Home() {
  const [input, setInput] = useState('用户注册时必须绑定手机号，密码至少8位');
  const [result, setResult] = useState<RequirementResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/requirement/extract`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        }
      );
      const data = await res.json();
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Requirement Extract Demo</h1>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={8}
        style={{ width: '100%' }}
      />

      <button onClick={handleSubmit} disabled={loading} style={{ marginTop: 12 }}>
        {loading ? '提取中…' : '提取'}
      </button>

      <pre style={{ marginTop: 16 }}>{JSON.stringify(result, null, 2)}</pre>
    </main>
  );
}
