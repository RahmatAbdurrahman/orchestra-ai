import { amountsDiffer, computeLineTotal, computeTotals, roundMoney } from './money';
import { formatRequestNumber, REQUEST_NUMBER_PATTERN } from './requests/request-number';
import { findBestSupplierMatch, normalizeSupplierName, supplierNameSimilarity } from './suppliers/matching';
import {
  DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION,
  safeParseWorkflowConfiguration,
} from './workflow/configuration';

describe('money', () => {
  it('rounds to two decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(computeLineTotal(3, 0.1)).toBe(0.3);
    expect(computeTotals([{ quantity: 2, unitPrice: 1250.5 }], 275.11)).toEqual({
      subtotal: 2501,
      taxAmount: 275.11,
      total: 2776.11,
    });
  });

  it('compares amounts with a relative tolerance', () => {
    expect(amountsDiffer(100, 100.5, 0.01)).toBe(false);
    expect(amountsDiffer(100, 102, 0.01)).toBe(true);
  });
});

describe('request numbers', () => {
  it('formats sequential request numbers', () => {
    expect(formatRequestNumber(2026, 42)).toBe('PR-2026-000042');
    expect(REQUEST_NUMBER_PATTERN.test(formatRequestNumber(2026, 1))).toBe(true);
  });
});

describe('supplier matching', () => {
  it('normalizes legal forms and punctuation', () => {
    expect(normalizeSupplierName('PT. Sinar Jaya Abadi')).toBe('SINAR JAYA ABADI');
    expect(normalizeSupplierName('Sinar Jaya Abadi, PT')).toBe('SINAR JAYA ABADI');
    expect(normalizeSupplierName('CV Maju Bersama')).toBe('MAJU BERSAMA');
  });

  it('tolerates OCR typos when matching', () => {
    expect(supplierNameSimilarity('PT Sinar Jaya Abadi', 'PT. SINAR JAYA ABAD1')).toBeGreaterThan(0.85);
    const match = findBestSupplierMatch('Sinar Jaya Abadl', [
      { id: '1', name: 'PT Sinar Jaya Abadi' },
      { id: '2', name: 'CV Maju Bersama' },
    ]);
    expect(match?.supplier.id).toBe('1');
    expect(findBestSupplierMatch('Completely Different Co', [{ id: '1', name: 'PT Sinar Jaya Abadi' }])).toBeNull();
  });
});

describe('workflow configuration schema', () => {
  it('accepts the default template', () => {
    expect(safeParseWorkflowConfiguration(DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION).success).toBe(true);
  });

  it('rejects thresholds that are not ascending or not open ended', () => {
    const invalid = {
      ...DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION,
      approval: {
        requireDistinctApprovers: true,
        thresholds: [
          { maxAmount: 10_000_000, groups: ['DEPARTMENT'] },
          { maxAmount: 5_000_000, groups: ['DEPARTMENT', 'FINANCE'] },
        ],
      },
    };
    const result = safeParseWorkflowConfiguration(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects an automatic retry budget larger than the total budget', () => {
    const invalid = {
      ...DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION,
      automation: { ...DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION.automation, maxAutoAttempts: 5, maxTotalAttempts: 2 },
    };
    expect(safeParseWorkflowConfiguration(invalid).success).toBe(false);
  });
});
