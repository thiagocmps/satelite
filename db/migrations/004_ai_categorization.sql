-- Categorizacao hibrida: keyword deterministica + IA (OpenRouter) so em duvida.
-- Aditivo e idempotente: tolera bancos existentes que ja tenham parte do schema
-- (colunas legadas e tabelas orfas de tentativas anteriores ficam como estao).

alter table articles
  add column if not exists needs_ai            boolean not null default false,
  add column if not exists ai_classified_at    timestamptz,
  add column if not exists category_method     text,
  add column if not exists category_confidence numeric;

-- restricoes devem existir uma unica vez (guardadas para instalacoes pos-004)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'articles_category_method_check'
       and conrelid = 'articles'::regclass
  ) then
    alter table articles add constraint articles_category_method_check
      check (category_method in ('keyword', 'ai'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'articles_category_confidence_check'
       and conrelid = 'articles'::regclass
  ) then
    alter table articles add constraint articles_category_confidence_check
      check (category_confidence is null or (category_confidence >= 0 and category_confidence <= 1));
  end if;
end $$;

comment on column articles.needs_ai is 'aguarda classificacao da IA (keyword ausente ou ambigua)';
comment on column articles.ai_classified_at is 'quando a IA deu a palavra final (mesmo sem categoria)';
comment on column articles.category_method is '''keyword'' (regra deterministica), ''ai'' (OpenRouter) ou null (padrao da fonte/sem categoria)';
comment on column articles.category_confidence is 'confianca da IA entre 0 e 1';

-- backlog inicial: artigos dos ultimos 30 dias que ainda nao tiveram decisao
-- deterministica ficam marcados para a IA revisar. Quem ja tem keyword resolve
-- no proprio backlog (sem custo de modelo) e sai da fila.
update articles
   set needs_ai = true
 where ingested_at >= now() - interval '30 days'
   and needs_ai is not true
   and category_method is null;