import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@orchestra/database';
import {
  loadWorkflowConfiguration,
  lockPurchaseRequest,
  runInTransaction,
  transitionPurchaseRequest,
  writeAudit,
  type JobQueue,
  type LocalFileStorage,
} from '@orchestra/core';
import {
  AuditAction,
  AuditEntity,
  computeLineTotal,
  computeTotals,
  DomainError,
  extractionResultSchema,
  ForbiddenActionError,
  lowConfidenceFields,
  type RuleRequestInput,
} from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { actorFor, RequestContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma.service';
import { FILE_STORAGE, JOB_QUEUE } from '../../infrastructure/tokens';
import { RuleEvaluationService } from '../business-rules/rule-evaluation.service';
import { PurchaseRequestsService, toDateOnly } from '../purchase-requests/purchase-requests.service';
import { RequestAccessService } from '../purchase-requests/request-access.service';
import type { VerifyDocumentDto } from './documents.dto';
import { extensionFor, extensionMatches, sanitizeFileName, sniffMimeType } from './file-validation';

const MAX_DOCUMENTS_PER_REQUEST = 5;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RequestAccessService,
    private readonly rules: RuleEvaluationService,
    private readonly requests: PurchaseRequestsService,
    @Inject(FILE_STORAGE) private readonly storage: LocalFileStorage,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async upload(user: AuthUser, purchaseRequestId: string, file: Express.Multer.File | undefined) {
    if (!file) throw new UnprocessableEntityException('A file is required (multipart field "file")');
    await this.access.assertReadable(user, purchaseRequestId);
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id: purchaseRequestId } });
    if (request.requesterId !== user.id) throw new ForbiddenActionError('Only the requester can upload documents');
    if (request.status !== 'DRAFT' && request.status !== 'NEEDS_VERIFICATION') {
      throw new DomainError('PRECONDITION_FAILED', `Documents cannot be added while the request is ${request.status}`);
    }
    const configuration = await loadWorkflowConfiguration(this.prisma, request.workflowId, request.workflowVersion);
    const maxBytes = configuration.document.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new UnprocessableEntityException(`The file exceeds the ${configuration.document.maxFileSizeMb} MB limit`);
    }
    const mimeType = sniffMimeType(file.buffer);
    if (!mimeType || !configuration.document.allowedMimeTypes.includes(mimeType)) {
      throw new UnprocessableEntityException(
        `Unsupported file content. Allowed types: ${configuration.document.allowedMimeTypes.join(', ')}`,
      );
    }
    const fileName = sanitizeFileName(file.originalname);
    if (!extensionMatches(fileName, mimeType)) {
      throw new UnprocessableEntityException('The file extension does not match the file content');
    }
    const count = await this.prisma.document.count({ where: { purchaseRequestId } });
    if (count >= MAX_DOCUMENTS_PER_REQUEST) {
      throw new UnprocessableEntityException(`A request can have at most ${MAX_DOCUMENTS_PER_REQUEST} documents`);
    }

    const id = randomUUID();
    const storagePath = `purchase-requests/${purchaseRequestId}/${id}${extensionFor(mimeType)}`;
    await this.storage.save(storagePath, file.buffer);
    const document = await runInTransaction(this.prisma, async (tx) => {
      const created = await tx.document.create({
        data: {
          id,
          purchaseRequestId,
          fileName,
          storagePath,
          mimeType,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          uploadedById: user.id,
        },
      });
      await writeAudit(tx, actorFor(user), {
        action: AuditAction.DOCUMENT_UPLOADED,
        entityType: AuditEntity.DOCUMENT,
        entityId: created.id,
        purchaseRequestId,
        newValue: { fileName, mimeType, sizeBytes: file.size, sha256: created.sha256 },
      });
      return created;
    });
    return this.get(user, document.id);
  }

  async get(user: AuthUser, documentId: string) {
    const document = await this.findReadable(user, documentId);
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: document.purchaseRequestId },
      select: { workflowId: true, workflowVersion: true },
    });
    const configuration = await loadWorkflowConfiguration(this.prisma, request.workflowId, request.workflowVersion);
    const extraction = document.extractedData ? extractionResultSchema.safeParse(document.extractedData) : null;
    return {
      id: document.id,
      purchaseRequestId: document.purchaseRequestId,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      processingStatus: document.processingStatus,
      processingError: document.processingError,
      confidenceScore: document.confidenceScore === null ? null : Number(document.confidenceScore.toString()),
      extraction: extraction?.success ? extraction.data : null,
      confidenceThreshold: configuration.document.confidenceThreshold,
      lowConfidenceFields: extraction?.success
        ? lowConfidenceFields(extraction.data, configuration.document.confidenceThreshold)
        : [],
      verifiedData: document.verifiedData,
      processedAt: document.processedAt,
      verifiedAt: document.verifiedAt,
      createdAt: document.createdAt,
    };
  }

  async openFile(user: AuthUser, documentId: string) {
    const document = await this.findReadable(user, documentId);
    return { document, stream: this.storage.createReadStream(document.storagePath) };
  }

  /** (Re)processes a document while the request is waiting for verification. */
  async process(user: AuthUser, documentId: string) {
    const document = await this.findReadable(user, documentId);
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id: document.purchaseRequestId } });
    if (request.requesterId !== user.id) throw new ForbiddenActionError('Only the requester can request processing');
    if (request.status !== 'NEEDS_VERIFICATION') {
      throw new DomainError(
        'PRECONDITION_FAILED',
        request.status === 'DRAFT'
          ? 'Documents are processed automatically when the request is submitted'
          : `Documents cannot be processed while the request is ${request.status}`,
      );
    }
    const actor = actorFor(user);
    const run = await runInTransaction(this.prisma, async (tx) => {
      await lockPurchaseRequest(tx, request.id);
      const current = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
      if (current.processingStatus === 'QUEUED' || current.processingStatus === 'PROCESSING') {
        throw new DomainError('PRECONDITION_FAILED', 'The document is already being processed');
      }
      const nextRun = current.processingRun + 1;
      await tx.document.update({
        where: { id: documentId },
        data: { processingStatus: 'QUEUED', processingRun: nextRun, processingError: null },
      });
      await transitionPurchaseRequest(tx, {
        purchaseRequestId: request.id,
        from: 'NEEDS_VERIFICATION',
        to: 'PROCESSING_DOCUMENT',
        actor,
        reason: 'Document reprocessing requested',
      });
      await writeAudit(tx, actor, {
        action: AuditAction.DOCUMENT_PROCESSING_REQUESTED,
        entityType: AuditEntity.DOCUMENT,
        entityId: documentId,
        purchaseRequestId: request.id,
        metadata: { run: nextRun },
      });
      return nextRun;
    });
    try {
      await this.queue.enqueueDocumentProcessing({
        documentId,
        run,
        correlationId: RequestContext.correlationId() ?? randomUUID(),
      });
    } catch (error) {
      this.logger.error(`Enqueue failed; the reconciler will retry: ${(error as Error).message}`);
    }
    return this.get(user, documentId);
  }

  /**
   * Human verification of the extracted data (PRD 5.5 / 6.1 step 5).
   * Low-confidence fields must be explicitly acknowledged. Totals are always
   * recomputed on the server. If the business rules pass, the request moves to
   * Pending Approval; otherwise the corrected data is saved and the findings
   * are returned so the requester can fix them.
   */
  async verify(user: AuthUser, documentId: string, input: VerifyDocumentDto) {
    const document = await this.findReadable(user, documentId);
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id: document.purchaseRequestId } });
    if (request.requesterId !== user.id) throw new ForbiddenActionError('Only the requester can verify the document data');
    if (request.status !== 'NEEDS_VERIFICATION') {
      throw new DomainError('PRECONDITION_FAILED', `The request is ${request.status}; it is not waiting for verification`);
    }
    if (!['COMPLETED', 'FAILED', 'UPLOADED'].includes(document.processingStatus)) {
      throw new DomainError('PRECONDITION_FAILED', `The document is ${document.processingStatus}`);
    }
    const configuration = await loadWorkflowConfiguration(this.prisma, request.workflowId, request.workflowVersion);
    const extraction = document.extractedData ? extractionResultSchema.safeParse(document.extractedData) : null;
    if (extraction?.success) {
      const required = lowConfidenceFields(extraction.data, configuration.document.confidenceThreshold);
      const missing = required.filter((field) => !input.acknowledgedFields.includes(field));
      if (missing.length > 0) {
        throw new DomainError('VALIDATION_FAILED', `Confirm the low-confidence fields after checking them: ${missing.join(', ')}`, {
          missingAcknowledgements: missing,
        });
      }
    }

    const supplier = await this.requests.resolveSupplier(input.supplierId, input.supplierName);
    const totals = computeTotals(input.items, input.taxAmount);
    const ruleInput: RuleRequestInput = {
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? input.supplierName,
      documentNumber: input.documentNumber?.trim() || null,
      currency: input.currency,
      requiredDate: input.requiredDate,
      items: input.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice })),
      taxAmount: input.taxAmount,
      extractedTotal: extraction?.success ? extraction.data.fields.totalAmount.value : null,
    };
    const actor = actorFor(user);

    const evaluation = await runInTransaction(this.prisma, async (tx) => {
      await lockPurchaseRequest(tx, request.id);
      const current = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true } });
      if (current.status !== 'NEEDS_VERIFICATION') {
        throw new DomainError('CONFLICT', 'The request changed while you were verifying it. Reload and try again.');
      }
      await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: request.id } });
      await tx.purchaseRequestItem.createMany({
        data: input.items.map((item, index) => ({
          purchaseRequestId: request.id,
          lineNo: index + 1,
          description: item.description.trim(),
          quantity: item.quantity,
          unit: item.unit?.trim() || null,
          unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2)),
          lineTotal: new Prisma.Decimal(computeLineTotal(item.quantity, item.unitPrice).toFixed(2)),
        })),
      });
      await tx.purchaseRequest.update({
        where: { id: request.id },
        data: {
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? input.supplierName.trim(),
          documentNumber: ruleInput.documentNumber,
          documentDate: toDateOnly(input.documentDate),
          currency: input.currency,
          requiredDate: toDateOnly(input.requiredDate),
          subtotalAmount: new Prisma.Decimal(totals.subtotal.toFixed(2)),
          taxAmount: new Prisma.Decimal(totals.taxAmount.toFixed(2)),
          totalAmount: new Prisma.Decimal(totals.total.toFixed(2)),
        },
      });
      const result = await this.rules.evaluate(tx, {
        purchaseRequestId: request.id,
        requesterId: request.requesterId,
        departmentId: request.departmentId,
        input: ruleInput,
        configuration,
      });
      const verifiedData = {
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? input.supplierName,
        documentNumber: ruleInput.documentNumber,
        documentDate: input.documentDate ?? null,
        currency: input.currency,
        requiredDate: input.requiredDate,
        taxAmount: totals.taxAmount,
        items: input.items,
        acknowledgedFields: input.acknowledgedFields,
      } as unknown as Prisma.InputJsonValue;
      await tx.document.update({
        where: { id: documentId },
        data: result.passed
          ? { verifiedData, verifiedAt: new Date(), verifiedById: user.id, processingStatus: 'VERIFIED' }
          : { verifiedData },
      });
      if (result.passed) {
        await writeAudit(tx, actor, {
          action: AuditAction.DOCUMENT_VERIFIED,
          entityType: AuditEntity.DOCUMENT,
          entityId: documentId,
          purchaseRequestId: request.id,
          newValue: { acknowledgedFields: input.acknowledgedFields, totalAmount: totals.total, currency: input.currency },
        });
        await this.requests.enterApproval(tx, request, result, actor, 'NEEDS_VERIFICATION');
      } else {
        await tx.purchaseRequest.update({
          where: { id: request.id },
          data: { ruleEvaluation: result as unknown as Prisma.InputJsonValue },
        });
        await writeAudit(tx, actor, {
          action: AuditAction.REQUEST_RULES_EVALUATED,
          entityType: AuditEntity.PURCHASE_REQUEST,
          entityId: request.id,
          purchaseRequestId: request.id,
          newValue: { passed: false, findings: result.findings.map((finding) => `${finding.severity}:${finding.ruleId}`) },
        });
      }
      return result;
    });

    return {
      outcome: evaluation.passed ? 'PENDING_APPROVAL' : 'BLOCKED_BY_RULES',
      ruleEvaluation: evaluation,
      purchaseRequest: await this.requests.detail(user, request.id),
    };
  }

  private async findReadable(user: AuthUser, documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException('Document not found');
    await this.access.assertReadable(user, document.purchaseRequestId);
    return document;
  }
}
