import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/errors.js';
import type { CategoryRecord, CategoriesRepository } from '../categories/categories.repository.js';
import { SourcesImportService } from './sources.import.service.js';
import type { SourceRecord, SourceInput, SourcePatch } from './sources.types.js';
import type { SourcesRepository } from './sources.repository.js';

const makeSource = (overrides: Partial<SourceRecord> = {}): SourceRecord => ({
  id: 's-1',
  slug: 'g1',
  name: 'G1 Globo',
  feedUrl: 'https://g1.globo.com/rss/g1/',
  siteUrl: 'https://g1.globo.com',
  defaultCategoryId: null,
  enabled: true,
  etag: null,
  lastModified: null,
  lastFetchedAt: null,
  lastStatus: null,
  lastError: null,
  category: null,
  createdAt: new Date(),
  ...overrides,
});

const makeCategory = (overrides: Partial<CategoryRecord> = {}): CategoryRecord => ({
  id: 'cat-tech',
  slug: 'tecnologia',
  name: 'Tecnologia',
  description: null,
  color: null,
  articleCount: 0,
  createdAt: new Date(),
  ...overrides,
});

/** Repositorio em memoria com a mesma semantica do Pg: slug unico com ConflictError. */
class FakeSources implements SourcesRepository {
  rows: SourceRecord[] = [];
  created: SourceInput[] = [];

  async list(): Promise<SourceRecord[]> {
    return this.rows;
  }
  async listEnabled(): Promise<SourceRecord[]> {
    return this.rows.filter((s) => s.enabled);
  }
  async findById(id: string): Promise<SourceRecord | null> {
    return this.rows.find((s) => s.id === id) ?? null;
  }
  async findBySlug(slug: string): Promise<SourceRecord | null> {
    return this.rows.find((s) => s.slug === slug) ?? null;
  }
  async create(input: SourceInput): Promise<SourceRecord> {
    if (this.rows.some((s) => s.slug === input.slug)) {
      throw new ConflictError('Ja existe uma fonte com esse slug');
    }
    this.created.push(input);
    const record = makeSource({
      id: `s-${this.rows.length + 1}`,
      slug: input.slug,
      name: input.name,
      feedUrl: input.feedUrl,
      siteUrl: input.siteUrl ?? null,
      defaultCategoryId: input.defaultCategoryId ?? null,
      enabled: input.enabled ?? true,
    });
    this.rows.push(record);
    return record;
  }
  async update(id: string, patch: SourcePatch): Promise<SourceRecord | null> {
    return this.rows.find((s) => s.id === id) ?? null;
  }
  async remove(id: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((s) => s.id !== id);
    return this.rows.length < before;
  }
  async markFetched(): Promise<void> {}
}

class FakeCategories implements CategoriesRepository {
  rows: CategoryRecord[] = [];
  async list(): Promise<CategoryRecord[]> {
    return this.rows;
  }
  async findById(id: string): Promise<CategoryRecord | null> {
    return this.rows.find((c) => c.id === id) ?? null;
  }
  async findBySlug(slug: string): Promise<CategoryRecord | null> {
    return this.rows.find((c) => c.slug === slug) ?? null;
  }
  async create(): Promise<CategoryRecord> {
    throw new Error('nao usado neste teste');
  }
  async update(): Promise<CategoryRecord | null> {
    return null;
  }
  async remove(): Promise<boolean> {
    return false;
  }
  async listRules(): Promise<{ id: string; categoryId: string; keyword: string; createdAt: Date }[]> {
    return [];
  }
  async addRule(): Promise<{ id: string; categoryId: string; keyword: string; createdAt: Date }> {
    throw new Error('nao usado neste teste');
  }
  async removeRule(): Promise<boolean> {
    return false;
  }
}

const setup = () => {
  const sources = new FakeSources();
  const categories = new FakeCategories();
  categories.rows.push(makeCategory());
  const service = new SourcesImportService(sources, categories);
  return { sources, categories, service };
};

describe('SourcesImportService', () => {
  it('cadastra fontes novas e resolve a categoria pelo slug', async () => {
    const { sources, service } = setup();

    const report = await service.importSources([
      { name: 'G1 Globo', feedUrl: 'https://g1.globo.com/rss/g1/', siteUrl: null, categorySlug: 'tecnologia', enabled: true },
      { name: 'NASA', feedUrl: 'https://www.nasa.gov/feed/', siteUrl: 'https://nasa.gov', categorySlug: null, enabled: false },
    ]);

    expect(report.imported).toBe(2);
    expect(report.skipped).toEqual([]);
    expect(sources.rows[0]).toMatchObject({ slug: 'g1-globo', defaultCategoryId: 'cat-tech' });
    expect(sources.rows[1]).toMatchObject({ slug: 'nasa', defaultCategoryId: null, enabled: false });
  });

  it('ignora feed ja cadastrado, mesmo com host/case/barra diferentes', async () => {
    const { sources, service } = setup();
    sources.rows.push(makeSource({ id: 's0', slug: 'g1', feedUrl: 'https://G1.GLOBO.com/rss/g1/' }));

    const report = await service.importSources([
      { name: 'G1 de novo', feedUrl: 'https://g1.globo.com/rss/g1', siteUrl: null, categorySlug: null, enabled: true },
    ]);

    expect(report).toMatchObject({ imported: 0 });
    expect(report.skipped[0]!.reason).toBe('feed ja cadastrado');
  });

  it('nao duplica dentro do proprio arquivo', async () => {
    const { service } = setup();
    const report = await service.importSources([
      { name: 'CSS Tricks', feedUrl: 'https://css-tricks.com/feed/', siteUrl: null, categorySlug: null, enabled: true },
      { name: 'CSS Tricks 2', feedUrl: 'https://css-tricks.com/feed', siteUrl: null, categorySlug: null, enabled: true },
    ]);
    expect(report).toMatchObject({ imported: 1 });
    expect(report.skipped).toHaveLength(1);
  });

  it('gera slugs unicos para nomes repetidos (g1, g1-2, g1-3)', async () => {
    const { sources, service } = setup();
    const report = await service.importSources([
      { name: 'G1 Globo', feedUrl: 'https://g1.globo.com/rss/g1/', siteUrl: null, categorySlug: null, enabled: true },
      { name: 'G1 Globo', feedUrl: 'https://g1.globo.com/rss/g1/tecnologia/', siteUrl: null, categorySlug: null, enabled: true },
    ]);
    expect(report.skipped).toEqual([]);
    expect(sources.rows.map((s) => s.slug)).toEqual(['g1-globo', 'g1-globo-2']);
  });

  it('pula feed com URL invalida', async () => {
    const { service } = setup();
    const report = await service.importSources([
      { name: 'Quebrado', feedUrl: 'nao-e-url', siteUrl: null, categorySlug: null, enabled: true },
    ]);
    expect(report).toMatchObject({ imported: 0 });
    expect(report.skipped[0]!.reason).toBe('URL invalida');
  });

  it('descarta site invalido mas mantem feed valido', async () => {
    const { sources, service } = setup();
    await service.importSources([
      { name: 'Ok', feedUrl: 'https://ok.com/rss', siteUrl: 'not-a-url', categorySlug: null, enabled: true },
    ]);
    expect(sources.created[0]!.siteUrl).toBeNull();
  });

  it('conflito de slug com banco na corrida vira skipped, nao erro', async () => {
    const { sources, service } = setup();
    sources.create = async () => {
      throw new ConflictError('Ja existe uma fonte com esse slug');
    };

    const report = await service.importSources([
      { name: 'Qualquer', feedUrl: 'https://qualquer.com/feed', siteUrl: null, categorySlug: null, enabled: true },
    ]);
    expect(report).toMatchObject({ imported: 0 });
    expect(report.skipped[0]!.reason).toBe('slugs em conflito');
  });

  it('lista vazia nao toca o banco', async () => {
    const { sources, service } = setup();
    const report = await service.importSources([]);
    expect(report).toEqual({ imported: 0, skipped: [] });
    expect(sources.rows).toEqual([]);
  });
});