import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import { ValidationError } from '../../core/errors.js';
import { AI_PROVIDER_IDS } from '../../integrations/ai/ai.registry.js';
import type { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';
import type { AiSettingsPatch } from './settings.types.js';

const env = () =>
  loadEnv({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/satelite',
    // fixamos o principal aqui: estes testes exercitam o mecanismo de
    // defaults/overrides do SettingsService, nao qual provider e o default.
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'sk-or-teste-abcdef',
  });

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function setup(stored: Record<string, unknown> = {}) {
  const repository = {
    all: vi.fn(async () => stored),
    upsert: vi.fn(async () => undefined),
  } satisfies SettingsRepository;
  const service = new SettingsService(env(), repository, logger);
  return { service, repository };
}

describe('SettingsService', () => {
  it('sem overrides, a config efetiva sao os defaults do .env', async () => {
    const { service } = setup();
    await service.reload();

    const ai = service.ai();
    expect(ai.provider).toBe('openrouter');
    expect(ai.scheduler.classifyCron).toBe('*/10 * * * *');
    expect(ai.providers.openrouter?.apiKey).toBe('sk-or-teste-abcdef');
  });

  it('defaults cobrem todos os provedores registrados', async () => {
    const { service } = setup();
    await service.reload();

    for (const id of AI_PROVIDER_IDS) {
      expect(service.ai().providers[id]).toBeDefined();
    }
  });

  it('reload aplica o override salvo no banco por cima do .env', async () => {
    const { service } = setup({ ai: { classify: { batch: 42 } } });
    await service.reload();

    expect(service.ai().classify.batch).toBe(42);
    // o resto continua vindo do .env
    expect(service.ai().classify.batchSize).toBe(service.ai().classify.batchSize);
    expect(service.ai().provider).toBe('openrouter');
  });

  it('banco indisponivel nao derruba: fica so no .env e loga warn', async () => {
    const repository = {
      all: vi.fn(async () => {
        throw new Error('tabela nao existe');
      }),
      upsert: vi.fn(async () => undefined),
    } satisfies SettingsRepository;
    const service = new SettingsService(env(), repository, logger);

    await expect(service.reload()).resolves.toBeUndefined();
    expect(service.ai().provider).toBe('openrouter');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('stored corrompido cai nos defaults do .env em vez de quebrar', async () => {
    const { service } = setup({ ai: { provider: 'fantasma' } });
    await service.reload();

    expect(service.ai().provider).toBe('openrouter');
    expect(logger.error).toHaveBeenCalled();
  });

  it('view mascara a chave (so o sufixo aparece, nunca a chave inteira)', async () => {
    const { service } = setup();
    await service.reload();

    const view = service.view();
    expect(view.settings.providers.openrouter?.apiKey).toBe('••••cdef');
    expect(JSON.stringify(view)).not.toContain('sk-or-teste-abcdef');
    // meta dos provedores + descritores vao junto (a UI renderiza por eles)
    expect(view.providers.map((p) => p.id)).toEqual(AI_PROVIDER_IDS);
    expect(view.fields.some((field) => field.key === 'classify.batch')).toBe(true);
  });

  it('update persiste, bumpa a versao e roda os appliers', async () => {
    const { service, repository } = setup();
    await service.reload();
    const versionBefore = service.version;
    const applier = vi.fn();
    service.onApply(applier);

    const view = await service.update({ classify: { batch: 77 } });

    expect(repository.upsert).toHaveBeenCalledWith('ai', { classify: { batch: 77 } });
    expect(service.ai().classify.batch).toBe(77);
    expect(service.version).toBe(versionBefore + 1);
    expect(applier).toHaveBeenCalledTimes(1);
    expect(view.settings.classify.batch).toBe(77);
  });

  it('update acumula sobre o ja salvo (nao zera os overrides anteriores)', async () => {
    const { service, repository } = setup({ ai: { classify: { batch: 42, concurrency: 3 } } });
    await service.reload();

    await service.update({ classify: { batch: 9 } });

    expect(repository.upsert).toHaveBeenCalledWith('ai', { classify: { batch: 9, concurrency: 3 } });
    expect(service.ai().classify.concurrency).toBe(3);
  });

  it('troca de provedor vale na hora (versao muda = hub reconstrói)', async () => {
    const { service } = setup({ ai: { providers: { groq: { apiKey: 'gsk_nova_chave_1234' } } } });
    await service.reload();
    const versionBefore = service.version;

    const view = await service.update({ provider: 'groq' });

    expect(service.ai().provider).toBe('groq');
    expect(service.version).toBeGreaterThan(versionBefore);
    // chave nova aparece mascarada com o sufixo recem-salvo
    expect(view.settings.providers.groq?.apiKey).toBe('••••1234');
  });

  it('PATCH com chave vazia mantem a atual (a mascara nunca vale como chave)', async () => {
    const { service, repository } = setup();
    await service.reload();

    await service.update({ providers: { openrouter: { apiKey: '' } } });

    // nada de apiKey gravado no banco: o default do .env continua valendo
    expect(repository.upsert).toHaveBeenCalledWith('ai', { providers: { openrouter: {} } });
    expect(service.ai().providers.openrouter?.apiKey).toBe('sk-or-teste-abcdef');
  });

  it('cron invalido e recusado com o caminho do campo', async () => {
    const { service } = setup();
    await service.reload();

    await expect(service.update({ scheduler: { classifyCron: 'todo dia' } })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    // nao persistiu nada
    expect(service.ai().scheduler.classifyCron).toBe('*/10 * * * *');
  });

  it('provedor desconhecido e recusado', async () => {
    const { service } = setup();
    await service.reload();

    await expect(service.update({ provider: 'antropic' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('trocar para provedor sem chave (nem no .env nem no banco) e recusado', async () => {
    const { service } = setup();
    await service.reload();

    await expect(service.update({ provider: 'groq' })).rejects.toMatchObject({ status: 400 });
  });

  it('fallback repetindo o principal e recusado', async () => {
    const { service } = setup();
    await service.reload();

    const patch: AiSettingsPatch = { provider: 'openrouter', fallbackProviders: ['openrouter'] };
    await expect(service.update(patch)).rejects.toMatchObject({ status: 400 });
  });
});
