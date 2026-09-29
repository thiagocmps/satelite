# Arquitetura

Este documento explica **por que** o satelite é construído assim: as decisões, as alternativas
consideradas e o que muda em cada uma. O [README](../README.md) cobre o uso do dia a dia e o
[DEVELOPERS.md](DEVELOPERS.md) percorre o caminho de um item pelo código.

## Visão geral

O sistema tem três processos independentes e um banco:

| Processo  | Responsabilidade                                                        | Estado        |
| --------- | ----------------------------------------------------------------------- | ------------- |
| `db`      | PostgreSQL: dados, busca full-text, constraints                          | volume `pgdata` |
| `backend` | API REST, agendador de ingestão, cliente de IA                           | sem estado    |
| `frontend`| SPA servida por nginx, com proxy de `/api`                                | sem estado    |

Só o banco guarda estado. O backend pode ser reiniciado ou replicado sem perda; o frontend é um
artefato estático.

## Fluxo de dados

```
fonte RSS ──GET condicional──> rss.adapter ──parse──> rss.normalize ──> articles (PG)
                                    │                       │
                                    │                       └── keyword-engine (regras) ──> IA (OpenRouter, só na dúvida) ──> articles
                                    └── ingestion_runs (saúde por execução)
                                                                        │
articles (PG) ──GET /news──> API ──proxy /api──> nginx ──> React ──clique──> POST /news/:id/summary
                                                                        │
                                                        OpenRouter ──────┘ (ai_summaries)
```

## Decisões

### 1. API REST com controllers/services/repositories

Cada módulo (`news`, `summaries`, `categories`, `sources`, `ingestion`) é fatiado em:

```
*.routes.ts      → método + caminho + middlewares
*.controller.ts  → HTTP: lê req, chama o service, monta a resposta
*.service.ts     → regra de negócio
*.repository.ts  → SQL
*.schemas.ts     → validação Zod da entrada
*.types.ts       → tipos do domínio
```

A divisão existe para tornar a regra de negócio testável sem HTTP e sem banco. Nos testes, só o
repositório é dublê; o service roda de verdade.

**Alternativa descartada:** controllers fatos com SQL. Menos arquivos, mas mistura regra com I/O e
torna o service impossível de testar isolado.

### 2. Injeção de dependências por container

`container.ts` é a única função que conhece a implementação concreta de cada dependência:

```ts
const container = createContainer(env, logger, pool);   // servidor.ts
const container = createContainer(env, logger, fakePool); // app.test.ts
```

O app Express recebe o container pronto e não importa nenhum repositório concreto. Consequência
direta: `app.test.ts` roda as rotas de verdade com dublês no lugar do banco, sem subir Postgres.

### 3. Deduplicação em três camadas

| Camada                              | Guarda contra                                  | Custo                       |
| ----------------------------------- | ---------------------------------------------- | --------------------------- |
| `unique (source_id, url_hash)`      | a mesma URL re-publicada pelo mesmo feed       | um índice                   |
| `unique fingerprint` (título)       | mesma notícia com URL diferente (syndicated)   | um índice                   |
| `insert … on conflict do nothing`   | corrida entre duas instâncias na mesma hora    | nada além do SQL            |

A inserção é em lote (`insertMany`, blocos de 400 linhas) e devolve quantas entraram e quantas eram
duplicadas — é o número que aparece no histórico de ingestão.

**Alternativa descartada:** “select e depois insert” evita conflito, mas abre corrida entre
instâncias e dobra as idas ao banco. `on conflict do nothing returning id` faz o banco decidir em
uma única instrução — e o `rowCount` já é a contagem de inseridos.

### 4. Busca full-text com *generated column*

```sql
search_vector tsvector generated always as (
  setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('portuguese', coalesce(description, '')), 'B')
) stored
```

- `websearch_to_tsquery` dá a sintaxe conhecida do usuário: `"frase exata"`, `ou`, `-excluir`.
- Índice `GIN` em `search_vector`.
- `ts_rank` alimenta `sort=relevance`.
- Fallback: se a busca por full-text não retorna nada, o backend repete com `ILIKE` no título —
  busca parcial e com acento continua funcionando mesmo quando o stemming português não cobre o termo.

**Alternativa descartada:** trigger + índice. Gera o mesmo resultado, mas esconde a regra do
`schema` e exige backfill quando a função muda. Coluna gerada é visível na definição da tabela e o
Postgres nunca deixa ela divergir da linha.

**Nota sobre idioma:** o dicionário é `portuguese`, o que faz stemming razoável em português e
funciona razoavelmente em inglês. Para um corpus majoritariamente de outro idioma, troque o
dicionário e recrie o índice — é uma migration de duas linhas.

### 5. Coleta condicional (ETag / Last-Modified)

Cada execução manda `If-None-Match` e `If-Modified-Since` com o valor salvo em `sources`. Resposta
`304` vira uma execução com status `not_modified`, sem parsing e sem custo de banda. Na primeira
coleta de uma fonte os dois campos vêm vazios, então o servidor responde o conteúdo inteiro.

**Alternativa descartada:** coletar sempre e descartar duplicado no banco. Multiplica banda e tempo
de parsing para descartar exatamente o que já temos.

### 6. Categorização por palavra-chave (camada determinística)

`category_rules` guarda `(category_id, keyword)`. Na ingestão, o **título + descrição** é
normalizado (minúsculas, sem acento, espaços únicos) e comparado com borda de palavra (a keyword
precisa ficar isolada — “nasa” não casa em “nasal”). O conteúdo do artigo **não** entra nesta camada,
para a keyword não decidir por uma palavra enterrada no corpo da notícia.

A comparação normaliza os dois lados e ordena da palavra mais específica para a mais genérica, para
que “mercado financeiro” ganhe de “mercado”. Resultados possíveis:

- **uma categoria casa** → decisão forte: `category_method='keyword'`, sem custo de modelo;
- **mais de uma casa** (ambíguo) ou **nenhuma** → sem decisão determinística.

Sem decisão e com texto suficiente (`AI_CLASSIFY_MIN_TEXT_CHARS`), o artigo entra na fila
`articles.needs_ai` e o **segundo estágio** (IA) decide; texto curto demais sai da fila como está
(vale a categoria padrão da fonte ou nenhuma).

**Filtro de conteúdo esportivo** (`CONTENT_FILTER_SPORTS`, padrão ligado): antes da categorização,
`isSportsContent` (em `modules/classification/sports-block.ts`, ~110 termos PT/EN de clubes,
modalidades e competições, com borda de palavra sobre o texto já normalizado) roda sobre o mesmo
escopo da keyword (título + descrição). Casou → o item é **descartado na ingestão** (não entra no
banco; contador `filteredSports` no relatório de execução) e, se já estiver na fila de classificação,
sai dela **sem custo de modelo** (contador `blocked`). única exceção: notícia que a keyword já
decidiu como **Política** — política que cita esporte (proibição de bets, regras da Copa) é mantida;
o termo casou apenas como coadjuvante. A lista foi curada com auditoria ao vivo (termos ambíguos que
derrubavam política/ciência/lazer — “fluminense”, “liverpool”, “squash”, “rally”, “olimpiada”
singular — ficaram de fora) e tem testes de falso positivo. Como a keyword vence o filtro de esporte?
Não: o filtro roda **antes** e a exceção só segura o que a keyword classificou como política.

### 7. Classificação por IA (só na dúvida)

O segundo estágio processa a fila `needs_ai` (`POST /ingest/classify` ou botão em Fontes). A ordem de
prioridade por artigo: regra de keyword decide → sai sem custo; filtro de esporte (ou política que
cita esporte, que sai mantendo a categoria) → sai sem custo; texto curto demais → sai como está; o
restante vai para a IA com o catálogo real de categorias (slug + nome).

O prompt de classificação é few-shot (4 exemplos) e instrui: **o título manda** (para um agregador
multifonte o título é o argumento mais confiável), **esporte → não escolher categoria nenhuma** e
**na dúvida → não escolher** (a dúvida custa menos que o erro). A resposta é JSON
`{"categorySlug", "confidence"}`; slug fora do catálogo ou confiança abaixo de
`AI_CLASSIFY_MIN_CONFIDENCE` (0.6) não aplica categoria, e tudo grava `category_method`/`category_confidence`
em `articles`.

**Cota e fallback de provedor:** a rodada aborta no primeiro 429 **geral** (cota OpenRouter gratuita
= 50 req/dia). Com `AI_FALLBACK_PROVIDERS` (ex.: `opencode`, o OpenCode Zen, modelo gratuito)
o abort só dispara quando **toda a cadeia** falha — o 429 do OpenRouter vira tentativa no Zen, e a
fila continua andando sem esperar o reset diário (ver §9).

### 8. Resumo por IA sob demanda, cacheado

```
GET  /news/:id/summary   → 200 com data: null, ou o resumo salvo
POST /news/:id/summary   → gera se não existir; devolve o salvo se existir
```
```

Quatro mecanismos evitam chamada duplicada:

1. `unique (article_id, model, prompt_version)` no banco — a garantia final, inclusive entre instâncias.
2. `input_hash` = sha256(prompt_version, model, título, descrição, conteúdo) — se o texto muda, o
   resumo é regenerado em vez de devolvido desatualizado.
3. `Map<chave, Promise>` em processo — duas requisições simultâneas do mesmo artigo compartilham a
   mesma promessa em vez de gastar duas chamadas.
4. `status` `ok`/`error` — falha fica registrada e **nunca** é exposta como se fosse resumo.

O `POST` tem rate limit próprio (10/min por padrão), bem mais estrito que o global, porque é a rota
que consome cota de terceiros.

**Alternativa descartada:** gerar resumo na ingestão. Multiplicaria o consumo da cota gratuita por
todo item coletado, a maioria nunca lido. Sob demanda + cache dá o mesmo resultado para quem lê.

### 9. Provedor de IA intercambiável

```ts
interface AiProvider {
  readonly name: string;   // identificador estável gravado no banco
  readonly model: string;
  summarize(input): Promise<AiSummaryResult>;
  classify(input): Promise<AiSummaryResult>;
}
```

A maioria dos gateways fala uma API compatível com OpenAI `/chat/completions` (OpenRouter e o
OpenCode Zen são dois exemplos). Por isso a implementação é uma classe única,
`OpenAICompatibleProvider` em `integrations/ai/openai-compatible.provider.ts`, que recebe por
configuração o que muda entre eles: `name`, chave, endpoint, modelo e o comportamento da
classificação. Os registros `openrouter` e `opencode` são subclasses de uma linha — nada de SDK.

Robustez, toda dentro do provider:

- Timeout por `AbortSignal` (`AI_TIMEOUT_MS`, no Zen reusa o mesmo).
- Retry em 429/5xx, respeitando `Retry-After`, até `AI_MAX_RETRIES` por modelo.
- Em seguida, tentativa no próximo modelo de `AI_FALLBACK_MODELS`.
- Mapeamento de erro para códigos estáveis: `AI_AUTH_INVALID` (401/403), `AI_QUOTA` (402),
  `AI_RATE_LIMIT` (429), `AI_UPSTREAM_ERROR` (5xx/gateway fora), `AI_BAD_RESPONSE` (resposta vazia
  ou sem conteúdo).

**Fallback entre provedores (`CompositeProvider`).** `ai.registry.ts` resolve `AI_PROVIDER` como
principal e `AI_FALLBACK_PROVIDERS` como cadeia: com mais de um, devolve um `CompositeProvider` que
tenta em ordem e só relança o erro se **todos** falharem. A troca de provedor acontece exatamente nas
falhas que outro gateway resolveria — `AI_QUOTA` (cota zerada, o caso de uso do plano gratuito),
`AI_RATE_LIMIT` (429), `AI_UPSTREAM_ERROR`, gateway fora e timeout. Erro de **credencial**
(`AI_AUTH_INVALID`) e resposta **ilegível** (`AI_BAD_RESPONSE`) não trocam de provedor: repetir com
outra chave resolve pouco, e texto ruim não melhora. Como o fallback devolve o resultado do provedor
que respondeu, o `provider` real fica gravado no banco (`openrouter` ou `opencode`), e o circuito do
classificador continua sendo o abort no primeiro 429 — porém só quando a cadeia inteira falhou (§7).

A integração usa `fetch` nativo, sem SDK: o contrato é uma requisição JSON documentada, e um SDK
seria só mais uma dependência para acompanhar. O Zen não cobra nada por `space-bunny-free`
(`Authorization: Bearer public`, chave pública do próprio gateway), então o fallback é grátis por
construção — não depende de conta nem de saldo.

### 10. Agendador in-process

`node-cron` roda a coleta a cada `INGEST_CRON`, com `noOverlap` para não empilhar execuções se uma
demorar mais que o intervalo. `ENABLE_INGEST=false` desliga.

**Alternativa descartada:** fila (BullMQ/Redis). Uma fila real traz retry com backoff, DLQ e
distribuição — nenhum dos quais é necessário enquanto a coleta é um `Promise.allSettled` sobre 9
feeds. Quando a escala exigir, o ponto de troca é `ingestion.service.ts`; o agendador vira apenas
um cliente da fila.

### 11. Migrations em SQL com runner próprio

`db/migrations/*.sql`, aplicados em ordem alfabética, cada arquivo em uma transação, com checksum
conferido e `pg_advisory_lock` para serializar instâncias. `migrate.js` roda como job único no
Compose e o backend só sobe depois que ele termina com sucesso (`service_completed_successfully`).

**Alternativa descartada:** ORM com migrations. Um ORM custaria mais do que economiza: as
consultas são pequenas, e SQL explícito deixa visível o uso dos índices.

### 12. Tratamento de erro centralizado

Hierarquia de `AppError` com `status` e `code` (`ValidationError`, `NotFoundError`, `ConflictError`,
`ExternalServiceError`, `TimeoutError`). O `errorHandler` normaliza tudo em
`{ error: { code, message, details?, requestId } }`, escolhe o nível de log e nunca vaza stack para o
cliente. Violações de unique do Postgres são traduzidas para `409` no repositório em vez de virar
`500`.

### 13. Segurança

- `helmet` na API (sem CSP: quem serve a UI é o nginx, e a API devolve JSON e imagens de terceiros),
  `crossOriginResourcePolicy: cross-origin` para o navegador aceitar as imagens das fontes, e headers
  próprios no nginx para o frontend.
- `cors` com allowlist explícita (vazia por padrão, já que produção é mesma origem).
- `express-rate-limit` global e mais estrito na geração de resumo, com `trust proxy` habilitado
  (sem isso, atrás do nginx todo request pareceria vir do mesmo IP).
- Zod em **toda** entrada: query, params e body, com mensagens por campo.
- Todo SQL é parametrizado; `limit` da listagem é limitado a 50.
- Segredo nunca sai do backend: o frontend consome só `/api/v1` e o `.env` não é montado nos
  containers.
- Resposta de feed com `content-length` acima de `FEED_MAX_BYTES` é recusada antes de ler o corpo —
  um feed que se declara gigante não vira consumo de banda nem de memória.

### 14. Frontend com React Query

Componentes não conhecem a API. A cadeia é: **página → hook (`useSatelite.ts`) → função de API →
client HTTP**. O `QueryClient` centraliza `staleTime` (30s), política de retry (não repete erro 4xx) e
invalidação — gerar um resumo invalida a lista, e o card passa a exibir o selo “✦ resumo IA” sem
recarregar a página.

O estado dos filtros vive na URL (`?q=…&categoria=…&pagina=…`), então o resultado é compartilhável e
o botão “voltar” do navegador funciona.

CSS é plano, com tokens em `styles/tokens.css` e tema claro/escuro por `prefers-color-scheme` —
sem framework de estilo, sem *CSS-in-JS*, sem build step além do Vite.

## Escala e o que vem depois

O desenho já suporta múltiplas instâncias do backend: a API é sem estado, as migrations são
serializadas por advisory lock, e a deduplicação de resumo é garantida por constraint. Os três
primeiros pontos de atrito, em ordem:

1. **Rate limit por instância.** Hoje é em memória; com N réplicas o limite efetivo multiplica por N.
   Solução: store compartilhado (Redis) ou um proxy que limite antes de chegar na aplicação.
2. **Coleta duplicada entre instâncias.** Duas réplicas com o agendador ligado coletam a mesma fonte.
   Solução: `pg_try_advisory_lock` por fonte, ou desabilitar `ENABLE_INGEST` nas réplicas que não
   coletam (o desenho já separa: o Compose só liga o agendador no serviço `backend`).
3. **Jobs longos.** A coleta é síncrona e pode levar alguns minutos com muitas fontes.
   Solução: o mesmo `ingestion.service.ts` consumindo de uma fila, com o endpoint virando
   “enfileira e responde”.

Nada disso exige reescrever o domínio: são três Adaptadores (rate limit store, lock por fonte,
driver de fila) em volta de código que já está isolado.

## O que este projeto deliberadamente não tem

Sem autenticação, favoritos, notificações, WebSocket, multi-tenant, painel de analytics, cluster ou
service mesh. Cada um adicionaria um serviço, um schema ou um fluxo de estado que o uso real ainda
não pede. Nenhum deles exige reescrever o dominio: entram como migration nova, e os pontos de extensao
ja estao isolados (repositorio, service, container).
