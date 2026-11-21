import { z } from 'zod';

/**
 * Contract of the document-intelligence service (Python / FastAPI).
 * The API never trusts this output directly: low-confidence fields must be
 * confirmed by a human during verification (PRD 5.5).
 */
function extractedField<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
    source: z.string().nullish(),
  });
}

export const extractedLineItemSchema = z.object({
  description: extractedField(z.string()),
  quantity: extractedField(z.number()),
  unitPrice: extractedField(z.number()),
  lineTotal: extractedField(z.number()),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
});

export const extractionResultSchema = z.object({
  documentType: z.string(),
  extractionMethod: z.string(),
  pageCount: z.number().int().nonnegative(),
  fields: z.object({
    supplierName: extractedField(z.string()),
    documentNumber: extractedField(z.string()),
    documentDate: extractedField(z.string()),
    currency: extractedField(z.string()),
    subtotal: extractedField(z.number()),
    taxAmount: extractedField(z.number()),
    totalAmount: extractedField(z.number()),
  }),
  items: z.array(extractedLineItemSchema),
  overallConfidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  reviewReasons: z.array(z.string()),
  warnings: z.array(z.string()).default([]),
  rawTextPreview: z.string().nullish(),
  processingMs: z.number().nullish(),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type ExtractedLineItem = z.infer<typeof extractedLineItemSchema>;
export type ExtractedFieldKey = keyof ExtractionResult['fields'];

/** Fields the requester must explicitly acknowledge during verification. */
export const VERIFIABLE_FIELDS = [
  'supplierName',
  'documentNumber',
  'documentDate',
  'currency',
  'taxAmount',
  'totalAmount',
  'items',
] as const;
export type VerifiableField = (typeof VERIFIABLE_FIELDS)[number];

/**
 * Lists extracted fields that need human confirmation: confidence below the
 * workflow threshold, flagged by the extractor, or missing entirely.
 */
export function lowConfidenceFields(extraction: ExtractionResult, threshold: number): VerifiableField[] {
  const result: VerifiableField[] = [];
  for (const key of VERIFIABLE_FIELDS) {
    if (key === 'items') {
      const itemsNeedReview =
        extraction.items.length === 0 ||
        extraction.items.some((item) => item.needsReview || item.confidence < threshold);
      if (itemsNeedReview) result.push('items');
      continue;
    }
    const field = extraction.fields[key];
    if (field.value === null || field.needsReview || field.confidence < threshold) result.push(key);
  }
  return result;
}
