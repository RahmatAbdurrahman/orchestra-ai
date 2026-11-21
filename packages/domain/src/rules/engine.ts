import type { ApprovalGroup } from '../enums';
import { amountsDiffer, computeTotals, roundMoney } from '../money';
import type { ApprovalPolicy, RuleEngineConfig } from '../workflow/configuration';

export type RuleSeverity = 'ERROR' | 'WARNING';

export const RuleId = Object.freeze({
  COMPLETENESS: 'REQ-COMPLETENESS',
  CURRENCY_SUPPORTED: 'REQ-CURRENCY-SUPPORTED',
  LINE_ITEM_LIMIT: 'REQ-LINE-ITEM-LIMIT',
  QUANTITY: 'REQ-QUANTITY',
  UNIT_PRICE: 'REQ-UNIT-PRICE',
  AMOUNT_RANGE: 'REQ-AMOUNT-RANGE',
  SUPPLIER_VALID: 'REQ-SUPPLIER-VALID',
  BUDGET: 'REQ-BUDGET',
  DUPLICATE_DOCUMENT: 'REQ-DUPLICATE-DOCUMENT',
  DUPLICATE_SIMILAR: 'REQ-DUPLICATE-SIMILAR',
  REQUIRED_DATE: 'REQ-REQUIRED-DATE',
  DOCUMENT_TOTAL_MATCH: 'REQ-DOCUMENT-TOTAL-MATCH',
} as const);
export type RuleId = (typeof RuleId)[keyof typeof RuleId];

export interface RuleFinding {
  ruleId: RuleId;
  severity: RuleSeverity;
  message: string;
  field?: string;
}

export interface RuleLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface RuleRequestInput {
  supplierId: string | null;
  supplierName: string | null;
  documentNumber: string | null;
  currency: string | null;
  /** ISO date (YYYY-MM-DD). */
  requiredDate: string | null;
  items: readonly RuleLineItemInput[];
  taxAmount: number;
  /** Total read from the supporting document, used as a cross-check. */
  extractedTotal?: number | null;
}

export interface RuleLookups {
  supplier: { id: string; name: string; isActive: boolean } | null;
  department: {
    id: string;
    name: string;
    /** Monthly budget in base currency; null = unlimited. */
    monthlyBudget: number | null;
    /** Amount already committed this period in base currency (excluding this request). */
    committedAmount: number;
  };
  /** Other active requests that reference the same supplier document number. */
  duplicateDocumentRequests: ReadonlyArray<{ id: string; requestNumber: string }>;
  /** Other recent requests with the same requester, supplier and total. */
  similarRecentRequests: ReadonlyArray<{ id: string; requestNumber: string }>;
}

export interface RuleEvaluationResult {
  passed: boolean;
  evaluatedAt: string;
  findings: RuleFinding[];
  totals: {
    subtotal: number;
    taxAmount: number;
    total: number;
    currency: string | null;
    /** Total converted to the base currency; null when the currency is unsupported. */
    totalInBase: number | null;
    baseCurrency: string;
  };
  approvalRoute: ApprovalGroup[];
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Picks the approval groups for an amount (in base currency).
 * Thresholds are evaluated in ascending order; the first one whose upper
 * bound is not exceeded wins. Example (default configuration):
 *   total <= 5,000,000  -> [DEPARTMENT]
 *   total  > 5,000,000  -> [DEPARTMENT, FINANCE]
 */
export function determineApprovalRoute(amountInBase: number, policy: ApprovalPolicy): ApprovalGroup[] {
  for (const threshold of policy.thresholds) {
    if (threshold.maxAmount === null || amountInBase <= threshold.maxAmount) {
      return [...threshold.groups];
    }
  }
  const last = policy.thresholds[policy.thresholds.length - 1];
  return last ? [...last.groups] : [];
}

export function convertToBase(
  amount: number,
  currency: string | null,
  config: RuleEngineConfig,
): number | null {
  if (!currency) return null;
  const rate = config.fxRatesToBase[currency.toUpperCase()];
  if (rate === undefined) return null;
  return roundMoney(amount * rate);
}

/**
 * Evaluates the configured business rules for a purchase request.
 * ERROR findings block the request from entering approval; WARNING findings
 * are shown to the approver but do not block.
 */
export function evaluatePurchaseRequestRules(
  input: RuleRequestInput,
  lookups: RuleLookups,
  config: RuleEngineConfig,
  approvalPolicy: ApprovalPolicy,
  now: Date = new Date(),
): RuleEvaluationResult {
  const findings: RuleFinding[] = [];
  const error = (ruleId: RuleId, message: string, field?: string) =>
    findings.push({ ruleId, severity: 'ERROR', message, ...(field ? { field } : {}) });
  const warning = (ruleId: RuleId, message: string, field?: string) =>
    findings.push({ ruleId, severity: 'WARNING', message, ...(field ? { field } : {}) });

  // --- Completeness -------------------------------------------------------
  if (!input.supplierName?.trim() && !input.supplierId) {
    error(RuleId.COMPLETENESS, 'Supplier is required', 'supplier');
  }
  if (!input.currency) error(RuleId.COMPLETENESS, 'Currency is required', 'currency');
  if (!input.requiredDate) error(RuleId.COMPLETENESS, 'Required date is required', 'requiredDate');
  if (input.items.length === 0) error(RuleId.COMPLETENESS, 'At least one line item is required', 'items');
  input.items.forEach((item, index) => {
    if (!item.description?.trim()) {
      error(RuleId.COMPLETENESS, `Line ${index + 1}: description is required`, `items.${index}.description`);
    }
  });

  // --- Currency -------------------------------------------------------------
  const currency = input.currency ? input.currency.toUpperCase() : null;
  if (currency && config.fxRatesToBase[currency] === undefined) {
    error(
      RuleId.CURRENCY_SUPPORTED,
      `Currency ${currency} is not supported (supported: ${Object.keys(config.fxRatesToBase).join(', ')})`,
      'currency',
    );
  }

  // --- Line items -----------------------------------------------------------
  if (input.items.length > config.maxLineItems) {
    error(
      RuleId.LINE_ITEM_LIMIT,
      `A request may contain at most ${config.maxLineItems} line items`,
      'items',
    );
  }
  input.items.forEach((item, index) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      error(RuleId.QUANTITY, `Line ${index + 1}: quantity must be a whole number of at least 1`, `items.${index}.quantity`);
    } else if (item.quantity > config.maxQuantityPerItem) {
      error(
        RuleId.QUANTITY,
        `Line ${index + 1}: quantity exceeds the maximum of ${config.maxQuantityPerItem}`,
        `items.${index}.quantity`,
      );
    }
    if (!(item.unitPrice > 0)) {
      error(RuleId.UNIT_PRICE, `Line ${index + 1}: unit price must be greater than zero`, `items.${index}.unitPrice`);
    }
  });
  if (!(input.taxAmount >= 0)) {
    error(RuleId.COMPLETENESS, 'Tax amount cannot be negative', 'taxAmount');
  }

  // --- Totals & amount range ------------------------------------------------
  const totals = computeTotals(input.items, Math.max(0, input.taxAmount || 0));
  const totalInBase = convertToBase(totals.total, currency, config);
  if (totalInBase !== null) {
    if (totalInBase < config.minTransactionAmount) {
      error(
        RuleId.AMOUNT_RANGE,
        `Total is below the minimum transaction amount of ${config.minTransactionAmount.toLocaleString('en-US')} ${config.baseCurrency}`,
        'totalAmount',
      );
    }
    if (totalInBase > config.maxTransactionAmount) {
      error(
        RuleId.AMOUNT_RANGE,
        `Total exceeds the maximum transaction amount of ${config.maxTransactionAmount.toLocaleString('en-US')} ${config.baseCurrency}`,
        'totalAmount',
      );
    }
  }

  // --- Supplier validity ----------------------------------------------------
  if (config.requireRegisteredSupplier) {
    if (!lookups.supplier) {
      error(RuleId.SUPPLIER_VALID, 'Supplier is not registered in the supplier master data', 'supplier');
    } else if (!lookups.supplier.isActive) {
      error(RuleId.SUPPLIER_VALID, `Supplier ${lookups.supplier.name} is inactive`, 'supplier');
    }
  }

  // --- Budget ---------------------------------------------------------------
  const { department } = lookups;
  if (config.enforceDepartmentBudget && department.monthlyBudget !== null && totalInBase !== null) {
    const remaining = roundMoney(department.monthlyBudget - department.committedAmount);
    if (totalInBase > remaining) {
      error(
        RuleId.BUDGET,
        `Total exceeds the remaining ${department.name} budget for this month (${Math.max(remaining, 0).toLocaleString('en-US')} ${config.baseCurrency} remaining)`,
        'totalAmount',
      );
    }
  }

  // --- Duplicate detection --------------------------------------------------
  if (lookups.duplicateDocumentRequests.length > 0) {
    const numbers = lookups.duplicateDocumentRequests.map((request) => request.requestNumber).join(', ');
    error(
      RuleId.DUPLICATE_DOCUMENT,
      `Supplier document ${input.documentNumber ?? ''} is already used by ${numbers}`.replace('  ', ' '),
      'documentNumber',
    );
  }
  if (lookups.similarRecentRequests.length > 0) {
    const numbers = lookups.similarRecentRequests.map((request) => request.requestNumber).join(', ');
    warning(
      RuleId.DUPLICATE_SIMILAR,
      `Possible duplicate: ${numbers} has the same supplier and total within the last ${config.duplicateLookbackDays} days`,
    );
  }

  // --- Required date --------------------------------------------------------
  if (input.requiredDate) {
    const required = parseIsoDate(input.requiredDate);
    if (!required) {
      error(RuleId.REQUIRED_DATE, 'Required date is not a valid date', 'requiredDate');
    } else {
      const earliest = startOfUtcDay(now) + config.minLeadTimeDays * 86_400_000;
      if (required.getTime() < earliest) {
        error(
          RuleId.REQUIRED_DATE,
          config.minLeadTimeDays > 0
            ? `Required date must be at least ${config.minLeadTimeDays} day(s) from today`
            : 'Required date cannot be in the past',
          'requiredDate',
        );
      }
    }
  }

  // --- Cross-check with the supporting document ----------------------------
  if (
    input.extractedTotal !== undefined &&
    input.extractedTotal !== null &&
    amountsDiffer(input.extractedTotal, totals.total, config.amountTolerance)
  ) {
    warning(
      RuleId.DOCUMENT_TOTAL_MATCH,
      `Verified total (${totals.total.toLocaleString('en-US')}) differs from the document total (${input.extractedTotal.toLocaleString('en-US')})`,
      'totalAmount',
    );
  }

  const approvalRoute = totalInBase !== null ? determineApprovalRoute(totalInBase, approvalPolicy) : [];

  return {
    passed: !findings.some((finding) => finding.severity === 'ERROR'),
    evaluatedAt: now.toISOString(),
    findings,
    totals: {
      ...totals,
      currency,
      totalInBase,
      baseCurrency: config.baseCurrency,
    },
    approvalRoute,
  };
}
