-- Reconciliacao de schema.
--
-- Contexto: a migration 003_classification.sql foi APLICADA em producao, mas o
-- arquivo se perdeu do repositorio. Em consequencia o banco real divergia do
-- que um deploy novo produziria: existiam colunas, tabelas e um indice que
-- nenhuma migration do repositorio criaria. Este arquivo fecha essa diferenca.
--
-- Nao recriamos um arquivo 003_*: o runner de migrations guarda o checksum de
-- cada versao aplicada, e um arquivo reaparecida com conteudo diferente aborta
-- o boot ("mudou depois de aplicada"). O conserto e, portanto, para frente.
--
-- Direcao escolhida: remover o que e morto e rastrear o que e vivo.
-- Verificado antes: tags (129 linhas), article_tags (157) e
-- article_classifications (40) nao tem NENHUMA referencia no codigo; idem
-- articles.language (50 valores) e articles.country (6). Dump de seguranca das
-- tres tabelas feito antes de aplicar.

-- articles_needs_ai_idx foi criada fora de qualquer migration (sobrevive
-- apenas na producao) e e a que a fila de classificacao usa. Vira rastreavel.
create index if not exists articles_needs_ai_idx on articles (needs_ai) where needs_ai = true;

-- tentativas anteriores de classificacao, abandonadas e orfas
drop table if exists article_tags;
drop table if exists tags;
drop table if exists article_classifications;

-- colunas legadas sem uso; articles_language_idx cai junto com a coluna
alter table articles drop column if exists language;
alter table articles drop column if exists country;
