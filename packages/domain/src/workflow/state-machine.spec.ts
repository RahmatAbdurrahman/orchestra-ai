import { PURCHASE_REQUEST_STATUSES } from '../enums';
import { InvalidTransitionError, isDomainError } from '../errors';
import {
  assertAutomationJobTransition,
  assertPurchaseRequestTransition,
  canTransitionAutomationJob,
  canTransitionPurchaseRequest,
  PURCHASE_REQUEST_TRANSITIONS,
  purchaseRequestStatusForJob,
  purchaseRequestTransitionPath,
} from './state-machine';

describe('purchase request state machine', () => {
  it('defines transitions for every status', () => {
    for (const status of PURCHASE_REQUEST_STATUSES) {
      expect(PURCHASE_REQUEST_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('follows the main happy path from the SAD', () => {
    const path = [
      'DRAFT',
      'SUBMITTED',
      'PROCESSING_DOCUMENT',
      'NEEDS_VERIFICATION',
      'PENDING_APPROVAL',
      'APPROVED',
      'QUEUED',
      'RUNNING',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransitionPurchaseRequest(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('never lets a rejected request be executed', () => {
    expect(PURCHASE_REQUEST_TRANSITIONS.REJECTED).toEqual([]);
    expect(canTransitionPurchaseRequest('REJECTED', 'QUEUED')).toBe(false);
    expect(canTransitionPurchaseRequest('REJECTED', 'APPROVED')).toBe(false);
  });

  it('does not allow a completed request to be retried', () => {
    expect(canTransitionPurchaseRequest('COMPLETED', 'QUEUED')).toBe(false);
  });

  it('only allows FAILED -> QUEUED as the retry edge', () => {
    expect(canTransitionPurchaseRequest('FAILED', 'QUEUED')).toBe(true);
    expect(canTransitionPurchaseRequest('RUNNING', 'QUEUED')).toBe(false);
  });

  it('does not allow approval to be skipped', () => {
    expect(canTransitionPurchaseRequest('NEEDS_VERIFICATION', 'APPROVED')).toBe(false);
    expect(canTransitionPurchaseRequest('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransitionPurchaseRequest('SUBMITTED', 'QUEUED')).toBe(false);
  });

  it('throws a domain error for invalid transitions', () => {
    expect(() => assertPurchaseRequestTransition('COMPLETED', 'FAILED')).toThrow(InvalidTransitionError);
    try {
      assertPurchaseRequestTransition('DRAFT', 'COMPLETED');
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
    }
  });

  it('computes intermediate transitions when an external state skips a status', () => {
    expect(purchaseRequestTransitionPath('QUEUED', 'COMPLETED')).toEqual(['RUNNING', 'COMPLETED']);
    expect(purchaseRequestTransitionPath('QUEUED', 'FAILED')).toEqual(['FAILED']);
    expect(purchaseRequestTransitionPath('RUNNING', 'RUNNING')).toEqual([]);
    expect(purchaseRequestTransitionPath('COMPLETED', 'QUEUED')).toBeNull();
  });
});

describe('automation job state machine', () => {
  it('prevents a running job from being re-queued as a new execution', () => {
    expect(canTransitionAutomationJob('RUNNING', 'QUEUED')).toBe(false);
    expect(() => assertAutomationJobTransition('RUNNING', 'SUBMITTING')).toThrow(InvalidTransitionError);
  });

  it('allows an authorized retry only from FAILED', () => {
    expect(canTransitionAutomationJob('FAILED', 'QUEUED')).toBe(true);
    expect(canTransitionAutomationJob('COMPLETED', 'QUEUED')).toBe(false);
    expect(canTransitionAutomationJob('CANCELLED', 'QUEUED')).toBe(false);
  });

  it('maps job statuses to business statuses', () => {
    expect(purchaseRequestStatusForJob('SUBMITTING')).toBe('QUEUED');
    expect(purchaseRequestStatusForJob('PENDING')).toBe('QUEUED');
    expect(purchaseRequestStatusForJob('RUNNING')).toBe('RUNNING');
    expect(purchaseRequestStatusForJob('FAILED')).toBe('FAILED');
  });
});
