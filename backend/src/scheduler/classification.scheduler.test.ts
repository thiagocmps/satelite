import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../config/logger.js';
import type { Container } from '../container.js';
import type { ClassificationReport } from '../modules/classification/classification.service.js';
import { startClassificationScheduler } from './classification.scheduler.js';

const { scheduleMock, validateMock } = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  validateMock: vi.fn<(expression: string) => boolean>(() => true),
}));

vi.mock('node-cron', () => ({
  default: {
    validate: (expression: string) => validateMock(expression),
    schedule: (...args: unknown[]) => scheduleMock(...args),
  },
}));

const emptyReport: ClassificationReport = {
  processed: 0,
  resolvedKeyword: 0,
  resolvedShort: 0,
  blocked: 0,
  aiCalls: 0,
  aiAssigned: 0,
  errors: 0,
  pending: 0,
};

type RunOnce = () => Promise<ClassificationReport>;

function makeContainer(
  overrides: Partial<{
    classify: Record<string, unknown>;
    scheduler: Record<string, unknown>;
    isRunning: boolean;
    runOnce: RunOnce;
  }> = {},
) {
  const runOnce = vi.fn<RunOnce>(overrides.runOnce ?? (async () => ({ ...emptyReport, processed: 3, aiCalls: 1 })));
  const container = {
    // o agendador le a config EM RUNTIME: gates e cron vem do settings.ai()
    settings: {
      ai: () => ({
        classify: { enabled: true, ...overrides.classify },
        scheduler: { classifyEnabled: true, classifyCron: '*/10 * * * *', ...overrides.scheduler },
      }),
    },
    classification: { isRunning: overrides.isRunning ?? false, runOnce },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  return { container: container as unknown as Container, logger, runOnce };
}

/** Dispara o handler agendado pelo cron (registrado via schedule). */
async function tick(): Promise<void> {
  const handler = scheduleMock.mock.calls[0]?.[1] as () => Promise<void>;
  await handler();
}

beforeEach(() => {
  scheduleMock.mockClear();
  validateMock.mockClear();
  validateMock.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startClassificationScheduler', () => {
  it('agenda no cron da config e roda runOnce a cada tick', async () => {
    const { container, logger, runOnce } = makeContainer();

    startClassificationScheduler(container, logger);

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0]?.[0]).toBe('*/10 * * * *');

    await tick();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 3, aiCalls: 1 }),
      'ciclo de classificacao finalizado',
    );
  });

  it('fila vazia (report zerado) roda sem logar resumo', async () => {
    const { container, logger, runOnce } = makeContainer({ runOnce: async () => ({ ...emptyReport }) });

    startClassificationScheduler(container, logger);
    await tick();

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), 'ciclo de classificacao finalizado');
  });

  it('ignora o tick quando ja ha classificacao em andamento', async () => {
    const { container, logger, runOnce } = makeContainer({ isRunning: true });

    startClassificationScheduler(container, logger);
    await tick();

    expect(runOnce).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('classificacao anterior ainda em andamento; ciclo ignorado');
  });

  it('erro do runOnce vira log de erro (o agendador nao derruba o processo)', async () => {
    const { container, logger } = makeContainer({
      runOnce: async () => {
        throw new Error('boom');
      },
    });

    startClassificationScheduler(container, logger);
    await tick();

    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'ciclo de classificacao falhou');
  });

  it('agendador desligado na config (scheduler.classifyEnabled=false) nao agenda', () => {
    const { container, logger } = makeContainer({ scheduler: { classifyEnabled: false } });

    expect(startClassificationScheduler(container, logger)).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('classificacao por IA desligada na config (classify.enabled=false) tambem desliga', () => {
    const { container, logger } = makeContainer({ classify: { enabled: false } });

    expect(startClassificationScheduler(container, logger)).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('recusa expressao cron invalida vinda da config', () => {
    validateMock.mockReturnValue(false);
    const { container, logger } = makeContainer({ scheduler: { classifyCron: 'vadia' } });

    expect(() => startClassificationScheduler(container, logger)).toThrow(/CLASSIFY_CRON invalido/);
  });
});
