-- 005_saved_articles.sql
-- Salvamento de noticias em grupos tematicos do leitor. Grupos sao colecoes
-- pessoais que atravessam categorias ("Eleicoes 2026 Brasil" junta politica,
-- economia e mundo), por isso sao uma tabela propria, nao uma categoria.

create table news_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 2 and 80),
  color      text,
  created_at timestamptz not null default now()
);

-- N:N: a mesma noticia pode estar em varios grupos. PK composta torna o
-- "salvar" idempotente (on conflict do nothing) e limpa o vinculo em cascata
-- quando o grupo ou a noticia e removido.
create table saved_articles (
  group_id   uuid not null references news_groups (id) on delete cascade,
  article_id uuid not null references articles (id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (group_id, article_id)
);

-- Marca os cards ("esta salva?") varrendo por artigo; a PK ja cobre a busca por grupo.
create index saved_articles_article_idx on saved_articles (article_id);
