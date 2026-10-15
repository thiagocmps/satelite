import type { Env } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import { ValidationError } from '../../core/errors.js';
import { AI_PROVIDER_IDS, AI_PROVIDER_META } from '../../integrations/ai/ai.registry.js';
import { aiDefaults } from './settings.defaults.js';
import { describeAiFields } from './settings.describe.js';
import { buildAiSettingsSchema } from './settings.schema.js';
import type { SettingsRepository } from './settings.repository.js';
import type {
  AiSettings,
  AiSettingsPatch,
  AiSettingsView,
  VersionedAiSettingsSource,
} from './settings.types.js';

export type SettingsGroup = 'ai';

/** Chave real nunca sai daqui: a UI recebe so o para (ex.: gsk_…8f59). */
const maskKey = (key: string) => (key ? `••••${key.slice(-4)}` : '');

function mask(settings: AiSettings): AiSettings {
  return {
    ...settings,
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([id, provider]) => [
        id,
        { ...provider, apiKey: maskKey(provider.apiKey) },
      ]),
    ),
  };
}

/** Merge profundo: objetos fundem; arrays e primitivos sao substituidos. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) return base;
  if (typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T;

  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged as T;
}

/**
 * apiKey vazio no PATCH = "manter a atual" (a mascara viajada de volta nunca
 * vale como chave nova). Assim o GET pode devolver a chave mascarada sem medo.
 */
function stripEmptyApiKeys(patch: AiSettingsPatch): AiSettingsPatch {
  if (!patch.providers) return patch;
  const providers = Object.fromEntries(
    Object.entries(patch.providers).map(([id, config]) => {
      if (!config || config.apiKey !== '') return [id, config];
      const { apiKey: _apiKey, ...rest } = config;
      return [id, rest];
    }),
  );
  return { ...patch, providers };
}

/**
 * Configuracao em runtime: defaults do `.env` sobrescritos pelo que estiver em
 * `app_settings` (migration 010). `ai()` e a leitura viva — services e o
 * AiHub consultam a cada operacao; `version` muda em reload/update e e o sinal
 * de que tudo precisa ser reconstruido (provider, cron), sem reiniciar.
 */
export class SettingsService implements VersionedAiSettingsSource {
  #stored: Partial<Record<SettingsGroup, unknown>> = {};
  #version = 0;
  #cache: { version: number; settings: AiSettings } | null = null;
  #appliers: Array<() => void | Promise<void>> = [];
  readonly #defaults: AiSettings;
  readonly #schema: ReturnType<typeof buildAiSettingsSchema>;

  constructor(
    env: Env,
    private readonly repository: SettingsRepository,
    private readonly logger: Logger,
  ) {
    this.#defaults = aiDefaults(env);
    this.#schema = buildAiSettingsSchema(AI_PROVIDER_IDS);
  }

  get version(): number {
    return this.#version;
  }

  /** Le os overrides do banco (chamado uma vez no boot; falha = fica no .env). */
  async reload(): Promise<void> {
    try {
      this.#stored = await this.repository.all();
      this.#version += 1;
      this.#cache = null;
      this.logger.info({ groups: Object.keys(this.#stored) }, 'configuracao em runtime carregada');
    } catch (error) {
      // migracao atrasada ou banco de teste: o boot nunca pode quebrar por isso
      this.logger.warn({ err: error }, 'app_settings indisponivel; usando apenas o .env');
    }
  }

  /** Config efetiva valida (memoizada por versao). Banco invalido cai no .env. */
  ai(): AiSettings {
    if (this.#cache && this.#cache.version === this.#version) return this.#cache.settings;

    const parsed = this.#schema.safeParse(this.#effective());
    if (!parsed.success) {
      this.logger.error({ issues: parsed.error.issues }, 'configuracao salva invalida; usando os defaults do .env');
      return this.#defaults;
    }
    this.#cache = { version: this.#version, settings: parsed.data };
    return parsed.data;
  }

  /** Visao para a UI: chaves mascaradas + descritores + meta dos provedores. */
  view(): AiSettingsView {
    const providers = AI_PROVIDER_IDS.map((id) => ({
      id,
      label: AI_PROVIDER_META[id].label,
      keyUrl: AI_PROVIDER_META[id].keyUrl,
    }));
    return {
      settings: mask(this.ai()),
      defaults: mask(this.#defaults),
      fields: describeAiFields(providers),
      providers,
      version: this.#version,
    };
  }

  /** Persiste o patch, valida o efetivo completo e roda os appliers (em runtime). */
  async update(patch: AiSettingsPatch): Promise<AiSettingsView> {
    const nextStored = deepMerge(this.#stored.ai ?? {}, stripEmptyApiKeys(patch));
    const parsed = this.#schema.safeParse(deepMerge(this.#defaults, nextStored));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError(issues[0]?.message ?? 'Configuracao invalida', {
        field: 'body',
        issues,
      });
    }

    await this.repository.upsert('ai', nextStored);
    this.#stored = { ...this.#stored, ai: nextStored };
    this.#version += 1;
    this.#cache = null;
    await this.#apply();

    this.logger.info({ version: this.#version }, 'configuracao em runtime salva e aplicada');
    return this.view();
  }

  /** Registra o que precisa ser refeito quando a config muda (ex.: reagendar). */
  onApply(apply: () => void | Promise<void>): void {
    this.#appliers.push(apply);
  }

  async #apply(): Promise<void> {
    for (const apply of this.#appliers) {
      try {
        await apply();
      } catch (error) {
        this.logger.error({ err: error }, 'aplicador de configuracao falhou (o valor ja esta salvo)');
      }
    }
  }

  #effective(): AiSettings {
    return deepMerge(this.#defaults, this.#stored.ai);
  }
}
