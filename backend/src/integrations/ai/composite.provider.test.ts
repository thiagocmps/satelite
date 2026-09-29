import { describe, expect, it, vi } from 'vitest';
import { ExternalServiceError, TimeoutError } from '../../core/errors.js';
import type { AiProvider, AiSummaryResult, ClassifyInput, SummarizeInput } from './ai.provider.js';
import { CompositeProvider } from './composite.provider.js';

const result = (provider: string, model = 'm'): AiSummaryResult => ({
  text: 'ok',
  provider,
  model,
  promptTokens: 1,
  completionTokens: 1,
  latencyMs: 1,
});

const input: SummarizeInput = { title: 'T', description: null, content: null };
const classifyInput: ClassifyInput = {
  title: 'T',
  description: null,
  content: null,
  categories: [{ slug: 'mundo', name: 'Mundo' }],
};

/** Provedor fake: `summarize`/`classify` gravam as chamadas e respondem o que for configurado. */
class SpyProvider implements AiProvider {
  readonly summarize = vi.fn<(_: SummarizeInput) => Promise<AiSummaryResult>>();
  readonly classify = vi.fn<(_: ClassifyInput) => Promise<AiSummaryResult>>();

  constructor(
    readonly name: string,
    readonly model: string,
  ) {
    this.summarize.mockImplementation(async () => result(name, model));
    this.classify.mockImplementation(async () => result(name, model));
  }

  failWith(error: Error): void {
    this.summarize.mockRejectedValue(error);
    this.classify.mockRejectedValue(error);
  }
}

const serviceError = (code: string) => new ExternalServiceError(code, `${code} do provedor`);

describe('CompositeProvider', () => {
  it('expoe nome/modelo do primeiro provedor', () => {
    const chain = new CompositeProvider([new SpyProvider('openrouter', 'm1'), new SpyProvider('opencode', 'm2')]);
    expect(chain.name).toBe('openrouter');
    expect(chain.model).toBe('m1');
  });

  it('rejeita cadeia vazia', () => {
    expect(() => new CompositeProvider([])).toThrow('pelo menos um provedor');
  });

  it('devolve o resultado do principal quando ele responde (secundario nao e chamado)', async () => {
    const primary = new SpyProvider('openrouter', 'm1');
    const secondary = new SpyProvider('opencode', 'm2');
    const composite = new CompositeProvider([primary, secondary]);

    const summary = await composite.summarize(input);
    const classify = await composite.classify(classifyInput);

    expect(summary.provider).toBe('openrouter');
    expect(classify.provider).toBe('openrouter');
    expect(secondary.summarize).not.toHaveBeenCalled();
    expect(secondary.classify).not.toHaveBeenCalled();
  });

  it('cai para o secundario quando o principal estoura a cota do plano gratuito (429)', async () => {
    const primary = new SpyProvider('openrouter', 'm1');
    const secondary = new SpyProvider('opencode', 'm2');
    primary.failWith(serviceError('AI_RATE_LIMIT'));
    const composite = new CompositeProvider([primary, secondary]);

    const summary = await composite.summarize(input);
    const classify = await composite.classify(classifyInput);

    expect(summary).toMatchObject({ text: 'ok', provider: 'opencode', model: 'm2' });
    expect(classify).toMatchObject({ provider: 'opencode' });
    expect(secondary.summarize).toHaveBeenCalledTimes(1);
    expect(secondary.classify).toHaveBeenCalledTimes(1);
  });

  it('cai para o secundario quando o principal esta sem creditos (402)', async () => {
    const primary = new SpyProvider('openrouter', 'm1');
    const secondary = new SpyProvider('opencode', 'm2');
    primary.failWith(serviceError('AI_QUOTA'));

    const result = await new CompositeProvider([primary, secondary]).summarize(input);

    expect(result.provider).toBe('opencode');
    expect(secondary.summarize).toHaveBeenCalledTimes(1);
  });

  it('cai para o secundario em timeout ou gateway fora', async () => {
    for (const error of [new TimeoutError('timeout'), serviceError('UPSTREAM_UNREACHABLE'), serviceError('AI_UPSTREAM_ERROR')]) {
      const primary = new SpyProvider('openrouter', 'm1');
      const secondary = new SpyProvider('opencode', 'm2');
      primary.failWith(error);

      const result = await new CompositeProvider([primary, secondary]).summarize(input);

      expect(result.provider).toBe('opencode');
    }
  });

  it('NAO troca de provedor em erro de credencial', async () => {
    const primary = new SpyProvider('openrouter', 'm1');
    const secondary = new SpyProvider('opencode', 'm2');
    primary.failWith(serviceError('AI_AUTH_INVALID'));

    await expect(new CompositeProvider([primary, secondary]).summarize(input)).rejects.toMatchObject({
      code: 'AI_AUTH_INVALID',
    });
    expect(secondary.summarize).not.toHaveBeenCalled();
  });

  it('NAO troca de provedor em resposta ilegivel do modelo', async () => {
    const primary = new SpyProvider('openrouter', 'm1');
    const secondary = new SpyProvider('opencode', 'm2');
    primary.failWith(serviceError('AI_BAD_RESPONSE'));

    await expect(new CompositeProvider([primary, secondary]).summarize(input)).rejects.toMatchObject({
      code: 'AI_BAD_RESPONSE',
    });
    expect(secondary.summarize).not.toHaveBeenCalled();
  });

  it('tenta toda a cadeia em ordem e relanca o ultimo erro quando todos falham', async () => {
    const primary = new SpyProvider('openrouter', 'm1');
    const secondary = new SpyProvider('opencode', 'm2');
    const tertiary = new SpyProvider('groq', 'm3');
    primary.failWith(serviceError('AI_RATE_LIMIT'));
    secondary.failWith(serviceError('AI_RATE_LIMIT'));
    tertiary.failWith(serviceError('AI_RATE_LIMIT'));

    await expect(new CompositeProvider([primary, secondary, tertiary]).summarize(input)).rejects.toMatchObject({
      code: 'AI_RATE_LIMIT',
    });
    expect(secondary.summarize).toHaveBeenCalledTimes(1);
    expect(tertiary.summarize).toHaveBeenCalledTimes(1);
  });
});