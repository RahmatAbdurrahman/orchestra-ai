import { DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION } from '../workflow/configuration';
import {
  determineApprovalRoute,
  evaluatePurchaseRequestRules,
  RuleId,
  type RuleLookups,
  type RuleRequestInput,
} from './engine';

const config = DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION;
const now = new Date('2026-11-16T08:00:00.000Z');

function baseInput(overrides: Partial<RuleRequestInput> = {}): RuleRequestInput {
  return {
    supplierId: 'sup-1',
    supplierName: 'PT Sinar Jaya Abadi',
    documentNumber: 'INV-001',
    currency: 'IDR',
    requiredDate: '2026-11-30',
    items: [{ description: 'Laptop stand', quantity: 2, unitPrice: 750_000 }],
    taxAmount: 0,
    ...overrides,
  };
}

function baseLookups(overrides: Partial<RuleLookups> = {}): RuleLookups {
  return {
    supplier: { id: 'sup-1', name: 'PT Sinar Jaya Abadi', isActive: true },
    department: { id: 'dep-1', name: 'Operations', monthlyBudget: 100_000_000, committedAmount: 0 },
    duplicateDocumentRequests: [],
    similarRecentRequests: [],
    ...overrides,
  };
}

function ruleIds(result: ReturnType<typeof evaluatePurchaseRequestRules>) {
  return result.findings.map((finding) => `${finding.severity}:${finding.ruleId}`);
}

describe('business rule engine', () => {
  it('passes a complete, valid request and routes it to the department approver', () => {
    const result = evaluatePurchaseRequestRules(baseInput(), baseLookups(), config.rules, config.approval, now);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.totals.total).toBe(1_500_000);
    expect(result.approvalRoute).toEqual(['DEPARTMENT']);
  });

  it('requires finance approval above 5,000,000', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({ items: [{ description: 'Workstation', quantity: 1, unitPrice: 5_000_000 }], taxAmount: 550_000 }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    expect(result.totals.total).toBe(5_550_000);
    expect(result.approvalRoute).toEqual(['DEPARTMENT', 'FINANCE']);
  });

  it('treats exactly 5,000,000 as department-only (inclusive threshold)', () => {
    expect(determineApprovalRoute(5_000_000, config.approval)).toEqual(['DEPARTMENT']);
    expect(determineApprovalRoute(5_000_000.01, config.approval)).toEqual(['DEPARTMENT', 'FINANCE']);
  });

  it('converts foreign currencies before applying thresholds', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({ currency: 'USD', items: [{ description: 'License', quantity: 1, unitPrice: 400 }] }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    expect(result.totals.totalInBase).toBe(6_400_000);
    expect(result.approvalRoute).toEqual(['DEPARTMENT', 'FINANCE']);
  });

  it('reports missing data as blocking errors', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({ supplierId: null, supplierName: null, currency: null, requiredDate: null, items: [] }),
      baseLookups({ supplier: null }),
      config.rules,
      config.approval,
      now,
    );
    expect(result.passed).toBe(false);
    expect(ruleIds(result)).toEqual(
      expect.arrayContaining(['ERROR:REQ-COMPLETENESS', 'ERROR:REQ-SUPPLIER-VALID']),
    );
  });

  it('rejects unsupported currencies, invalid quantities and non-positive prices', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({
        currency: 'EUR',
        items: [
          { description: 'A', quantity: 0, unitPrice: 10 },
          { description: 'B', quantity: 1.5, unitPrice: 10 },
          { description: 'C', quantity: 20_000, unitPrice: 10 },
          { description: 'D', quantity: 1, unitPrice: 0 },
        ],
      }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    const quantityErrors = result.findings.filter((finding) => finding.ruleId === RuleId.QUANTITY);
    expect(quantityErrors).toHaveLength(3);
    expect(ruleIds(result)).toEqual(
      expect.arrayContaining(['ERROR:REQ-CURRENCY-SUPPORTED', 'ERROR:REQ-UNIT-PRICE']),
    );
    expect(result.approvalRoute).toEqual([]);
  });

  it('enforces the configured transaction range', () => {
    const tooSmall = evaluatePurchaseRequestRules(
      baseInput({ items: [{ description: 'Pen', quantity: 1, unitPrice: 5_000 }] }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    expect(ruleIds(tooSmall)).toContain('ERROR:REQ-AMOUNT-RANGE');
  });

  it('rejects inactive or unregistered suppliers', () => {
    const inactive = evaluatePurchaseRequestRules(
      baseInput(),
      baseLookups({ supplier: { id: 'sup-1', name: 'PT Sinar Jaya Abadi', isActive: false } }),
      config.rules,
      config.approval,
      now,
    );
    expect(ruleIds(inactive)).toContain('ERROR:REQ-SUPPLIER-VALID');
  });

  it('blocks requests that exceed the remaining department budget', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput(),
      baseLookups({
        department: { id: 'dep-1', name: 'Operations', monthlyBudget: 10_000_000, committedAmount: 9_000_000 },
      }),
      config.rules,
      config.approval,
      now,
    );
    expect(ruleIds(result)).toContain('ERROR:REQ-BUDGET');
  });

  it('ignores the budget when the department has no budget configured', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput(),
      baseLookups({ department: { id: 'dep-1', name: 'Operations', monthlyBudget: null, committedAmount: 0 } }),
      config.rules,
      config.approval,
      now,
    );
    expect(result.passed).toBe(true);
  });

  it('blocks duplicate supplier documents and warns about similar requests', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput(),
      baseLookups({
        duplicateDocumentRequests: [{ id: 'pr-0', requestNumber: 'PR-2026-000001' }],
        similarRecentRequests: [{ id: 'pr-9', requestNumber: 'PR-2026-000009' }],
      }),
      config.rules,
      config.approval,
      now,
    );
    expect(ruleIds(result)).toEqual(
      expect.arrayContaining(['ERROR:REQ-DUPLICATE-DOCUMENT', 'WARNING:REQ-DUPLICATE-SIMILAR']),
    );
    expect(result.passed).toBe(false);
  });

  it('rejects required dates in the past', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({ requiredDate: '2026-11-15' }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    expect(ruleIds(result)).toContain('ERROR:REQ-REQUIRED-DATE');
  });

  it('warns (but does not block) when the verified total differs from the document', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({ extractedTotal: 1_650_000 }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    expect(result.passed).toBe(true);
    expect(ruleIds(result)).toEqual(['WARNING:REQ-DOCUMENT-TOTAL-MATCH']);
  });

  it('computes money totals without floating point drift', () => {
    const result = evaluatePurchaseRequestRules(
      baseInput({
        items: [
          { description: 'A', quantity: 3, unitPrice: 33_333.33 },
          { description: 'B', quantity: 1, unitPrice: 0.1 },
        ],
        taxAmount: 0.2,
      }),
      baseLookups(),
      config.rules,
      config.approval,
      now,
    );
    expect(result.totals.subtotal).toBe(100_000.09);
    expect(result.totals.total).toBe(100_000.29);
  });
});
