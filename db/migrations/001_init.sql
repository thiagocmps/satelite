-- 001_init.sql
-- Schema base: categorias, fontes, regras de categorizacao, noticias,
-- resumos gerados por IA e historico de execucoes de ingestao.

create table categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null unique,
  description text,
  color       text,
  created_at  timestamptz not null default now()
);

-- Regras de categorizacao por palavra-chave (aplicadas na ingestao).
create table category_rules (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete cascade,
  keyword     text not null check (char_length(keyword) between 2 and 60),
  created_at  timestamptz not null default now(),
  unique (category_id, keyword)
);

create index category_rules_category_idx on category_rules (category_id);

create table sources (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  feed_url            text not null unique,
  site_url            text,
  default_category_id uuid references categories (id) on delete set null,
  enabled             boolean not null default true,
  -- cache condicional do feed (evita rebaixar o mesmo XML a cada ciclo)
  etag                text,
  last_modified       text,
  last_fetched_at     timestamptz,
  last_status         text,
  last_error          text,
  created_at          timestamptz not null default now()
);

create index sources_enabled_idx on sources (enabled);

create table articles (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources (id) on delete cascade,
  category_id   uuid references categories (id) on delete set null,
  title         text not null check (char_length(title) between 3 and 500),
  description   text,
  content       text,
  image_url     text,
  author        text,
  url           text not null,
  url_hash      text not null,
  fingerprint   text not null,
  published_at  timestamptz not null,
  ingested_at   timestamptz not null default now(),
  -- busca full-text nativa do Postgres (titulo pesa mais que a descricao)
  search_vector tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(description, '')), 'B')
  ) stored,
  -- dedup 1: mesma noticia na mesma fonte
  unique (source_id, url_hash),
  -- dedup 2: mesmo titulo em qualquer fonte
  unique (fingerprint)
);

create index articles_published_at_idx on articles (published_at desc);
create index articles_ingested_at_idx on articles (ingested_at desc);
create index articles_search_idx on articles using gin (search_vector);
create index articles_category_published_idx on articles (category_id, published_at desc);
create index articles_source_published_idx on articles (source_id, published_at desc);

create table ai_summaries (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid not null references articles (id) on delete cascade,
  provider       text not null,
  model          text not null,
  prompt_version text not null,
  language       text not null default 'pt-BR',
  summary        text,
  input_hash     text not null,
  status         text not null default 'ok' check (status in ('ok', 'error')),
  error          text,
  tokens_in      integer,
  tokens_out     integer,
  latency_ms     integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- um resumo por (noticia, modelo, versao do prompt): evita chamadas duplicadas
  unique (article_id, model, prompt_version)
);

create index ai_summaries_article_idx on ai_summaries (article_id, updated_at desc);

create table ingestion_runs (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid references sources (id) on delete cascade,
  status       text not null check (status in ('running', 'ok', 'error', 'skipped')),
  http_status  integer,
  not_modified boolean not null default false,
  fetched      integer not null default 0,
  inserted     integer not null default 0,
  duplicates   integer not null default 0,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index ingestion_runs_started_at_idx on ingestion_runs (started_at desc);
create index ingestion_runs_source_idx on ingestion_runs (source_id, started_at desc);
