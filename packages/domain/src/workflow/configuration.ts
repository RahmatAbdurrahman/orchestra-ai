import { z } from 'zod';
import { APPROVAL_GROUPS } from '../enums';

export const SUPPORTED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type SupportedDocumentMimeType = (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number];

export const ruleEngineConfigSchema = z.object({
  baseCurrency: z.string().length(3),
  /** Simulation FX rates used only to evaluate thresholds in the base currency. */
  fxRatesToBase: z.record(z.string().length(3), z.number().positive()),
  minTransactionAmount: z.number().nonnegative(),
  maxTransactionAmount: z.number().positive(),
  maxQuantityPerItem: z.number().int().positive(),
  /** The ERP simulation form has a fixed number of item rows. */
  maxLineItems: z.number().int().min(1).max(10),
  requireRegisteredSupplier: z.boolean(),
  enforceDepartmentBudget: z.boolean(),
  duplicateLookbackDays: z.number().int().min(0).max(365),
  minLeadTimeDays: z.number().int().min(0).max(365),
  /** Relative tolerance when comparing the verified total with the extracted document total. */
  amountTolerance: z.number().min(0).max(0.5),
});
export type RuleEngineConfig = z.infer<typeof ruleEngineConfigSchema>;

export const approvalThresholdSchema = z.object({
  /** Upper bound (inclusive) in base currency; null = no upper bound. */
  maxAmount: z.number().positive().nullable(),
  groups: z.array(z.enum(APPROVAL_GROUPS)).min(1),
});
export type ApprovalThreshold = z.infer<typeof approvalThresholdSchema>;

export const approvalPolicySchema = z
  .object({
    thresholds: z.array(approvalThresholdSchema).min(1),
    /** The same person may not approve more than one level of the same request. */
    requireDistinctApprovers: z.boolean(),
  })
  .superRefine((policy, ctx) => {
    const { thresholds } = policy;
    const last = thresholds[thresholds.length - 1];
    if (last && last.maxAmount !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds', thresholds.length - 1, 'maxAmount'],
        message: 'The last threshold must be open ended (maxAmount = null)',
      });
    }
    for (let i = 0; i < thresholds.length - 1; i += 1) {
      const current = thresholds[i]!;
      const next = thresholds[i + 1]!;
      if (current.maxAmount === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['thresholds', i, 'maxAmount'],
          message: 'Only the last threshold may be open ended',
        });
      } else if (next.maxAmount !== null && next.maxAmount <= current.maxAmount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['thresholds', i + 1, 'maxAmount'],
          message: 'Thresholds must be in ascending order',
        });
      }
    }
    thresholds.forEach((threshold, index) => {
      if (new Set(threshold.groups).size !== threshold.groups.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['thresholds', index, 'groups'],
          message: 'Approval groups must not repeat',
        });
      }
    });
  });
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const automationConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** AUTOMATIC: dispatch on final approval. MANUAL: an operator dispatches approved requests. */
    dispatchMode: z.enum(['AUTOMATIC', 'MANUAL']),
    /** UiPath process (release) name in the configured Orchestrator folder. */
    processName: z.string().min(1).max(200),
    /** Automatic resubmissions for failures that happened before the robot started. */
    maxAutoAttempts: z.number().int().min(1).max(5),
    /** Hard cap on UiPath submissions, including operator retries. */
    maxTotalAttempts: z.number().int().min(1).max(10),
    /** A job still pending (no robot picked it up) after this long is treated as "robot unavailable". */
    pendingTimeoutMinutes: z.number().int().min(1).max(24 * 60),
    /** A running job exceeding this duration is stopped and marked failed. */
    executionTimeoutMinutes: z.number().int().min(1).max(24 * 60),
  })
  .refine((value) => value.maxTotalAttempts >= value.maxAutoAttempts, {
    message: 'maxTotalAttempts must be greater than or equal to maxAutoAttempts',
    path: ['maxTotalAttempts'],
  });
export type AutomationConfig = z.infer<typeof automationConfigSchema>;

export const documentStageConfigSchema = z.object({
  required: z.boolean(),
  /** Fields extracted below this confidence must be explicitly confirmed by a human. */
  confidenceThreshold: z.number().min(0).max(1),
  maxFileSizeMb: z.number().int().min(1).max(50),
  allowedMimeTypes: z.array(z.enum(SUPPORTED_DOCUMENT_MIME_TYPES)).min(1),
});
export type DocumentStageConfig = z.infer<typeof documentStageConfigSchema>;

export const workflowConfigurationSchema = z.object({
  document: documentStageConfigSchema,
  rules: ruleEngineConfigSchema,
  approval: approvalPolicySchema,
  automation: automationConfigSchema,
});
export type WorkflowConfiguration = z.infer<typeof workflowConfigurationSchema>;

/**
 * Default template for the Purchase Request -> Purchase Order workflow.
 * The amounts are simulation values (IDR) and can be changed by an administrator.
 */
export const DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION: WorkflowConfiguration = Object.freeze({
  document: {
    required: true,
    confidenceThreshold: 0.85,
    maxFileSizeMb: 10,
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
  },
  rules: {
    baseCurrency: 'IDR',
    fxRatesToBase: { IDR: 1, USD: 16000 },
    minTransactionAmount: 10_000,
    maxTransactionAmount: 1_000_000_000,
    maxQuantityPerItem: 10_000,
    maxLineItems: 10,
    requireRegisteredSupplier: true,
    enforceDepartmentBudget: true,
    duplicateLookbackDays: 30,
    minLeadTimeDays: 0,
    amountTolerance: 0.01,
  },
  approval: {
    thresholds: [
      { maxAmount: 5_000_000, groups: ['DEPARTMENT'] },
      { maxAmount: null, groups: ['DEPARTMENT', 'FINANCE'] },
    ],
    requireDistinctApprovers: true,
  },
  automation: {
    enabled: true,
    dispatchMode: 'AUTOMATIC',
    processName: 'PurchaseOrderAutomation',
    maxAutoAttempts: 3,
    maxTotalAttempts: 6,
    pendingTimeoutMinutes: 15,
    executionTimeoutMinutes: 30,
  },
}) as WorkflowConfiguration;

export function parseWorkflowConfiguration(raw: unknown): WorkflowConfiguration {
  return workflowConfigurationSchema.parse(raw);
}

export function safeParseWorkflowConfiguration(raw: unknown) {
  return workflowConfigurationSchema.safeParse(raw);
}
