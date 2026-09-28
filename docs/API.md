# API

Contrato de referência da API do satelite. A mesma forma está tipada em
`frontend/src/api/types.ts` — se mudar um lado, mude o outro.

- **Base:** `/api/v1` (em produção, o nginx faz proxy de `/api` → `backend:4000`; em desenvolvimento,
  o Vite faz o mesmo proxy).
- **Sucesso:** `2xx` com `{ "data": ... }`. Listas acrescentam `pagination`.
- **Erro:** `4xx`/`5xx` com `{ "error": { code, message, details?, requestId } }`.
- **Autenticação:** nenhuma (veja [Auth](#autenticacao)).
- **Limite:** global (`RATE_LIMIT_MAX` por `RATE_LIMIT_WINDOW_MS`) e mais estrito em
  `POST /news/:id/summary` (`SUMMARY_RATE_LIMIT_MAX` por `SUMMARY_RATE_LIMIT_WINDOW_MS`).
  Ao estourar: `429 RATE_LIMITED` com header `Retry-After`.

Todas as entradas são validadas com Zod. Erro de validação traz o campo e aissues:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados invalidos",
    "details": {
      "field": "query",
      "issues": [{ "path": "limit", "message": "Too big: expected number to be <=50" }]
    },
    "requestId": "0e9754bf-eadd-4779-aadb-32ec37c94958"
  }
}
```

O `requestId` volta no header `X-Request-Id` e no log do backend — é por ele que se localiza a
requisição.

## Códigos de erro

| Código               | Status | Quando                                                          |
| -------------------- | ------ | ---------------------------------------------------------------- |
| `VALIDATION_ERROR`   | 400    | Query, param ou body inválido (`details.issues` detalha)         |
| `NOT_FOUND`          | 404    | Notícia, categoria, fonte ou rota inexistente                    |
| `CONFLICT`           | 409    | Slug já existente ou ingestão já em andamento                    |
| `RATE_LIMITED`       | 429    | Estourou o limite de requisições                                 |
| `TIMEOUT`            | 504    | Timeout na coleta do feed ou na chamada de IA                    |
| `FEED_HTTP_ERROR`    | 502    | Feed respondeu com status não-2xx                                 |
| `FEED_INVALID_XML`   | 502    | Corpo do feed não é XML válido                                   |
| `AI_AUTH_INVALID`    | 502    | OpenRouter recusou a credencial (401)                             |
| `AI_QUOTA`           | 502    | Sem cota na OpenRouter (402)                                     |
| `AI_RATE_LIMIT`      | 502    | OpenRouter aplicou rate limit (429) mesmo após todas as tentativas |
| `AI_UPSTREAM_ERROR`  | 502    | Gateway fora do ar (5xx) ou timeout                              |
| `AI_BAD_RESPONSE`    | 502    | Resposta sem conteúdo utilizável                                  |
| `UPSTREAM_UNREACHABLE` | 502  | Falha de rede ao buscar o feed                                    |
| `UPSTREAM_TOO_LARGE` | 502    | Feed maior que `FEED_MAX_BYTES`                                  |
| `INTERNAL_ERROR`     | 500    | Inesperado — sempre com `requestId` para o log                    |

## Modelo de dados

```ts
type SourceRef = { id: string; slug: string; name: string; siteUrl: string | null };

type CategoryRef = { id: string; slug: string; name: string; color: string | null };

type SummaryView = {
  text: string;
  generatedByAi: true;      // marcação explícita de conteúdo gerado por modelo
  provider: string;
  model: string;
  promptVersion: string;
  language: string;
  createdAt: string;        // ISO 8601
  updatedAt: string;
  tokensIn: number | null;
  tokensOut: number | null;
};

type Article = {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  author: string | null;
  url: string;              // link original
  publishedAt: string;
  ingestedAt: string;
  source: SourceRef;
  category: CategoryRef | null;
  summary: SummaryView | null;   // já vem na listagem (lateral join)
};

type Pagination = {
  page: number; limit: number; total: number; totalPages: number;
  hasNext: boolean; hasPrev: boolean;
};
```

---

## Saúde

### `GET /health`

Liveness: o processo está respondendo. Não toca no banco (para não gerar log a cada healthcheck).

```bash
curl http://localhost:4000/api/v1/health
```

```json
{ "status": "ok", "service": "satelite-api", "uptime": 812, "timestamp": "2026-09-28T18:09:28.573Z" }
```

### `GET /health/ready`

Readiness: `200` se o Postgres responde, `503` se não. É o probe que o Compose usa.

```json
{ "status": "ready" }
```

---

## Notícias

### `GET /news`

Lista com busca, filtros, paginação e ordenação.

| Query     | Tipo                              | Padrão    | Observações                                       |
| --------- | --------------------------------- | --------- | ------------------------------------------------- |
| `q`       | string (1–200)                    | —         | Full-text em português + `ILIKE` no título         |
| `category` | uuid                             | —         | `id` de categoria                                  |
| `source`  | uuid                              | —         | `id` de fonte                                      |
| `from`    | `YYYY-MM-DD`                      | —         | `published_at >= from 00:00`                       |
| `to`      | `YYYY-MM-DD`                      | —         | `published_at <= to 23:59`; precisa ser ≥ `from`  |
| `page`    | int ≥ 1                           | `1`       |                                                     |
| `limit`   | int 1–50                          | `12`      | Máximo 50                                           |
| `sort`    | `recent` \| `relevance`           | `recent`  | `relevance` só muda a ordenação com `q`             |

```bash
curl 'http://localhost:4000/api/v1/news?limit=10'
curl 'http://localhost:4000/api/v1/news?q=inteligencia%20artificial&sort=relevance'
curl 'http://localhost:4000/api/v1/news?from=2026-09-01&to=2026-09-28&limit=5'
```

```json
{
  "data": [
    {
      "id": "e190f843-8567-40ab-a4a0-f6a4ee194e45",
      "title": "Monday Night Club - Man City reaction",
      "description": "Mark Chapman and guests debate the weekend's football.",
      "content": "…",
      "imageUrl": "https://ichef.bbci.co.uk/news/1024/cpsprodpb/…",
      "author": null,
      "url": "https://www.bbc.co.uk/sport/football/…",
      "publishedAt": "2026-09-28T20:00:00.000Z",
      "ingestedAt": "2026-09-28T18:09:30.402Z",
      "source": { "id": "617a1441-…", "slug": "bbc-news", "name": "BBC News", "siteUrl": "https://www.bbc.co.uk" },
      "category": { "id": "…", "slug": "geral", "name": "Geral", "color": "#64748b" },
      "summary": null
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 485, "totalPages": 49, "hasNext": true, "hasPrev": false }
}
```

### `GET /news/:id`

Uma notícia, mesmo formato do item acima. `404 NOT_FOUND` se o id não existir ou não for uuid.

### `GET /news/:id/summary`

Resumo salvo. **`200` com `data: null` significa “ainda não gerado”** — não é erro.

```json
{ "data": null }
```

Quando existe:

```json
{
  "data": {
    "text": "Resgate de duas páginas, com seis feridos…",
    "generatedByAi": true,
    "provider": "openrouter",
    "model": "openrouter/free",
    "promptVersion": "v1",
    "language": "pt-BR",
    "createdAt": "2026-09-28T18:20:11.004Z",
    "updatedAt": "2026-09-28T18:20:11.004Z",
    "tokensIn": 512,
    "tokensOut": 96
  }
}
```

### `POST /news/:id/summary`

Gera o resumo sob demanda e devolve `200`.

- Já existe válido para `(notícia, modelo, versão do prompt)` → devolve o salvo com `"cached": true`,
  **sem chamar a IA**.
- Texto da notícia mudou → o `input_hash` não bate, então regenera.
- Duas requisições simultâneas do mesmo artigo → compartilham uma única chamada.
- Limite mais estrito: `429 RATE_LIMITED` ao estourar `SUMMARY_RATE_LIMIT_MAX`.
- Falha da OpenRouter → `5xx` com código `AI_*`; nada é salvo como se fosse resumo válido.

```bash
curl -X POST http://localhost:4000/api/v1/news/$ID/summary
```

```json
{
  "data": {
    "text": "…",
    "generatedByAi": true,
    "cached": false,
    "provider": "openrouter",
    "model": "openrouter/free",
    "promptVersion": "v1",
    "language": "pt-BR",
    "createdAt": "2026-09-28T18:20:11.004Z",
    "updatedAt": "2026-09-28T18:20:11.004Z",
    "tokensIn": 512,
    "tokensOut": 96
  }
}
```

---

## Categorias

### `GET /categories`

```json
{
  "data": [
    {
      "id": "…",
      "slug": "tecnologia",
      "name": "Tecnologia",
      "description": "…",
      "color": "#0ea5e9",
      "articleCount": 195,
      "createdAt": "2026-09-28T17:58:02.115Z"
    }
  ]
}
```

### `POST /categories` → `201`

| Campo         | Regras                                  |
| ------------- | --------------------------------------- |
| `slug`        | 2–60, `^[a-z0-9]+(-[a-z0-9]+)*$`, único |
| `name`        | 2–80, único                            |
| `description` | opcional, até 300                      |
| `color`       | opcional, `#rrggbb`                    |

```bash
curl -X POST http://localhost:4000/api/v1/categories \
  -H 'content-type: application/json' \
  -d '{"slug":"mercados","name":"Mercados","color":"#22c55e"}'
```

`409 CONFLICT` se `slug` ou `name` já existirem.

### `PATCH /categories/:id` → `200`

Mesmo campos, todos opcionais, ao menos um informado.

### `DELETE /categories/:id` → `204`

As notícias da categoria ficam sem categoria (`on delete set null`); o histórico é preservado.

### `GET /categories/rules`

Todas as palavras-chave, com o `categoryId` de cada uma.

```json
{ "data": [{ "id": "…", "categoryId": "…", "keyword": "mercado financeiro", "createdAt": "…" }] }
```

### `POST /categories/:id/rules` → `201`

```bash
curl -X POST http://localhost:4000/api/v1/categories/$CAT/rules \
  -H 'content-type: application/json' -d '{"keyword":"mercado financeiro"}'
```

A palavra-chave é comparada sem acento e sem caixa; a mais longa vence.

### `DELETE /categories/:id/rules/:ruleId` → `204`

---

## Fontes

### `GET /sources`

```json
{
  "data": [
    {
      "id": "…",
      "slug": "g1",
      "name": "G1 Globo",
      "feedUrl": "https://g1.globo.com/rss/g1/",
      "siteUrl": "https://g1.globo.com",
      "defaultCategoryId": "…",
      "enabled": true,
      "etag": "W/\"6a1f…\"",
      "lastModified": "Mon, 28 Sep 2026 17:00:00 GMT",
      "lastFetchedAt": "2026-09-28T18:09:30.451Z",
      "lastStatus": "ok",
      "lastError": null,
      "category": { "id": "…", "slug": "geral", "name": "Geral", "color": "#64748b" },
      "createdAt": "2026-09-28T17:58:02.115Z"
    }
  ]
}
```

`lastStatus` é `ok`, `not_modified`, `error` ou `null` (nunca executada).

### `POST /sources` → `201`

| Campo               | Regras                                     |
| ------------------- | ------------------------------------------ |
| `slug`              | 2–60, `^[a-z0-9]+(-[a-z0-9]+)*$`, único, imutável |
| `name`              | 2–80                                      |
| `feedUrl`           | URL absoluta de RSS/Atom                   |
| `siteUrl`           | opcional, URL absoluta                    |
| `defaultCategoryId` | opcional, uuid de categoria               |
| `enabled`           | opcional, padrão `true`                    |

```bash
curl -X POST http://localhost:4000/api/v1/sources -H 'content-type: application/json' \
  -d '{"slug":"meu-journal","name":"Meu Journal","feedUrl":"https://exemplo.com/rss.xml","siteUrl":"https://exemplo.com"}'
```

`409 CONFLICT` se o `slug` já existir.

### `PATCH /sources/:id` → `200`

Aceita `name`, `feedUrl`, `siteUrl`, `defaultCategoryId` e `enabled`. O `slug` é imutável de propósito:
ele identifica a fonte em todo o histórico, e trocá-lo quebraria referências antigas. Desativar
(`enabled: false`) interrompe a coleta agendada; as notícias já ingeridas permanecem.

### `DELETE /sources/:id` → `204`

`on delete cascade`: remove também as notícias e o histórico daquela fonte.

### `POST /sources/:id/ingest` → `200`

Coleta só essa fonte, sem esperar o agendador. Mesmo formato de resultado da ingestão.

---

## Ingestão

### `POST /ingest/run` → `200`

Coleta todas as fontes ativas (concorrência limitada a `INGEST_CONCURRENCY`) e devolve o relatório.
Uma fonte com erro não interrompe as outras. `409 CONFLICT` se já houver uma coleta em andamento.

```bash
curl -X POST http://localhost:4000/api/v1/ingest/run
```

```json
{
  "data": {
    "startedAt": "2026-09-28T18:09:28.594Z",
    "finishedAt": "2026-09-28T18:09:30.452Z",
    "sources": 9,
    "inserted": 485,
    "duplicates": 11,
    "failed": 0,
    "results": [
      { "sourceId": "…", "slug": "g1", "name": "G1 Globo", "status": "ok", "fetched": 0, "inserted": 0, "duplicates": 0 },
      { "sourceId": "…", "slug": "bbc-news", "name": "BBC News", "status": "ok", "fetched": 34, "inserted": 34, "duplicates": 0 }
    ]
  }
}
```

`status` por fonte: `ok`, `not_modified` (304) ou `error` (com `error` preenchido).

### `GET /ingest/runs`

Histórico, mais recente primeiro.

| Query    | Tipo      | Padrão |
| -------- | --------- | ------ |
| `limit`  | int 1–200 | `20`   |
| `source` | uuid      | —      |

```json
{
  "data": [
    {
      "id": "…",
      "sourceId": "…",
      "sourceName": "BBC News",
      "status": "ok",
      "httpStatus": 200,
      "notModified": false,
      "fetched": 34,
      "inserted": 0,
      "duplicates": 34,
      "error": null,
      "startedAt": "2026-09-28T18:12:04.201Z",
      "finishedAt": "2026-09-28T18:12:04.612Z"
    }
  ]
}
```

---

## Autenticação

Não existe. A API é anônima e o projeto não tem usuário. Isso é uma escolha consciente, com uma
consequência: **as rotas de escrita (`POST`/`PATCH`/`DELETE` de categorias, fontes e palavras-chave)
são públicas para quem alcançar a porta**.

O motivo é escopo: o produto pedido é leitura pública com curadoria, e a API é idempotente por
natureza (dedup por constraint, cache de resumo), então writes acidentais são reversíveis. A sequência
para abrir isso: coluna `user_id` em `articles` e `ai_summaries` por migration, tabela `users` e um
middleware de sessão antes das rotas de escrita. O desenho não trava esse passo — nenhuma tabela tem
chave composta que dependa de usuário, e os repositórios são a única camada que toca o schema.

Se a API for publicada antes disso, o mínimo é um proxy com autenticação na frente e
`SUMMARY_RATE_LIMIT_MAX` bem mais baixo: é a rota que consome cota de terceiros.
