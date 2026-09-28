import type { ReactNode } from 'react';

type Props = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function PageHeader({ title, description, action }: Props) {
  return (
    <div className="row" style={{ marginBottom: 'var(--sp-5)' }}>
      <div>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      <span className="spacer" />
      {action}
    </div>
  );
}
