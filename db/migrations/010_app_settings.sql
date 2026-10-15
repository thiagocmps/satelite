-- Configuracao editavel em runtime (tela de config da IA). Cada linha e um
-- GRUPO de configuracao; `value` guarda o objeto completo em JSON. Os defaults
-- continuam no .env: o que esta aqui SOBRESCREVE o env (backend/src/modules/settings).
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table app_settings is
  'Configuracao em runtime por grupo (ex.: ai); overlay dos defaults do .env';
