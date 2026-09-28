/** Deteccao de violacoes de constraint do Postgres (código 23505 = unique). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function uniqueViolationTarget(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? ((error as { constraint?: string }).constraint ?? (error as { detail?: string }).detail)
    : undefined;
}
