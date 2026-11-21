export function formatRequestNumber(year: number, sequence: number | bigint): string {
  return `PR-${year}-${String(sequence).padStart(6, '0')}`;
}

export const REQUEST_NUMBER_PATTERN = /^PR-\d{4}-\d{6,}$/;
