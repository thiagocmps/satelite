/**
 * Slug para identidade estavel de uma fonte (regra das schemas:
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$`). Sem acentos, minusculo, hifens no lugar de
 * pontuacao, maximo de 60 caracteres.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'fonte';
}