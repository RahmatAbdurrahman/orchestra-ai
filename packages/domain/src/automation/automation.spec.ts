import {
  buildAttemptReference,
  buildIdempotencyKey,
  computeBackoffMs,
  computePollDelayMs,
  QueueJobId,
} from './idempotency';
import { validateRobotOutput } from './robot-contract';
import { classifyRobotFault, isTerminalRobotState, normalizeUiPathJobState } from './uipath-state';

describe('idempotency helpers', () => {
  it('derives a stable idempotency key per purchase request', () => {
    const id = '0b6f7a3e-6a55-4d0b-8a8f-2f1d2c3b4a5e';
    expect(buildIdempotencyKey(id)).toBe(buildIdempotencyKey(id));
    expect(buildIdempotencyKey(id)).not.toBe(buildIdempotencyKey('another-id'));
  });

  it('derives a unique UiPath reference per attempt', () => {
    expect(buildAttemptReference('job', 1)).toBe('oa-job-1');
    expect(buildAttemptReference('job', 2)).not.toBe(buildAttemptReference('job', 1));
    expect(() => buildAttemptReference('job', 0)).toThrow(RangeError);
  });

  it('builds queue job ids without colons', () => {
    expect(QueueJobId.automationSubmit('abc', 1)).not.toContain(':');
    expect(QueueJobId.documentProcessing('abc', 2)).toBe('doc-abc-2');
    expect(QueueJobId.automationPoll('abc', 1, 3)).toBe('poll-abc-1-3');
  });

  it('caps exponential backoff', () => {
    expect(computeBackoffMs(1, 1000, 10_000)).toBe(1000);
    expect(computeBackoffMs(3, 1000, 10_000)).toBe(4000);
    expect(computeBackoffMs(10, 1000, 10_000)).toBe(10_000);
    expect(computePollDelayMs(1)).toBe(3000);
    expect(computePollDelayMs(50)).toBe(30_000);
  });
});

describe('UiPath status normalization', () => {
  it.each([
    ['Pending', 'PENDING'],
    ['Resumed', 'PENDING'],
    ['Running', 'RUNNING'],
    ['Stopping', 'RUNNING'],
    ['Terminating', 'RUNNING'],
    ['Suspended', 'RUNNING'],
    ['Successful', 'SUCCESSFUL'],
    ['Faulted', 'FAULTED'],
    ['Stopped', 'STOPPED'],
    ['something-else', 'UNKNOWN'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeUiPathJobState(input)).toBe(expected);
  });

  it('supports numeric states and missing values', () => {
    expect(normalizeUiPathJobState(0)).toBe('PENDING');
    expect(normalizeUiPathJobState(5)).toBe('SUCCESSFUL');
    expect(normalizeUiPathJobState(4)).toBe('FAULTED');
    expect(normalizeUiPathJobState(undefined)).toBe('UNKNOWN');
    expect(isTerminalRobotState('SUCCESSFUL')).toBe(true);
    expect(isTerminalRobotState('RUNNING')).toBe(false);
  });

  it('classifies business exceptions as non-retryable', () => {
    expect(classifyRobotFault({ info: 'BusinessRuleException: supplier blocked in ERP' })).toMatchObject({
      code: 'BUSINESS_EXCEPTION',
      retryable: false,
    });
    expect(classifyRobotFault({ jobError: { category: 'Business', title: 'Invalid' } }).retryable).toBe(false);
    expect(classifyRobotFault({ info: 'Selector not found: Create PO button' })).toMatchObject({
      code: 'SYSTEM_EXCEPTION',
      retryable: true,
    });
  });
});

describe('robot output validation', () => {
  const key = 'oa-po-123';

  it('accepts a created purchase order', () => {
    const result = validateRobotOutput(
      JSON.stringify({ out_Status: 'CREATED', out_PoNumber: 'PO-2026-000001', out_IdempotencyKey: key }),
      key,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts an already existing purchase order (duplicate prevented by the ERP)', () => {
    const result = validateRobotOutput(
      { out_Status: 'ALREADY_EXISTS', out_PoNumber: 'PO-2026-000001', out_IdempotencyKey: key },
      key,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects malformed output', () => {
    expect(validateRobotOutput('not-json', key).ok).toBe(false);
    expect(validateRobotOutput({ out_Status: 'CREATED', out_IdempotencyKey: key }, key).ok).toBe(false);
    expect(
      validateRobotOutput({ out_Status: 'CREATED', out_PoNumber: 'PO-1', out_IdempotencyKey: key }, key).ok,
    ).toBe(false);
  });

  it('rejects output that belongs to another request', () => {
    const result = validateRobotOutput(
      { out_Status: 'CREATED', out_PoNumber: 'PO-2026-000001', out_IdempotencyKey: 'oa-po-other' },
      key,
    );
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('idempotency key') });
  });

  it('accepts a business error without a PO number', () => {
    const result = validateRobotOutput(
      { out_Status: 'BUSINESS_ERROR', out_IdempotencyKey: key, out_Message: 'Supplier blocked' },
      key,
    );
    expect(result.ok).toBe(true);
  });
});
