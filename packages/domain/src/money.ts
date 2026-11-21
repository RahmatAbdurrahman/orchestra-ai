/**
 * Money helpers. Calculations are done in minor units (cents) to avoid
 * floating point drift; values are exposed in major units with 2 decimals.
 */
export function toMinorUnits(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

export function roundMoney(amount: number): number {
  return fromMinorUnits(toMinorUnits(amount));
}

export function computeLineTotal(quantity: number, unitPrice: number): number {
  return fromMinorUnits(Math.round(quantity * toMinorUnits(unitPrice)));
}

export interface LineAmountInput {
  quantity: number;
  unitPrice: number;
}

export interface ComputedTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

export function computeTotals(items: readonly LineAmountInput[], taxAmount = 0): ComputedTotals {
  const subtotalMinor = items.reduce(
    (sum, item) => sum + toMinorUnits(computeLineTotal(item.quantity, item.unitPrice)),
    0,
  );
  const taxMinor = toMinorUnits(taxAmount);
  return {
    subtotal: fromMinorUnits(subtotalMinor),
    taxAmount: fromMinorUnits(taxMinor),
    total: fromMinorUnits(subtotalMinor + taxMinor),
  };
}

/** True when two amounts differ by more than the relative tolerance (e.g. 0.01 = 1%). */
export function amountsDiffer(a: number, b: number, relativeTolerance: number): boolean {
  const diff = Math.abs(toMinorUnits(a) - toMinorUnits(b));
  const base = Math.max(Math.abs(toMinorUnits(a)), Math.abs(toMinorUnits(b)), 1);
  return diff / base > relativeTolerance;
}
