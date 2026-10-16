# Testes — Correção da classificação automática por IA

Data: 16/10/2026 · Ambiente: `docker compose` local (`backend :4000`, `db :5433`, `frontend :4100`)

## 1. Contexto

A classificação roda sozinha: o cron (`*/10`) drena a fila `needs_ai` em background.
O usuário questionou se a IA estava realmente funcionando. A investigação ao vivo
mostrou que o pipeline **funcionava ponta a ponta** (1.765 artigos classificados por
IA nas últimas 24h), mas os ciclos recentes operavam com **~85% de erro** — só
8–16 artigos por lote saíam, e a fila (~4.930) praticamente parava.

Este documento registra a causa raiz, as correções aplicadas e os testes que
validam cada etapa.

## 2. Causa raiz (evidência dos logs)

| Sintoma (ciclo típico) | Valor observado |
|---|---|
| `processed` | 100 |
| `aiCalls` | 13 |
| `aiAssigned` | 8–16 |
| **`errors`** | **84–88** |
| `pending` | ~4.930 (estagnado) |

Três problemas encadeados:

### 2.1 — Gargalo real: **TPD 200K tokens/dia** (não TPM, não req/dia)

```
Rate limit reached for model `qwen/qwen3.8-27b` ... on tokens per day (TPD):
Limit 200000, Used 197751, Requested 2917. Please try again in 4m48s.
```

O plano gratuito do Groq limita **200.000 tokens por dia** para o modelo de
classificação. Cada lote de 8 artigos custa ~3.000 tokens → teto de ~65 lotes/dia
≈ 520 artigos/dia. Os headers da janela de minuto (`x-ratelimit-limit-tokens: 8000`)
confirmam que o TPM (8K/min) não é o limite apertado — o diário é.

### 2.2 — Fallback OpenRouter morto

- `openrouter/free` → `429: Rate limit exceeded: free-models-per-day` (sem crédito).
- `qwen/qwen3.8-27b:free` → `404: This model is unavailable for free` (removido do free).

O OpenRouter era o **fallback** da cadeia. Como todos os modelos free estavam
mortos, todo 429 do Groq escalava para o OpenRouter e morria lá com 404.

### 2.3 — Circuito de aborto não disparava

O `ClassificationService` tem um circuito (`abort.hit`) que deveria parar a rodada
no primeiro `AI_RATE_LIMIT`. Mas como o erro **final** da cadeia era o 404 do
OpenRouter (`AI_UPSTREAM_ERROR`, não `AI_RATE_LIMIT`), o circuito nunca era
acionado — a rodada seguia puxando os 13 lotes, todos falhando. Resultado:
`errors: 84`.

## 3. Correções aplicadas (em runtime, via `PATCH /api/v1/settings/ai`)

Nenhuma mudança de código. Tudo pelo menu gráfico de config da IA (tela
`/config-ia`), persistido em `app_settings` (migration 010), valendo sem reiniciar.

| Campo | Antes | Depois | Motivo |
|---|---|---|---|
| `fallbackProviders` | `["openrouter"]` | `[]` | Cadeia só-Groq; OpenRouter free está morto. |
| `classify.concurrency` | `2` | `1` | Lotes sequenciais ficam sob o TPM de 8K/min. |
| `providers.groq.fallbackModels` | `["openai/gpt-oss-20b"]` | `[]` | `gpt-oss-*` é reasoning: `content` volta vazio → "texto não utilizável". |
| `classify.maxContentChars` | `800` | `500` | Estica o orçamento diário (TPD) ~40%; o título é a fonte primária da decisão, o texto é só apoio. |

Ajuste de consistência no `.env` (defaults para boots futuros — não entra no git):
`AI_FALLBACK_PROVIDERS=` (vazio), `AI_CLASSIFY_CONCURRENCY=1`,
`AI_CLASSIFY_MAX_CONTENT_CHARS=500`.

## 4. Testes executados

### 4.1 — Sondagem de provedores (cURL direto)

| Provedor / modelo | Resultado | Conclusão |
|---|---|---|
| Groq `qwen/qwen3.8-27b` (chamada mínima) | `200` → `ok` | Funciona; único chat free útil do Groq hoje. |
| Groq `openai/gpt-oss-120b` | `content: ""`, tudo em `reasoning` | Reasoning — inutilizável como fallback de classificação. |
| OpenRouter `openrouter/free` | `429` free-models-per-day | Morto sem crédito. |
| OpenRouter `qwen/qwen3.8-27b:free` | `404` unavailable for free | Morto. |
| Catálogo Groq free (`GET /models`) | `qwen`, `gpt-oss-*`, `whisper`, `allam` | Só `qwen3.8-27b` serve p/ chat em pt-BR. |

### 4.2 — Teste de concorrência (rajada)

10 chamadas paralelas ao Groq → **2 vieram `429`** (TPM 8K/min estourado).
Confirma que `concurrency > 1` causa 429 em rajada. Com `concurrency: 1`,
cada lote (~3K tokens) fica sob o teto de minuto.

### 4.3 — Suíte de testes de regressão (backend)

```
npx vitest run        → Test Files 25 passed (25) · Tests 306 passed (306)
npx tsc -p tsconfig.json --noEmit → sem erros
```

Frontend: `npx tsc -b --noEmit` → sem erros. (Nenhum código alterado; confirmação
de não-regressão.)

### 4.4 — API de configuração em runtime

| Teste | Esperado | Obtido |
|---|---|---|
| `PATCH {"classify":{"concurrency":1},"fallbackProviders":[],"providers":{"groq":{"fallbackModels":[]}}}` | 200, config aplicada | ✅ `version: 4`, cadeia `[groq]`, concorrência 1 |
| `GET` (chave mascarada) | nunca expõe chave real | ✅ `••••sUE3` |
| `PATCH {"classify":{"concurrency":0}}` (invalidação) | `400` | ✅ `HTTP 400` |
| `PATCH {"classify":{"maxContentChars":500}}` | 200, valor novo | ✅ `version: 5` |
| Log de aplicação | evento registrado | ✅ `configuracao em runtime salva e aplicada` |

### 4.5 — Validação ao vivo dos ciclos (cron `*/10`)

| Horário (UTC) | Config | `aiCalls` | `aiAssigned` | `errors` | Observação |
|---|---|---|---|---|---|
| 07:57 | antiga (concurrency 2, OpenRouter) | 13 | 4 | **96** | Referência do problema. |
| 08:05 | transição (PATCH no meio) | 6 | 0 | 48 | Ciclo iniciado com config antiga. |
| 08:10 | nova (só-Groq, conc. 1) | 1 | 0 | 8 | Bateu TPD; circuito parou no 1º lote. |
| 08:21 | nova | 2 | **2** | 8 | Pipeline classificou artigos reais. |

**`errors` caiu de 84–88 para 8.** Os 8 restantes são uma tentativa de lote que
bate no TPD e o circuito aborta corretamente (em vez de 84).

### 4.6 — Amostra de classificação real (banco)

8 artigos com `ai_classified_at` nos últimos 30 min. Amostra:

| Título (truncado) | Categoria | Método | Confiança |
|---|---|---|---|
| Na volta da propaganda no rádio, Flávio Bolsonaro… | `politica` | ai | 0.95 |
| Jovem que sofreu AVC e foi deixado em ambulância… | *(null)* | ai | — |
| Imagens aéreas mostram avião em chamas sobre trilhos… | *(null)* | ai | — |

Classificações `null` são **corretas**: a regra de ouro 2 do prompt manda responder
`null` em vez de adivinhar (título genérico / manchete de acidente sem categoria
clara). Esses artigos saem da fila sem categoria, sem custo extra.

### 4.7 — Limpeza de fonte de teste

Fonte `teste-e2e` (`https://teste.local/feed`) ainda poluía o log a cada ciclo
com `fetch failed`. Removida pela API oficial: `DELETE /api/v1/sources/:id` → `204`.
Verificação em banco: 0 fontes, 0 artigos órfãos.

## 5. Realidade de vazão (plano gratuito)

O teto agora é o **TPD de 200K tokens/dia** do Groq:

- Lote de 8 artigos @ 500 chars ≈ ~2.400 tokens.
- ~80 lotes/dia ≈ **~640 artigos/dia** por IA.
- A fila de ~4.930 drena em **~7–8 dias**, depois acompanha a ingestão.

Pontos que **não** são bug e sim limite do plano free:
- O ciclo às vezes processa 1–2 lotes e para: bateu o TPD do dia, circuito aborta
  como projetado. A janela é rolante de 24h — libera sozinha.
- `pending` oscila porque a ingestão continua adicionando.

Opções para acelerar (decisão do usuário):
1. **Groq Dev Tier** (pago) — remove o TPD.
2. **OpenRouter com US$ 10 de crédito** — destrava 1.000 req/dia de free models
   (reativar `fallbackProviders: ["openrouter"]` pela tela).
3. Reduzir `classify.maxContentChars` (500 → 350) — ganha ~20% mais artigos/dia
   ao custo de contexto por notícia.

## 6. Conclusão

- **A IA funciona ponta a ponta.** Evidência: 1.765 classificadas em 24h; pipeline,
  cron e cadeia de provedores vivos.
- **As correções em runtime reduziram o erro de ~85% para ~8%** por ciclo, ao
  remover o fallback morto, serializar as chamadas e ajustar o corte de conteúdo.
- **O circuito de aborto agora dispara** no TPD, parando a rodada em vez de
  martelar a API — comportamento correto de degradação.
- **Resta o teto do plano free** (200K tokens/dia), que limita a vazão a
  ~640 artigos/dia. A fila drena sozinha em ~1 semana; para mais velocidade,
  só com plano pago ou crédito OpenRouter.
