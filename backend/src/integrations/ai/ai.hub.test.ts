import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { aiDefaults } from '../../modules/settings/settings.defaults.js';
import type {
  AiSettings,
  ProviderSettings,
  VersionedAiSettingsSource,
} from '../../modules/settings/settings.types.js';
import { AiHub } from './ai.hub.js';
import type {
  AiProvider,
  AiSummaryResult,
  ClassifyInput,
  SuggestGroupInput,
  SummarizeInput,
} from './ai.provider.js';

const base = aiDefaults(
  loadEnv({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/satelite',
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'sk-or-teste',
  }),
);

/** providers e Record: sempre perguntar com fallback (noUncheckedIndexedAccess). */
const openrouterOf = (settings: AiSettings): ProviderSettings =>
  settings.providers.openrouter ?? {
    apiKey: 'sk-or-teste',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    fallbackModels: [],
    classifyModel: '',
    classifyFallbackModels: [],
  };

const result = (model: string): AiSummaryResult => ({
  text: 'ok',
  provider: 'fake',
  model,
  promptTokens: 1,
  completionTokens: 1,
  latencyMs: 1,
});

function fakeProvider(model: string, withBatch: boolean): AiProvider {
  const provider: AiProvider = {
    name: 'fake',
    model,
    summarize: (_input: SummarizeInput) => Promise.resolve(result(model)),
    classify: (_input: ClassifyInput) => Promise.resolve(result(model)),
    suggestGroup: (_input: SuggestGroupInput) => Promise.resolve(result(model)),
  };
  if (withBatch) {
    provider.classifyBatch = (inputs: ClassifyInput[]) => Promise.resolve(result(`${model}:${inputs.length}`));
  }
  return provider;
}

/** Fonte versionada falsa: `change()` simula um save na tela de config. */
function fakeSettings(initial: AiSettings = base) {
  let settings = initial;
  let version = 1;
  const source: VersionedAiSettingsSource = {
    ai: () => settings,
    get version() {
      return version;
    },
  };
  return {
    source,
    change(overrides: Partial<AiSettings>) {
      settings = { ...settings, ...overrides };
      version += 1;
    },
  };
}

describe('AiHub', () => {
  it('devolve o provedor construido com a config atual', () => {
    const { source } = fakeSettings();
    const build = vi.fn((s: AiSettings) => fakeProvider(openrouterOf(s).model, false));
    const hub = new AiHub(source, build);

    expect(hub.name).toBe('fake');
    expect(hub.model).toBe(openrouterOf(base).model);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('reconstrói so quando a versao muda (sem troca = mesma instancia)', async () => {
    const { source, change } = fakeSettings();
    const build = vi.fn((s: AiSettings) => fakeProvider(openrouterOf(s).model, false));
    const hub = new AiHub(source, build);

    // leituras repetidas sem mudanca nao gastam rebuild
    expect(hub.model).toBe(hub.model);
    expect(build).toHaveBeenCalledTimes(1);

    change({
      providers: { ...base.providers, openrouter: { ...openrouterOf(base), model: 'novo-modelo' } },
    });

    expect(hub.model).toBe('novo-modelo');
    expect(build).toHaveBeenCalledTimes(2);
    const raw = await hub.summarize({ title: 't', description: null, content: null });
    expect(raw.model).toBe('novo-modelo');
  });

  it('espelha classifyBatch do provider atual (ausente = ausente)', () => {
    const { source, change } = fakeSettings();
    const build = vi.fn((s: AiSettings) => fakeProvider(openrouterOf(s).model, false));
    const hub = new AiHub(source, build);

    expect(hub.classifyBatch).toBeUndefined();

    build.mockImplementation((s: AiSettings) => fakeProvider(openrouterOf(s).model, true));
    change({
      providers: { ...base.providers, openrouter: { ...openrouterOf(base), fallbackModels: ['x'] } },
    });

    expect(typeof hub.classifyBatch).toBe('function');
  });

  it('delega suggestGroup ao provedor vigente', async () => {
    const { source } = fakeSettings();
    const hub = new AiHub(source, () => fakeProvider('modelo-1', false));

    const raw = await hub.suggestGroup({ title: 't', description: null, content: null, groups: [] });
    expect(raw.model).toBe('modelo-1');
  });
});
