'use client';

import { useState } from 'react';
import { ComponentRenderer } from './ComponentRenderer';
import type { AIUIResponse, UIAction } from '@/types/ui-types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  components?: AIUIResponse['components'];
}

export function AIChatContainer({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'ai',
      content: '欢迎使用 Autix AI 需求分析助理，请描述你的需求，或点击下方常用功能。',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const addAIMessage = (response: AIUIResponse) =>
    setMessages((prev) => [
      ...prev,
      { role: 'ai', content: response.message, components: response.components },
    ]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const text = input;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ui-chat/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, input: text }),
      });
      addAIMessage((await res.json()) as AIUIResponse);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: UIAction) => {
    if (loading) return;
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: `[UI 操作: ${action.componentType} → ${action.payload.type}]` },
    ]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ui-chat/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action }),
      });
      addAIMessage((await res.json()) as AIUIResponse);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'space-y-2'}>
            <div
              className={
                msg.role === 'user'
                  ? 'max-w-[80%] rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white'
                  : 'max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800'
              }
            >
              {msg.content}
            </div>
            {msg.role === 'ai' &&
              msg.components?.map((comp, j) => (
                <div key={j} className="max-w-[80%]">
                  <ComponentRenderer component={comp} onAction={handleAction} />
                </div>
              ))}
          </div>
        ))}
        {loading && <div className="text-xs text-slate-400">AI 正在思考中…</div>}
      </div>
      <div className="flex gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="描述你的需求，例如：我要提一个新需求…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  );
}
