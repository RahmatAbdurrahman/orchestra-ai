import { z } from 'zod';

/**
 * Contract between Orchestra AI and the UiPath process
 * "PurchaseOrderAutomation". Input arguments are sent with the StartJobs call;
 * output arguments are read from the finished job and validated before any
 * business status is changed.
 */
export interface RobotInputArguments {
  in_ExecutionId: string;
  in_PurchaseRequestId: string;
  in_RequestNumber: string;
  in_WorkflowId: string;
  in_CorrelationId: string;
  in_IdempotencyKey: string;
  /** JSON payload with the validated purchase order data (see RobotPurchaseOrderPayload). */
  in_PurchaseOrderJson: string;
}

export interface RobotPurchaseOrderPayload {
  requestNumber: string;
  supplierCode: string | null;
  supplierName: string;
  currency: string;
  requiredDate: string;
  documentNumber: string | null;
  department: string;
  taxAmount: number;
  totalAmount: number;
  items: Array<{ lineNo: number; description: string; quantity: number; unitPrice: number }>;
}

export const ROBOT_RESULT_STATUSES = ['CREATED', 'ALREADY_EXISTS', 'BUSINESS_ERROR'] as const;
export type RobotResultStatus = (typeof ROBOT_RESULT_STATUSES)[number];

export const PO_NUMBER_PATTERN = /^PO-\d{4}-\d{6}$/;

export const robotOutputSchema = z
  .object({
    out_Status: z.enum(ROBOT_RESULT_STATUSES),
    out_PoNumber: z.string().trim().max(50).nullish(),
    out_IdempotencyKey: z.string().trim().min(1).max(200),
    out_ErpReference: z.string().trim().max(200).nullish(),
    out_Message: z.string().max(2000).nullish(),
    out_ScreenshotPath: z.string().max(500).nullish(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.out_Status !== 'BUSINESS_ERROR') {
      if (!value.out_PoNumber || !PO_NUMBER_PATTERN.test(value.out_PoNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['out_PoNumber'],
          message: 'A valid purchase order number (PO-YYYY-NNNNNN) is required',
        });
      }
    }
  });
export type RobotOutput = z.infer<typeof robotOutputSchema>;

export type RobotOutputValidation =
  | { ok: true; value: RobotOutput }
  | { ok: false; reason: string };

/**
 * Validates the output of a finished robot job. The idempotency key must be
 * echoed back unchanged, which protects against results being attributed to
 * the wrong request.
 */
export function validateRobotOutput(raw: unknown, expectedIdempotencyKey: string): RobotOutputValidation {
  let candidate = raw;
  if (typeof raw === 'string') {
    try {
      candidate = raw.trim() === '' ? {} : JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'Output arguments are not valid JSON' };
    }
  }
  const parsed = robotOutputSchema.safeParse(candidate ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`);
    return { ok: false, reason: `Invalid robot output (${issues.join('; ')})` };
  }
  if (parsed.data.out_IdempotencyKey !== expectedIdempotencyKey) {
    return { ok: false, reason: 'Robot output idempotency key does not match the automation job' };
  }
  return { ok: true, value: parsed.data };
}
