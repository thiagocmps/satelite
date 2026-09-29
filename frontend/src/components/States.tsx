import type { ReactNode } from 'react';

export function EmptyState({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true" />
      <p style={{ fontWeight: 600 }}>{title}</p>
      {hint ? <p className="small">{hint}</p> : null}
      {action ? <div style={{ marginTop: 'var(--sp-3)' }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="button button--sm" style={{ marginTop: 'var(--sp-3)' }} onClick={onRetry}>
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="news-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton skeleton--card" />
      ))}
    </div>
  );
}
