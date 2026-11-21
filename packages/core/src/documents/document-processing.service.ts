import { Prisma, type PrismaClient } from '@orchestra/database';
import { AuditAction, AuditEntity, type ExtractionResult } from '@orchestra/domain';
import { systemActor } from '../actor';
import { writeAudit } from '../audit/audit-writer';
import {
  DocumentIntelligenceError,
  type DocumentIntelligenceClient,
} from '../document-intelligence/document-intelligence.client';
import { toJsonValue } from '../json';
import { errorMessage, type CoreLogger } from '../logger';
import { notifyUsers } from '../notifications/notifications';
import type { DocumentJobData, JobExecutionContext } from '../queue/queue.types';
import type { LocalFileStorage } from '../storage/local-file-storage';
import { runInTransaction } from '../transaction';
import { lockPurchaseRequest, transitionPurchaseRequest } from '../workflow/transitions';

export interface DocumentProcessingDependencies {
  db: PrismaClient;
  storage: LocalFileStorage;
  documentIntelligence: DocumentIntelligenceClient;
  logger: CoreLogger;
  now?: () => Date;
}

type Outcome = { ok: true; extraction: ExtractionResult } | { ok: false; error: string };

/**
 * Background processing of an uploaded document: send it to the
 * document-intelligence service, store the structured extraction and move the
 * purchase request to "Needs Verification". The extraction never changes the
 * request data itself; a human verifies it first.
 */
export class DocumentProcessingService {
  private readonly now: () => Date;

  constructor(private readonly deps: DocumentProcessingDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async process(data: DocumentJobData, context: JobExecutionContext): Promise<void> {
    const { db, logger } = this.deps;
    const document = await db.document.findUnique({
      where: { id: data.documentId },
      include: { purchaseRequest: { select: { id: true, status: true } } },
    });
    if (!document) {
      logger.warn('Document not found; skipping processing', { documentId: data.documentId });
      return;
    }
    if (document.processingRun !== data.run) {
      logger.log('Processing run superseded; skipping', { documentId: document.id, run: data.run });
      return;
    }
    if (document.processingStatus !== 'QUEUED' && document.processingStatus !== 'PROCESSING') return;

    if (document.purchaseRequest.status !== 'PROCESSING_DOCUMENT') {
      await db.document.updateMany({
        where: { id: document.id, processingRun: data.run, processingStatus: { in: ['QUEUED', 'PROCESSING'] } },
        data: {
          processingStatus: 'FAILED',
          processingError: `Processing skipped: purchase request is ${document.purchaseRequest.status}`,
        },
      });
      return;
    }

    await db.document.updateMany({
      where: { id: document.id, processingRun: data.run, processingStatus: { in: ['QUEUED', 'PROCESSING'] } },
      data: { processingStatus: 'PROCESSING', processingError: null },
    });

    let outcome: Outcome;
    try {
      const content = await this.deps.storage.read(document.storagePath);
      const extraction = await this.deps.documentIntelligence.extract({
        content,
        fileName: document.fileName,
        mimeType: document.mimeType,
        correlationId: data.correlationId,
      });
      outcome = { ok: true, extraction };
    } catch (error) {
      const retryable = error instanceof DocumentIntelligenceError ? error.retryable : !isMissingFile(error);
      if (retryable && !context.isFinalAttempt) {
        logger.warn('Document processing failed; will retry', {
          documentId: document.id,
          attempt: context.attempt,
          error: errorMessage(error),
        });
        throw error;
      }
      logger.error('Document processing failed permanently', { documentId: document.id, error: errorMessage(error) });
      outcome = { ok: false, error: errorMessage(error) };
    }

    await this.finish(document.id, document.purchaseRequestId, data, outcome);
  }

  private async finish(
    documentId: string,
    purchaseRequestId: string,
    data: DocumentJobData,
    outcome: Outcome,
  ): Promise<void> {
    const actor = systemActor(data.correlationId);
    const now = this.now();
    await runInTransaction(this.deps.db, async (tx) => {
      // Serialize completion per request so the "all documents processed" check is reliable.
      await lockPurchaseRequest(tx, purchaseRequestId);
      const updated = await tx.document.updateMany({
        where: { id: documentId, processingRun: data.run, processingStatus: 'PROCESSING' },
        data: outcome.ok
          ? {
              processingStatus: 'COMPLETED',
              extractedData: toJsonValue(outcome.extraction, { redact: false }),
              confidenceScore: new Prisma.Decimal(outcome.extraction.overallConfidence.toFixed(4)),
              processingError: null,
              processedAt: now,
            }
          : { processingStatus: 'FAILED', processingError: outcome.error.slice(0, 2000), processedAt: now },
      });
      if (updated.count !== 1) return;

      await writeAudit(tx, actor, {
        action: outcome.ok ? AuditAction.DOCUMENT_PROCESSED : AuditAction.DOCUMENT_PROCESSING_FAILED,
        entityType: AuditEntity.DOCUMENT,
        entityId: documentId,
        purchaseRequestId,
        newValue: outcome.ok
          ? {
              processingStatus: 'COMPLETED',
              overallConfidence: outcome.extraction.overallConfidence,
              needsReview: outcome.extraction.needsReview,
              extractionMethod: outcome.extraction.extractionMethod,
              itemCount: outcome.extraction.items.length,
            }
          : { processingStatus: 'FAILED', error: outcome.error.slice(0, 500) },
      });

      const pending = await tx.document.count({
        where: { purchaseRequestId, processingStatus: { in: ['QUEUED', 'PROCESSING'] } },
      });
      if (pending > 0) return;

      const request = await tx.purchaseRequest.findUnique({
        where: { id: purchaseRequestId },
        select: { status: true, requesterId: true, requestNumber: true },
      });
      if (request?.status !== 'PROCESSING_DOCUMENT') return;

      await transitionPurchaseRequest(tx, {
        purchaseRequestId,
        from: 'PROCESSING_DOCUMENT',
        to: 'NEEDS_VERIFICATION',
        actor,
        reason: outcome.ok ? null : 'Automatic extraction failed; enter the data manually from the document',
        metadata: outcome.ok ? { overallConfidence: outcome.extraction.overallConfidence } : { extractionFailed: true },
      });
      await notifyUsers(tx, [request.requesterId], {
        type: 'DOCUMENT_PROCESSED',
        title: `${request.requestNumber} is ready for verification`,
        message: outcome.ok
          ? `Extraction finished with ${Math.round(outcome.extraction.overallConfidence * 100)}% overall confidence. Review the extracted data before it is sent for approval.`
          : 'Automatic extraction failed. Enter the request data manually from the supporting document.',
        link: `/requests/${purchaseRequestId}`,
      });
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}
