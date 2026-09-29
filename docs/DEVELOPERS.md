# Guia do desenvolvedor

Como um item de notícia atravessa o sistema:

```
fonte RSS → ingestão → normalização → PostgreSQL → API → React → resumo por IA
```

Cada etapa abaixo aponta o arquivo exato. As decisões por trás estão em
[ARCHITECTURE.md](ARCHITECTURE.md); o contrato HTTP, em [API.md](API.md).

## 0. Rodando

```bash
cp .env.example .env        # ajuste OPENROUTER_API_KEY
docker compose up --build   # frontend :8080 · API :4000 · Postgres :5433
```

Sem Docker: `npm install`, aponte `DATABASE_URL`, `npm run migrate`, `npm run dev`
(API em `:4000`, Vite em `:5173` com proxy de `/api`).

## 1. A fonte

`backend/src/integrations/rss/rss.adapter.ts`

`fetchFeed(source, options)` monta a requisição:

- `If-None-Match` e `If-Modified-Since` com o `etag`/`last_modified` salvos da última coleta;
- `Accept: application/rss+xml, application/atom+xml, application/xml, text/xml`;
- `redirect: 'follow'` (muitos feeds redirigem `http` → `https`);
- `AbortSignal.timeout(INGEST_TIMEOUT_MS)`, timeout virando `TimeoutError` tipado;
- conferência de `content-length` contra `FEED_MAX_BYTES` **antes** de ler o corpo: um feed que se
  declara gigante é recusado sem gastar banda nem memória;
- `304` → sinaliza `notModified` sem parsear; qualquer outro status não-2xx → `FEED_HTTP_ERROR`;
- resposta que não é XML válido → `FEED_INVALID_XML` (em `parseFeed`).

Depois, `rss-parser` normaliza o documento para um formato estável (`rss.types.ts`):

```ts
type FeedItem = { title?: string; link?: string; content?: string; isoDate?: string; ... };
type Feed = { title?: string; items: FeedItem[] };
```

Detalhes que só aparecem na prática: o `rss-parser` lowercifica os nomes das tags, `media:content` e
`media:thumbnail` chegam como `{ $: { url } }` (às vezes como array), e `dc:creator` já vem em
`creator`.

## 2. A ingestão

`backend/src/modules/ingestion/ingestion.service.ts`

`ingestSource(source)`:

1. Guarda a execução em `ingestion_runs` com `status='running'`.
2. Chama o adapter. Em `304`, marca `not_modified` e devolve.
3. Normaliza cada item (próxima seção) e filtra o que não tem título ou link.
4. Classifica com `keyword-engine` e marca `needs_ai` quando a regra não decide.
5. Insere em lote (`news.repository.ts#insertMany`), blocos de 400 linhas.
6. Atualiza a linha da fonte com `etag`, `last_modified`, `last_status` e `last_error`.

`ingestAll()` roda as fontes habilitadas com concorrência limitada a `INGEST_CONCURRENCY` e
`Promise.allSettled`: **uma fonte quebrada nunca derruba as outras** — cada uma vira um
`SourceIngestionResult` com status e erro próprios.

### 3. Normalização

`backend/src/integrations/rss/rss.normalize.ts`

`normalizeItem(item, source)` devolve um `NormalizedArticle` já no formato do banco:

- **título** — CDATA removido, HTML desligado (`sanitizeHtml` em `core/html.ts`), espaços colapsados,
  truncado em 500 caracteres (o mesmo limite do `check` no banco);
- **descrição** — primeiro o `content:encoded`/`summary`, senão os primeiros caracteres do `content`;
  HTML removido, entidades decodificadas, espaços normalizados;
- **conteúdo** — o corpo do artigo quando o feed traz, para dar contexto ao modelo de IA;
- **imagem** — primeira que existir entre `media:content`, `media:thumbnail`, `enclosure` de tipo
  `image/*` e o primeiro `<img>` do `content`; URL relativa é resolvida contra o endereço do feed e
  o resultado só é aceito se for `http(s)`;
- **autor** — `creator`/`author`/`dc:creator`, senão null;
- **datas** — `isoDate`/`pubDate` → `published_at`; ausente → `ingested_at` com a hora atual.

### 4. Deduplicação

`backend/src/core/fingerprint.ts` + constraints em `articles`

```ts
urlHash     = sha256(normalizeUrl(url))       // unique (source_id, url_hash)
fingerprint = sha256(normalizeTitle(title))   // unique (fingerprint)
```

`insertMany` monta um `insert into articles (…) values (…), (…), … on conflict do nothing
returning id` por bloco (400 linhas, ~4400 parâmetros) e usa o `rowCount` para separar inseridos de
duplicados. Nenhuma consulta de verificação antes: o banco decide.

### 5. Categorização

`backend/src/modules/classification/keyword-engine.ts` (regras) +
`backend/src/modules/classification/classification.service.ts` (fila de IA)

```ts
classifyText(text, index)
  → { decision: 'decisive', match } | { decision: 'ambiguous', matches } | { decision: 'none' }
```

O motor deterministico normaliza o texto (minusculas, sem acento, espacos colapsados) e exige
**borda de palavra**: `nasa` nao casa dentro de `nasal`. O indice vem da palavra mais longa para a
mais curta (a mais especifica vence por categoria). Sem decisao deterministica e com texto de pelo
menos `AI_CLASSIFY_MIN_TEXT_CHARS`, o item entra na fila `needs_ai`.

`classification.service.ts` processa a fila: quem a regra decide sai sem custo de modelo; texto curto
demais fica como esta; o resto vai para a IA (OpenRouter, `classify` com `response_format:
json_object`) com o catalogo real de categorias (slug + nome). O modelo responde
`{"categorySlug", "confidence"}`; slug fora do catalogo ou confianca abaixo de
`AI_CLASSIFY_MIN_CONFIDENCE` nao aplica categoria. O veredito grava `category_method`
(`'keyword'`/`'ai'`) e `category_confidence` direto em `articles`. Falha de IA mantem `needs_ai`
para a proxima rodada. Dispare `POST /ingest/classify` (ou o botao em Fontes).

### 6. Persistência e leitura

`backend/src/modules/news/news.repository.ts`

`list(query)` monta a cláusula `where` com `buildFilters` (compartilhado com o `count` para que
página e total nunca divirjam) e retorna `SELECT_ARTICLE`, que já traz fonte, categoria e resumo em
um `left join lateral` — uma query só, sem N+1. `findById` reaproveita a mesma seleção.

A busca entra na cláusula como
`search_vector @@ websearch_to_tsquery('portuguese', $1) or title ilike '%'||$1||'%'` — o `ILIKE`
cobre o que o stemming não encontra, na mesma query e no mesmo índice.

Ordenação: `published_at desc, id desc` em `recent` (o `id` desempata de forma estável entre
páginas); `ts_rank` + data em `relevance` (que só muda a ordenação quando há `q`).

## 7. A API

`backend/src/routes/index.ts` monta tudo em `/api/v1` e aplica o rate limit global. Cada módulo
declara suas rotas com o middleware de validação:

```ts
router.get('/', validate({ query: listQuerySchema }), news.list);
```

`validate` roda o schema Zod e deposita o resultado em `req.valid` (não em `req.query`, que no
Express 5 é um getter). Dados de `req.valid` são tipados por `types/express.d.ts`.

`errorHandler` normaliza qualquer erro em `{ error: { code, message, details?, requestId } }`.

## 8. O frontend

`frontend/src`

```
pages/      NewsListPage · NewsDetailPage · CategoriesPage · SourcesPage
components/ NewsCard · Filters · Pagination · SummaryPanel · States · Layout
hooks/      useSatelite.ts   ← única camada que conhece a API
api/        client.ts · satelite.api.ts · types.ts
utils/      format.ts        ← datas, slug, host
styles/     tokens.css · app.css
```

Regras que o código segue:

- **Componente não chama a API.** Ele lê um hook e renderiza; decisões de carregamento, erro e vazio ficam
  na página.
- **Hooks invalidam cache, não recarregam.** Gerar um resumo escreve no cache da query do resumo e
  invalida `['news']`, então o selo “✦ resumo IA” aparece no card sem nova busca.
- **Filtros vivem na URL.** `useFiltersFromUrl` traduz `?q=…&categoria=…&pagina=…` em `NewsFilters`,
  e qualquer mudança reescreve a query string com `replace`.
- **A busca tem debounce** de 350 ms só no campo de texto; os selects são imediatos.
- **`ApiError`** carrega `status` e `code`, e o `QueryClient` não repete erro 4xx.

## 9. Resumo por IA

### Prompt

`backend/src/integrations/ai/ai.prompts.ts` monta a mensagem de sistema com o idioma
(`AI_LANGUAGE`) e a instrução de produzir um resumo curto, em parágrafo, sem inventar informação.
A mensagem do usuário leva título, descrição e o início do conteúdo, limitado por
`AI_MAX_CONTENT_CHARS`.

`AI_PROMPT_VERSION` entra no `input_hash`: ao alterá-lo, os resumos antigos deixam de valer e são
regenerados no próximo clique, sem apagar o histórico.

### Chamada

`backend/src/integrations/ai/openrouter.provider.ts`

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: $APP_URL
X-Title: $APP_NAME

{ "model": "openrouter/free", "messages": [...], "temperature": 0.3 }
```

Ordem das tentativas: modelo principal (`AI_MAX_RETRIES` vezes em 429/5xx, honrando `Retry-After`),
depois cada modelo de `AI_FALLBACK_MODELS`. Erro mapeado para `AI_AUTH_INVALID`, `AI_QUOTA`,
`AI_RATE_LIMIT`, `AI_UPSTREAM_ERROR` ou `AI_BAD_RESPONSE`.

### Cache

`backend/src/modules/summaries/summaries.service.ts`

```
GET  → procura (article_id, model, prompt_version) com status ok e input_hash igual ao atual
POST → se não achar, gera; um Map<chave, Promise> evita a corrida no mesmo processo
```

O resultado vai para `ai_summaries` com `status='ok'`, tokens e latência. Falha grava
`status='error'`, que nunca aparece para o cliente.

## 10. Migrations

```bash
npm run migrate                        # local
docker compose run --rm migrate        # no Compose
```

Arquivo novo: `db/migrations/003_descricao.sql`, aplicado na próxima subida. Em ordem alfabética,
dentro de uma transação, com checksum conferido e `pg_advisory_lock` para serializar instâncias.
**Não edite um arquivo já aplicado** — o runner falha de propósito; crie um novo.

## 11. Testes

```bash
npm test                       # tudo
cd backend && npx vitest run src/integrations/ai   # um arquivo
cd backend && npx vitest run -t "dedup"          # por nome
```

| Arquivo                                             | Cobre                                                    |
| --------------------------------------------------- | -------------------------------------------------------- |
| `core/html.test.ts`                                  | limpeza de HTML, entidades, CDATA                        |
| `integrations/rss/rss.normalize.test.ts`             | imagens, autores, datas, feeds incompletos               |
| `integrations/ai/openrouter.provider.test.ts`        | retry, fallback, mapeamento de erro, cache, classify     |
| `integrations/ai/ai.classify.test.ts`                | prompt do catalogo, parsing e allowlist de slugs         |
| `modules/classification/keyword-engine.test.ts`      | regras, acento, borda de palavra, ambiguidade            |
| `modules/classification/classification.service.test.ts` | fila: keyword sem custo, IA na duvida, falha pendente |
| `modules/ingestion/ingestion.service.test.ts`        | dedup, contagens, fonte que falha não derruba as outras   |
| `modules/summaries/summaries.service.test.ts`        | cache, `input_hash`, chamada concorrente                 |
| `modules/sources/sources.repository.test.ts`         | violação de unique → 409                                 |
| `app.test.ts`                                        | rotas com `supertest`, validação, envelope de erro       |

Padrão para dublês: interface do repositório + classe em memória que guarda o estado
(veja `summaries.service.test.ts`). Para rotas, o `supertest` roda o app de verdade com o
`container` substituído.

## 12. Onde mexer para cada mudança

| Mudança                                | Arquivo                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| Adicionar campo na notícia             | migration + `news.types.ts` + `SELECT_ARTICLE` + `frontend/src/api/types.ts` |
| Novo filtro na listagem                | `news.schemas.ts` + `buildFilters` + `Filters.tsx`              |
| Novo provedor de IA                    | `ai.provider.ts` (interface) + arquivo novo + `ai.registry.ts`  |
| Novo passo na ingestão                 | `ingestion.service.ts` (e o `NormalizedArticle`, se o dado for novo) |
| Nova rota                              | `*.routes.ts` + `*.controller.ts` + `routes/index.ts`            |
| Novo tema/cor                          | `styles/tokens.css`                                             |
| Novo item de menu                      | `components/Layout.tsx` + rota em `main.tsx`                    |
