import type { CloneStep } from '../api';

interface Props {
  steps: CloneStep[];
  empty?: string;
}

const LEVEL_DOT: Record<CloneStep['level'], string> = {
  info: 'bg-ink-faint',
  success: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-bad',
};

const LEVEL_TEXT: Record<CloneStep['level'], string> = {
  info: 'text-ink',
  success: 'text-ok',
  warn: 'text-warn',
  error: 'text-bad',
};

export function StepsLog({ steps, empty = 'Пусто.' }: Props) {
  if (steps.length === 0) {
    return (
      <div className="text-[13px] text-ink-faint px-4 py-4">
        <span className="text-flame mr-1">›</span>
        {empty}
      </div>
    );
  }
  return (
    <ol className="text-[13px]">
      {steps.map((step, i) => (
        <li
          key={i}
          className="grid grid-cols-[auto_1fr] gap-3 px-4 py-2 animate-fade-up border-b border-border-muted last:border-b-0"
          style={{ animationDelay: `${i * 25}ms` }}
        >
          <span
            className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${LEVEL_DOT[step.level]}`}
          />
          <div className="min-w-0">
            <div className={`break-words ${LEVEL_TEXT[step.level]}`}>{step.message}</div>
            {step.detail !== undefined && step.detail !== null && (
              <details className="mt-1">
                <summary className="cursor-pointer text-ink-muted hover:text-ink text-[12px]">
                  подробнее
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[12px] text-ink-muted bg-soft border border-border-muted rounded-md p-2 font-mono">
                  {typeof step.detail === 'string'
                    ? step.detail
                    : JSON.stringify(step.detail, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
