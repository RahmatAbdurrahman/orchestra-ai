const LEGAL_FORM_TOKENS = new Set([
  'PT',
  'CV',
  'TBK',
  'UD',
  'PD',
  'PERSERO',
  'LTD',
  'INC',
  'CO',
  'CORP',
  'LLC',
  'GMBH',
]);

/**
 * Normalizes a supplier name for matching: upper case, punctuation removed,
 * legal-form tokens (PT, CV, Tbk, ...) dropped.
 * "PT. Sinar Jaya Abadi" and "Sinar Jaya Abadi, PT" both become "SINAR JAYA ABADI".
 */
export function normalizeSupplierName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 0 && !LEGAL_FORM_TOKENS.has(token))
    .join(' ')
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, ' ');
  const result = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

/** Dice coefficient on character bigrams of the normalized names (0..1). Tolerant to OCR typos. */
export function supplierNameSimilarity(a: string, b: string): number {
  const left = normalizeSupplierName(a);
  const right = normalizeSupplierName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let overlap = 0;
  let total = 0;
  for (const count of leftGrams.values()) total += count;
  for (const count of rightGrams.values()) total += count;
  for (const [gram, count] of leftGrams) {
    overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  return total === 0 ? 0 : (2 * overlap) / total;
}

export interface SupplierCandidate {
  id: string;
  name: string;
}

export function findBestSupplierMatch<T extends SupplierCandidate>(
  name: string,
  candidates: readonly T[],
  minimumScore = 0.82,
): { supplier: T; score: number } | null {
  let best: { supplier: T; score: number } | null = null;
  for (const supplier of candidates) {
    const score = supplierNameSimilarity(name, supplier.name);
    if (!best || score > best.score) best = { supplier, score };
  }
  return best && best.score >= minimumScore ? best : null;
}
