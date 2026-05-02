'use client';

interface ProgressInfo {
  agent: string;
  agentDisplayName: string;
  step: number;
  totalSteps: number;
  status: 'started' | 'completed';
}

interface ThinkingIndicatorProps {
  message?: string;
  progress?: ProgressInfo | null;
  /** 9.2 并行子图专家进度（按 agent 名去重） */
  parallelAgents?: Record<string, ProgressInfo>;
}

export function ThinkingIndicator({
  message = 'Claude 正在整理回答',
  progress,
  parallelAgents,
}: ThinkingIndicatorProps) {
  const percentage = progress ? (progress.step / progress.totalSteps) * 100 : 0;
  const parallelList = Object.values(parallelAgents || {});

  return (
    <div className="flex justify-start">
      <div
        className="flex w-full max-w-[720px] flex-col gap-4 rounded-lg px-5 py-4"
        style={{
          backgroundColor: 'var(--chat-thinking-bg)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--panel)' }}>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: 'var(--accent)', animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: 'var(--accent)', animationDelay: '180ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: 'var(--accent)', animationDelay: '360ms' }} />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {progress ? progress.agentDisplayName : message}
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              {progress
                ? `正在执行第 ${progress.step} 步，共 ${progress.totalSteps} 步`
                : '正在准备响应内容…'}
            </div>
          </div>

          {progress && (
            <div
              className="rounded-sm px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums"
              style={{
                backgroundColor: 'var(--panel)',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >
              {Math.round(percentage)}%
            </div>
          )}
        </div>

        <div
          className="h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: progress ? `${percentage}%` : '28%',
              backgroundColor: 'var(--foreground)',
            }}
          />
        </div>

        {parallelList.length > 0 && (
          <div
            className="mt-1 flex flex-col gap-1.5 rounded-md px-3 py-2"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--foreground) 4%, transparent)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
              并行执行
            </div>
            <div className="flex flex-col gap-1">
              {parallelList.map((item) => (
                <ParallelAgentRow key={item.agent} info={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ParallelAgentRow({ info }: { info: ProgressInfo }) {
  const isCompleted = info.status === 'completed';
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--foreground)' }}>
      {isCompleted ? (
        <span
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--background)' }}
          aria-label="已完成"
        >
          <svg viewBox="0 0 12 12" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6.5L4.5 9L10 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : (
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ backgroundColor: 'var(--accent)' }}
          aria-label="进行中"
        />
      )}
      <span className={isCompleted ? '' : 'opacity-80'}>{info.agentDisplayName}</span>
    </div>
  );
}
