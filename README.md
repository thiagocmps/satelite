# satelite

Agregador de notícias que coleta feeds RSS/Atom públicos, guarda tudo em PostgreSQL sem duplicar,
oferece busca com filtros e gera **resumos por IA** sob demanda via [OpenRouter](https://openrouter.ai).

Frontend React, API Node/Express, banco PostgreSQL, stack completa em Docker Compose com um comando.

```bash
cp .env.example .env        # ajuste OPENROUTER_API_KEY
docker compose up --build   # http://localhost:8080
```

---

## Sumário

- [O que o app faz](#o-que-o-app-faz)
- [Stack](#stack)
- [Arquitetura](#arquitetura)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Pré-requisitos](#pré-requisitos)
- [Rodando com Docker](#rodando-com-docker)
- [Rodando localmente](#rodando-localmente)
- [Configuração por ambiente](#configuração-por-ambiente)
- [Configurando a OpenRouter](#configurando-a-openrouter)
- [Endpoints](#endpoints)
- [Exemplos de requisição](#exemplos-de-requisição)
- [Estrutura do banco](#estrutura-do-banco)
- [Como adicionar uma fonte](#como-adicionar-uma-fonte)
- [Como trocar o modelo de IA](#como-trocar-o-modelo-de-ia)
- [Decisões de arquitetura](#decisões-de-arquitetura)
- [Testes](#testes)
- [Solução de problemas](#solução-de-problemas)
- [Mais documentação](#mais-documentação)

---

## O que o app faz

- **Agregação RSS/Atom** de múltiplas fontes, coletadas por agendador (`node-cron`) ou sob demanda.
- **Sem duplicatas** por três camadas: hash da URL por fonte, *fingerprint* do título normalizado e
  `insert … on conflict do nothing` no banco.
- **Busca e filtros**: palavra-chave (full-text em português), categoria, fonte e intervalo de datas,
  com paginação e ordenação por data ou relevância.
- **Categorias** criadas pela interface, com palavras-chave aplicadas automaticamente na ingestão.
  Quem casar com o título/descrição vence a categoria padrão da fonte.
- **Resumo por IA** por notícia, gerado sob demanda, **guardado no banco** e reutilizado
  (inclusive com versão do prompt e hash do conteúdo, para invalidar quando o texto muda).
  Sempre marcado como gerado por IA na interface.
- **Administração** de fontes e categorias pela própria interface web.
- **Saúde da coleta**: histórico por execução e por fonte, com erro, status HTTP e contagem de duplicados.

## Stack

| Camada      | Escolha                                        | Por quê                                                          |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Frontend    | React 19, Vite, React Router, TanStack Query   | SPA com cache, invalidação e estados de loading/error prontos      |
| Backend     | Node 24, Express 5, TypeScript, Zod, Pino      | API REST pequena, tipada, com tratamento de erro centralizado      |
| Banco       | PostgreSQL 17                                  | Full-text search, *generated column*, constraints e JSONB           |
| Integração  | `rss-parser`, `fetch` nativo                    | RSS/Atom e HTTP sem SDKs pesados                                     |
| IA          | OpenRouter (`chat/completions`)                | Gateway único, muitos modelos, cota gratuita                       |
| Infra       | Docker Compose, nginx                          | `docker compose up --build` e só isso                               |

Sem Redis, RabbitMQ, Kubernetes ou service mesh: para o volume e a latência deste app, Postgres +
agendador in-process cobrem com folga, e o desenho já permite plugar esses componentes depois
(ver [Decisões de arquitetura](#decisões-de-arquitetura)).

## Arquitetura

```
   fontes RSS/Atom
          │  GET condicional (ETag / If-Modified-Since)
          ▼
   ┌──────────────────────────────────────────────┐
   │  rss.adapter → rss.normalize                │   HTML limpo, imagem, autor, datas
   │  ingestion.service → category-matcher       │   regra por palavra-chave
   └──────────────────────────────────────────────┘
          │  INSERT … ON CONFLICT DO NOTHING
          ▼
   ┌──────────────── PostgreSQL ────────────────┐
   │ articles · sources · categories            │
   │ category_rules · ai_summaries              │
   │ ingestion_runs · schema_migrations          │
   └──────────────────────────────────────────────┘
          │                          │  chat/completions
          ▼                          ▼
   ┌──────────────┐        ┌────────────────────┐
   │  Express API │◀───────│  OpenRouter        │
   │  /api/v1     │        │  (retry + fallback)│
   └──────────────┘        └────────────────────┘
          │  /api/* (proxy)
          ▼
   ┌──────────────┐
   │  nginx + SPA │  React
   └──────────────┘
```

O caminho de um item, ponta a ponta: **fonte → ingestão → normalização → PostgreSQL → API → React → resumo por IA**.
Detalhamento em [`docs/DEVELOPERS.md`](docs/DEVELOPERS.md).

## Estrutura de pastas

```
satelite/
├── backend/
│   └── src/
│       ├── config/        env (Zod) e logger (Pino)
│       ├── core/          erros de domínio, limpeza de HTML, hash, helper HTTP
│       ├── db/            pool, runner de migrations, erros do Postgres
│       ├── integrations/
│       │   ├── rss/       adapter (HTTP + parser) e normalização
│       │   └── ai/        interface do provedor, prompts, OpenRouter, registry
│       ├── middleware/    validação (Zod), tratamento de erro, rate limit
│       ├── modules/       news · summaries · categories · sources · ingestion
│       │   ├── *.routes.ts · *.controller.ts · *.service.ts
│       │   └── *.repository.ts · *.schemas.ts · *.types.ts
│       ├── scheduler/     agendador de ingestão
│       ├── routes/        montagem das rotas
│       ├── app.ts         app Express
│       ├── container.ts   composição (injeção de dependências)
│       └── server.ts      bootstrap e shutdown gracioso
├── frontend/
│   └── src/
│       ├── api/           client HTTP e funções da API
│       ├── components/    componentes de apresentação
│       ├── hooks/         hooks TanStack Query (única camada que fala com a API)
│       ├── pages/         Noticias · Detalhe · Categorias · Fontes
│       ├── styles/        tokens de design e estilos
│       └── utils/         formatação (datas, slug, host)
├── db/migrations/         001_init.sql · 002_seed.sql
├── docs/                  ARCHITECTURE.md · DEVELOPERS.md · API.md
├── docker-compose.yml
└── .env.example
```

## Pré-requisitos

- **Docker + Docker Compose** (caminho recomendado) — nada mais.
- Ou, para rodar localmente: **Node.js ≥ 22** e **PostgreSQL ≥ 15** acessível.

## Rodando com Docker

```bash
cp .env.example .env
# opcional: ponha sua chave em OPENROUTER_API_KEY no .env
docker compose up --build
```

O Compose sobe quatro serviços, na ordem certa:

| Serviço   | O que faz                                                             | Porta |
| --------- | --------------------------------------------------------------------- | ----- |
| `db`      | PostgreSQL 17 com volume `pgdata` e healthcheck via `pg_isready`        | 5433  |
| `migrate` | aplica `db/migrations/*.sql` uma vez e sai (o backend espera o sucesso)  | —     |
| `backend` | API Express, com healthcheck                                           | 4000  |
| `frontend`| nginx servindo a SPA e fazendo proxy de `/api` para o backend            | 8080  |

Abra **http://localhost:8080**. A API responde em http://localhost:4000/api/v1.

Primeiro uso: o banco já vem com 8 categorias, 47 palavras-chave e 9 feeds válidos
(semFolha — o feed do newspaper que devolvia 404 ficou de fora). Dispare a primeira coleta com
**“⟳ Ingerir agora”** na página de notícias ou `curl -X POST http://localhost:4000/api/v1/ingest/run`.

Comandos úteis:

```bash
docker compose logs -f backend     # logs estruturados (JSON)
docker compose restart backend
docker compose down                 # para tudo, mantém o banco
docker compose down -v              # apaga também o volume do banco
```

> O `.env` **não** é montado dentro dos containers: ele apenas preenche as variáveis declaradas no
> bloco `environment:` do Compose. Nenhum arquivo de credencial entra na imagem.

## Rodando localmente

```bash
npm install                 # instala os dois workspaces (backend e frontend)

# 1. Banco: aponte DATABASE_URL para um Postgres local
export DATABASE_URL=postgres://satelite:satelite@localhost:5432/satelite
export OPENROUTER_API_KEY=sk-or-v1-...

npm run migrate             # aplica db/migrations/*.sql
npm run dev                 # backend em :4000 e frontend em :5173
```

O frontend de desenvolvimento faz proxy de `/api` para `http://localhost:4000`
(configurável com `API_URL` no `vite.config.ts`), então o código usa a mesma rota `/api/v1` nos
dois ambientes.

Outros scripts (na raiz):

```bash
npm run build       # compila backend (tsc) e frontend (vite build)
npm run typecheck   # TypeScript sem emitir nada
npm test            # suíte do backend (vitest)
npm run dev:backend # só a API, com watch
```

## Configuração por ambiente

Todas as variáveis ficam em `.env` (copie de `.env.example`). O backend valida tudo na inicialização
com Zod: se algo estiver errado, a API **não sobe** e o log diz exatamente qual campo falhou.

| Variável                          | Padrão                 | O que faz                                                              |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`                        | `production`           | `development` ativa log detalhado                                       |
| `LOG_LEVEL`                       | `info`                 | Nível do Pino (`debug`, `info`, `warn`, `error`)                        |
| `APP_NAME`                        | `Satelite`             | Nome enviado ao OpenRouter (`X-Title`)                                 |
| `APP_URL`                         | `http://localhost:8080`| Enviado ao OpenRouter (`HTTP-Referer`)                                 |
| `DATABASE_URL`                    | —                      | String de conexão do Postgres (**obrigatório**)                        |
| `DATABASE_POOL_MAX`               | `10`                   | Conexões por instância da API                                          |
| `CORS_ORIGINS`                    | vazio                  | Origens liberadas, separadas por vírgula. Vazio = mesma origem         |
| `RATE_LIMIT_WINDOW_MS` / `_MAX`   | `900000` / `600`       | Limite global de requisições                                            |
| `SUMMARY_RATE_LIMIT_WINDOW_MS` / `_MAX` | `60000` / `10`   | Limite mais estrito para `POST /news/:id/summary`                      |
| `ENABLE_INGEST`                   | `true`                 | `false` desliga o agendador (só coleta manual)                         |
| `INGEST_CRON`                     | `*/15 * * * *`         | Expressão cron da coleta                                                |
| `INGEST_CONCURRENCY`              | `4`                    | Fontes coletadas em paralelo                                           |
| `INGEST_TIMEOUT_MS`               | `20000`                | Timeout de cada requisição de feed                                     |
| `FEED_MAX_BYTES`                  | `8000000`              | Tamanho máximo de um feed (8 MB)                                       |
| `AI_PROVIDER`                     | `openrouter`           | Provedor registrado em `ai.registry.ts`                                |
| `OPENROUTER_API_KEY`              | —                      | Chave da OpenRouter (**obrigatório** com `AI_PROVIDER=openrouter`)     |
| `OPENROUTER_BASE_URL`             | `https://openrouter.ai/api/v1` | Endpoint do gateway                                            |
| `AI_MODEL`                        | `openrouter/free`      | Modelo principal                                                        |
| `AI_FALLBACK_MODELS`              | —                      | Lista separada por vírgula, tentada em sequência quando o principal falha |
| `AI_TIMEOUT_MS`                   | `45000`                | Timeout da chamada de IA                                                |
| `AI_MAX_RETRIES`                  | `2`                    | Tentativas por modelo (429/5xx), respeitando `Retry-After`             |
| `AI_PROMPT_VERSION`               | `v1`                   | Versão do prompt; mudar invalida resumos antigos                       |
| `AI_LANGUAGE`                     | `pt-BR`                | Idioma pedido no resumo                                                |
| `AI_MAX_CONTENT_CHARS`            | `4000`                 | Limite de caracteres do texto enviado ao modelo                         |

Variáveis só do Compose: `FRONTEND_PORT` (8080), `BACKEND_PORT` (4000), `POSTGRES_PORT` (5433),
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

## Configurando a OpenRouter

1. Crie uma conta em <https://openrouter.ai> e gere uma chave em <https://openrouter.ai/keys>.
2. Coloque no `.env`:
   ```bash
   OPENROUTER_API_KEY=sk-or-v1-...
   AI_MODEL=openrouter/free
   ```
3. Suba de novo (`docker compose up -d backend`) e clique em **“✦ Gerar resumo com IA”** numa notícia.

O padrão `AI_MODEL=openrouter/free` é o roteador de modelos gratuitos da OpenRouter: o gateway escolhe
um modelo disponível no momento, então a cota gratuita não acaba por um modelo específico sair do ar.
Para mais previsibilidade, fixe um modelo concreto (veja
[Como trocar o modelo de IA](#como-trocar-o-modelo-de-ia)).

A chave **nunca** chega ao navegador: ela é lida apenas pelo backend, e o proxy do nginx expõe só
`/api/v1`. A configuração é validada na inicialização — com `AI_PROVIDER=openrouter` e a chave
vazia, o backend recusa subir e aponta o campo no log, em vez de aceitar tráfego e falhar só quando
alguém pede um resumo.

## Endpoints

Base: `/api/v1`. Respostas de sucesso usam `{ "data": ... }`; listas acrescentam `pagination`.

| Método | Rota                          | Descrição                                              |
| ------ | ----------------------------- | ------------------------------------------------------ |
| `GET`  | `/health`                     | Vivo (não checa banco)                                  |
| `GET`  | `/health/ready`               | Pronto: `503` se o Postgres não responder               |
| `GET`  | `/news`                       | Lista com filtros e paginação                            |
| `GET`  | `/news/:id`                   | Uma notícia com resumo, se existir                      |
| `GET`  | `/news/:id/summary`           | Resumo salvo; `data: null` se ainda não foi gerado       |
| `POST` | `/news/:id/summary`           | Gera o resumo sob demanda (com cache)                   |
| `GET`  | `/categories`                 | Categorias com contagem de notícias                     |
| `POST` | `/categories`                 | Cria categoria                                          |
| `PATCH`| `/categories/:id`             | Atualiza categoria                                      |
| `DELETE`| `/categories/:id`            | Remove categoria                                        |
| `GET`  | `/categories/rules`           | Todas as palavras-chave                                 |
| `POST` | `/categories/:id/rules`       | Adiciona palavra-chave                                  |
| `DELETE`| `/categories/:id/rules/:ruleId` | Remove palavra-chave                                 |
| `GET`  | `/sources`                    | Fontes cadastradas com saúde da última coleta           |
| `GET`  | `/sources/export`             | Download das fontes: `?format=opml` (padrão) \| `json`  |
| `POST` | `/sources/import`             | Importa fontes de um arquivo OPML ou JSON (aditivo)      |
| `POST` | `/sources`                    | Adiciona fonte                                          |
| `PATCH`| `/sources/:id`                | Atualiza fonte (ex.: `enabled`)                          |
| `DELETE`| `/sources/:id`               | Remove fonte                                            |
| `POST` | `/sources/:id/ingest`         | Coleta só essa fonte                                    |
| `POST` | `/ingest/run`                 | Coleta todas as fontes ativas                           |
| `GET`  | `/ingest/runs`                | Histórico de execuções                                  |

Parâmetros de `GET /news`: `q`, `category` (uuid), `source` (uuid), `from`, `to` (`YYYY-MM-DD`),
`page` (≥1), `limit` (1–50, padrão 12), `sort` (`recent` | `relevance`).

Erros seguem sempre a mesma forma, com `requestId` para correlacionar com o log:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados invalidos",
    "details": { "field": "query", "issues": [{ "path": "limit", "message": "Too big: expected number to be <=50" }] },
    "requestId": "0e9754bf-eadd-4779-aadb-32ec37c94958"
  }
}
```

Códigos: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `TIMEOUT`, `FEED_HTTP_ERROR`,
`FEED_INVALID_XML`, `AI_AUTH_INVALID`, `AI_QUOTA`, `AI_RATE_LIMIT`, `AI_UPSTREAM_ERROR`,
`AI_BAD_RESPONSE`, `INTERNAL_ERROR`.

Detalhes de cada rota, parâmetros e exemplos: [`docs/API.md`](docs/API.md).

## Exemplos de requisição

```bash
# 10 notícias mais recentes
curl 'http://localhost:4000/api/v1/news?limit=10'

# busca por palavra-chave, ordenando por relevância
curl 'http://localhost:4000/api/v1/news?q=inteligencia%20artificial&sort=relevance'

# só de uma categoria, nas últimas 24h
curl "http://localhost:4000/api/v1/news?category=$(curl -s localhost:4000/api/v1/categories | jq -r '.data[] | select(.slug=="tecnologia") | .id')&from=$(date -d yesterday +%F)"

# uma notícia
curl http://localhost:4000/api/v1/news/<id>

# resumo salvo (200 com data: null se nunca foi gerado)
curl http://localhost:4000/api/v1/news/<id>/summary

# gera o resumo pela IA
curl -X POST http://localhost:4000/api/v1/news/<id>/summary

# coleta todas as fontes agora
curl -X POST http://localhost:4000/api/v1/ingest/run

# nova fonte
curl -X POST http://localhost:4000/api/v1/sources \
  -H 'content-type: application/json' \
  -d '{"slug":"meu-journal","name":"Meu Journal","feedUrl":"https://exemplo.com/rss.xml","siteUrl":"https://exemplo.com"}'

# nova categoria com palavra-chave
curl -X POST http://localhost:4000/api/v1/categories \
  -H 'content-type: application/json' -d '{"slug":"mercados","name":"Mercados","color":"#22c55e"}'
```

## Estrutura do banco

| Tabela           | Papel                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `categories`     | Categorias criadas pela interface (`slug` único, cor, contagem derivada)                 |
| `category_rules` | Palavras-chave por categoria, aplicadas na ingestão                                      |
| `sources`        | Feed, site, cache condicional (`etag`, `last_modified`) e saúde da última coleta          |
| `articles`       | Notícias: URL, hash, *fingerprint*, título, descrição, conteúdo, imagem, autor, datas     |
| `ai_summaries`   | Resumo por (notícia, modelo, versão do prompt), com `input_hash`, status e tokens          |
| `ingestion_runs` | Uma linha por execução de coleta, por fonte, com contagens e erro                         |
| `schema_migrations` | Controle de migrations (versão, checksum, data)                                       |

Constraints e índices que importam:

- `articles`: `unique (source_id, url_hash)`, `unique (fingerprint)` — as duas barreiras de duplicata;
  índice em `(published_at desc, id)` para a listagem, `GIN` em `search_vector`, índices em
  `category_id`, `source_id` e `published_at`.
- `articles.search_vector`: *generated column* (`to_tsvector('portuguese', title || description)`)
  com pesos A/B — busca full-text sem trigger para manter.
- `ai_summaries`: `unique (article_id, model, prompt_version)` garante que o mesmo resumo não é
  gerado duas vezes, nem por corrida entre instâncias.
- `categories`: `on delete set null` nas notícias — remover uma categoria não apaga o histórico.
- `sources`: `on delete cascade` em `articles` e `ingestion_runs`.

Migrations são arquivos `.sql` em `db/migrations/`, aplicados em ordem, dentro de uma transação por
arquivo e protegidos por `pg_advisory_lock` (duas instâncias subindo juntas não correm migration
duplicada). O checksum é conferido: editar uma migration já aplicada faz o processo falhar em vez de
silenciar o esquecimento.

## Como adicionar uma fonte

**Pela interface** (página *Fontes*): nome, slug (gerado se vazio), URL do feed, site e categoria
padrão. Clique em **“Ingerir”** na linha para coletar na hora.

**Importando um arquivo** (página *Fontes* → botão **“⇧ Importar”**, ou `POST /sources/import`):
aceita **OPML** (o padrão de listas de RSS — exportável do Feedly, Inoreader etc., e também o
formato exportado por esta própria interface) e **JSON** (o backup de `GET /sources/export`).
O import é **aditivo**: só cadastra o que ainda não existe (comparando por URL canônica), gera
slugs sem colidir e responde com um relatório do que entrou e do que foi ignorado (com motivo).

```bash
# restore do próprio backup
curl -X POST http://localhost:4000/api/v1/sources/import -H 'content-type: text/xml' \
  --data-binary @fontes.opml
# formato JSON: um array ou { "data": [...] }
curl -X POST http://localhost:4000/api/v1/sources/import -H 'content-type: application/json' \
  --data-binary @fontes.json
```

**Pela API:**

```bash
curl -X POST http://localhost:4000/api/v1/sources -H 'content-type: application/json' \
  -d '{"slug":"meu-journal","name":"Meu Journal","feedUrl":"https://exemplo.com/rss.xml","siteUrl":"https://exemplo.com"}'
```

Regras práticas:

- A URL precisa devolver RSS 2.0 ou Atom **com `Content-Type` de XML ou texto**; devolva 200.
- `slug` é único e imutável — é a identidade estável da fonte.
- O adapter guarda `ETag`/`Last-Modified`: nas próximas coletas um `304` é registrado como
  `not_modified` e não gera tráfego de parsing.
- Feed grande ou lento demais? Ajuste `FEED_MAX_BYTES` e `INGEST_TIMEOUT_MS`.

## Como trocar o modelo de IA

```bash
# modelo fixo
AI_MODEL=google/gemma-4-31b-it:free
# ou uma cadeia de alternativas (vírgula), tentadas em ordem
AI_MODEL=openrouter/free
AI_FALLBACK_MODELS=google/gemma-4-31b-it:free,qwen/qwen3.8-27b:free
```

A lista de modelos disponíveis está em <https://openrouter.ai/models> (o filtro `:free` mostra os
gratuitos). O modelo vem do ambiente, então a troca é só reiniciar o backend — sem deploy.

Como o resumo é cacheado por `(notícia, modelo, versão do prompt)`, trocar de modelo **não** apaga
nada: o resumo antigo continua salvo, e o novo é gerado no próximo clique. Para forçar a regeração
de todos os resumos, aumente `AI_PROMPT_VERSION` — isso invalida o cache sem apagar o histórico.

Para outro provedor (Anthropic, OpenAI, Ollama…), implemente a interface `AiProvider` em
`backend/src/integrations/ai/ai.provider.ts` e registre em `ai.registry.ts`. Nenhum outro arquivo
precisa mudar: `AI_PROVIDER` escolhe o registro.

## Decisões de arquitetura

**Deduplicação em três camadas.** `url_hash` por fonte pega a mesma URL re-publicada; `fingerprint`
(sha256 do título normalizado) pega a mesma notícia com URL diferente (comum em syndicated feeds); e
`on conflict do nothing` fecha a corrida entre duas instâncias coletando ao mesmo tempo. Nenhuma das
camadas depende da outra para ser suficiente.

**Busca com *generated column*.** `search_vector` é recalculado pelo próprio Postgres a cada
`insert`/`update`, sem trigger e sem passo de backfill. `websearch_to_tsquery` dá a sintaxe do
Google (`"frase exata"`, `ou`, `-excluir`) e, com `ts_rank`, alimenta `sort=relevance`. Quando a
busca não encontra nada por full-text, o backend repete com `ILIKE` no título — texto parcial e
acentuação continuam funcionando.

**Coleta condicional.** `If-None-Match`/`If-Modified-Since` persistidos em `sources`. Um feed sem
mudança custa um `304` e zero parsing. A primeira coleta é a única que gasta banda.

**Resumo sob demanda, nunca em lote.** Gerar resumo para tudo o que chega seria multiplicar a cota
gratuita por um texto que talvez ninguém leia. O botão por notícia resolve isso, e o cache no banco
(`unique (article_id, model, prompt_version)`) garante que nem cliques repetidos nem duas instâncias
gastem a mesma geração. Um `Map<chave, Promise>` em processo evita a corrida entre duas requisições
simultâneas do mesmo artigo; se o processo reiniciar, o banco continua sendo a fonte da verdade.

**Falha de IA nunca vira erro de leitura.** Resumo com `status='error'` fica guardado e não é
exposto: `GET /news` continua respondendo normalmente e a interface convida a tentar de novo. Erros
de provedor são mapeados para códigos estáveis (`AI_QUOTA`, `AI_RATE_LIMIT`, `AI_AUTH_INVALID`…),
com retry em 429/5xx e troca de modelo no fim da fila.

**API sem estado.** Nenhuma sessão, nenhum dado em memória além do cache de resumo em voo: dá para
rodar N réplicas atrás do mesmo balanceador, e a API já está preparada para isso (rate limit e
migrations são os únicos pontos que precisariam de coordenação — hoje são advisory locks e limites
por instância).

**Migrations em SQL puro.** Arquivos versionados, revisáveis no diff e executáveis por qualquer
`psql`. Um runner de ~80 linhas com checksum e advisory lock evita introduzir uma ferramenta a mais.

**Injeção de dependências explícita.** `container.ts` monta tudo e `app.ts` recebe o container
pronto. Testes trocam repositórios por dublês sem subir banco nem rede, e o servidor real não sabe que
existe container de teste.

**Mesma origem em produção.** O nginx serve a SPA e faz proxy de `/api`, então não há CORS nem
`VITE_API_URL` em produção. Em desenvolvimento o Vite faz o mesmo proxy. `CORS_ORIGINS` existe para o
caso de o frontend rodar em outro host.

## Testes

```bash
npm test          # ou: cd backend && npx vitest run
```

84 testes cobrindo o que mais quebra:

- **Normalização de RSS** — CDATA, HTML dentro dos campos, imagem por `media:content`/`media:thumbnail`,
  feeds sem autor/imagem, datas ausentes.
- **Deduplicação** — `url_hash` e `fingerprint` já existentes, `on conflict do nothing`, contagem de
  duplicados, execução concorrente.
- **OpenRouter** — parsing da resposta, retry em 429 respeitando `Retry-After`, fallback de modelo,
  mapeamento de 401/402/timeout/resposta vazia, resumo em cache sem nova chamada.
- **Categorização** — regra por palavra-chave vence a categoria da fonte, comparação sem acento e
  sem caixa, palavra mais específica primeiro.
- **Rotas** — `supertest` sobre o app: validação, 404, paginação, limite de `limit`, envelope de erro.
- **Repositórios** — tradução de violação de unique em `409` em vez de erro interno.

## Solução de problemas

<details>
<summary><b>A API não sobe: “Configuracao invalida”</b></summary>

O log aponta o campo. Quase sempre é `DATABASE_URL` ausente ou `OPENROUTER_API_KEY` vazia com
`AI_PROVIDER=openrouter`. Confira o `.env` e o bloco `environment:` do Compose — eles são dois
lugares diferentes, e o Compose só interpola o que está declarado.
</details>

<details>
<summary><b>“porta já está em uso” ao subir o Compose</b></summary>

Mude as portas no `.env`: `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`. O padrão do Postgres no
projeto é `5433` justamente para não colidir com um Postgres local.
</details>

<details>
<summary><b>Frontend abre mas a lista fica vazia</b></summary>

Aplique as migrations e rode a primeira coleta:

```bash
docker compose run --rm migrate     # ou: docker compose logs migrate
curl -X POST http://localhost:4000/api/v1/ingest/run
```
</details>

<details>
<summary><b>“Gerar resumo” responde erro de IA</b></summary>

- `AI_AUTH_INVALID` → chave inválida ou não lida; o `requestId` da resposta aparece no log do backend.
- `AI_QUOTA` / `AI_RATE_LIMIT` → cota gratuita esgotada. Ajuste `AI_MODEL` ou configure
  `AI_FALLBACK_MODELS`; o resumo em cache continua sendo servido normalmente.
- `AI_UPSTREAM_ERROR` → o gateway está fora. O erro fica registrado e a notícia continua legível.

O `.env` é lido na inicialização: depois de mudar a chave, `docker compose up -d backend`.
</details>

<details>
<summary><b>Uma fonte aparece com erro no histórico</b></summary>

A página *Fontes* mostra `last_error` e o status HTTP. Causas comuns: feed fora do ar (404/410),
XML inválido (`FEED_INVALID_XML`), timeout (`INGEST_TIMEOUT_MS` baixo demais) ou corpo grande demais
(`FEED_MAX_BYTES`). Uma falha não interrompe as outras fontes: cada uma registra sua própria execução.
</details>

<details>
<summary><b>Quero recomeçar do zero</b></summary>

```bash
docker compose down -v && docker compose up --build
```

Isso apaga o volume `pgdata`; as migrations e o seed são reaplicados na subida.
</details>

## Mais documentação

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — decisões de arquitetura em detalhe, com alternativas
  descartadas e o que muda em cada uma.
- [`docs/DEVELOPERS.md`](docs/DEVELOPERS.md) — o caminho completo de um item: fonte → ingestão →
  normalização → PostgreSQL → API → React → resumo por IA, com pointers de código.
- [`docs/API.md`](docs/API.md) — contrato de referência de todos os endpoints.
