'use client';

import { useState } from 'react';
import { AIChatContainer } from '@/components/ai-ui/AIChatContainer';

export default function Home() {
  const [sessionId] = useState(() => `ui-${Date.now()}`);

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col">
      <header className="border-b border-slate-200 px-4 py-3">
        <h1 className="text-base font-semibold text-slate-800">Autix AI 需求分析助理</h1>
        <p className="text-xs text-slate-500">模型输出结构化 UI 指令，前端按协议渲染交互组件</p>
      </header>
      <AIChatContainer sessionId={sessionId} />
    </main>
  );
}
