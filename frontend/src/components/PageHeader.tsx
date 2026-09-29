import type { ReactNode } from 'react';

type Props = {
  title: string;
  /** Kicker opcional em caps curtas ("MISSÃO · …"). Nulo = cabecalho sem eyebrow. */
  eyebrow?: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function PageHeader({ title, eyebrow, description, action }: Props) {
  return (
    <div className="row" style={{ marginBottom: 'var(--sp-5)' }}>
      <div>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      <span className="spacer" />
      {action}
    </div>
  );
}