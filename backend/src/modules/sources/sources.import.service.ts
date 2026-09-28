import { ConflictError } from '../../core/errors.js';
import { canonicalizeUrl } from '../../core/fingerprint.js';
import { slugify } from '../../core/slug.js';
import type { CategoriesRepository } from '../categories/categories.repository.js';
import type { ImportCandidate } from './sources.import.js';
import type { SourcesRepository } from './sources.repository.js';

export type SkippedSource = { name: string; feedUrl: string; reason: string };

export type ImportReport = {
  imported: number;
  skipped: SkippedSource[];
};

/**
 * Import aditivo de fontes: nunca altera as existentes, apenas cadastra as
 * novas. Deduplica por URL canonica (host minusculo, sem barra final e sem
 * fragmento) contra o banco e dentro do proprio arquivo; slugs novos nao
 * colidem com os existentes. Conflito na corrida com o banco vira "skipped",
 * nunca um erro da request.
 */
export class SourcesImportService {
  constructor(
    private readonly sources: SourcesRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  async importSources(candidates: ImportCandidate[]): Promise<ImportReport> {
    const skipped: SkippedSource[] = [];
    if (candidates.length === 0) return { imported: 0, skipped };

    const [existing, categories] = await Promise.all([this.sources.list(), this.categories.list()]);
    const takenSlugs = new Set(existing.map((s) => s.slug));
    const takenUrls = new Set(existing.map((s) => canonicalizeUrl(s.feedUrl)));
    // A categoria pode vir como slug (`tecnologia`) ou como NOME — que e o que o
    // nosso export OPML (e a maioria dos leitores) grava no atributo `category`
    // (`category="Astronomia e Espaço"`). Nomes sao unicos no banco, entao a
    // comparacao normalizada (`slugify`) e deterministica.
    const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));
    const categoryIdByName = new Map(categories.map((c) => [slugify(c.name), c.id]));

    let imported = 0;
    const fileUrls = new Set<string>(); // dedup dentro do proprio arquivo (URL canonica)

    for (const candidate of candidates) {
      const urlKey = this.safeUrlKey(candidate.feedUrl);
      if (!urlKey) {
        skipped.push({ name: candidate.name, feedUrl: candidate.feedUrl, reason: 'URL invalida' });
        continue;
      }
      if (takenUrls.has(urlKey) || fileUrls.has(urlKey)) {
        skipped.push({ name: candidate.name, feedUrl: candidate.feedUrl, reason: 'feed ja cadastrado' });
        continue;
      }

      const slug = uniqueSlug(slugify(candidate.name), takenSlugs);
      const categoryId = candidate.categorySlug
        ? (categoryIdBySlug.get(candidate.categorySlug) ??
          categoryIdByName.get(slugify(candidate.categorySlug)) ??
          null)
        : null;

      try {
        await this.sources.create({
          slug,
          name: candidate.name,
          feedUrl: candidate.feedUrl,
          siteUrl: this.safeSiteUrl(candidate.siteUrl),
          defaultCategoryId: categoryId,
          enabled: candidate.enabled,
        });
      } catch (error) {
        if (error instanceof ConflictError) {
          // corrida: outra request criou o slug entre nossa listagem e o insert
          skipped.push({ name: candidate.name, feedUrl: candidate.feedUrl, reason: 'slugs em conflito' });
          continue;
        }
        throw error;
      }

      takenUrls.add(urlKey);
      fileUrls.add(urlKey);
      imported += 1;
    }

    return { imported, skipped };
  }

  /** URL canonica para dedup; null quando nao e uma URL valida. */
  private safeUrlKey(rawUrl: string): string | null {
    try {
      return canonicalizeUrl(rawUrl);
    } catch {
      return null;
    }
  }

  /** Site da fonte: validado como URL, senao descartado. */
  private safeSiteUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      return new URL(value).toString();
    } catch {
      return null;
    }
  }
}

/** Slug base + sufixo `-n` quando colidir com os ja usados nesta importacao. */
function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base.slice(0, 57);
  let slug = root;
  for (let n = 2; taken.has(slug); n += 1) {
    slug = `${root}-${n}`;
  }
  taken.add(slug);
  return slug;
}