import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toJsonValue } from './json';
import { silentLogger } from './logger';
import { InlineJobQueue } from './queue/inline-job-queue';
import type { JobExecutionContext } from './queue/queue.types';
import { LocalFileStorage } from './storage/local-file-storage';

describe('toJsonValue (audit payloads)', () => {
  it('redacts secret-looking keys and drops undefined values', () => {
    expect(
      toJsonValue({ name: 'Rina', passwordHash: 'x', nested: { apiKey: 'k', token: 't', ok: 1 }, missing: undefined }),
    ).toEqual({ name: 'Rina', passwordHash: '[REDACTED]', nested: { apiKey: '[REDACTED]', token: '[REDACTED]', ok: 1 } });
  });

  it('can keep values verbatim when redaction is disabled (robot payloads)', () => {
    expect(toJsonValue({ idempotencyKey: 'oa-po-1', token: 'x' }, { redact: false })).toEqual({ idempotencyKey: 'oa-po-1', token: 'x' });
    expect(toJsonValue(undefined)).toBeUndefined();
  });
});

describe('InlineJobQueue', () => {
  it('de-duplicates job ids and retries with the final-attempt flag', async () => {
    const queue = new InlineJobQueue(silentLogger, 0.001);
    const calls: JobExecutionContext[] = [];
    let documentCalls = 0;
    queue.registerHandlers({
      processDocument: async (_data, context) => {
        documentCalls += 1;
        calls.push(context);
        if (!context.isFinalAttempt) throw new Error('transient');
      },
      submitAutomation: async () => undefined,
      pollAutomation: async () => undefined,
    });
    await queue.enqueueDocumentProcessing({ documentId: 'd1', run: 1, correlationId: 'c' });
    await queue.enqueueDocumentProcessing({ documentId: 'd1', run: 1, correlationId: 'c' });
    await queue.drain(5_000);
    expect(documentCalls).toBe(4);
    expect(calls.map((context) => context.attempt)).toEqual([1, 2, 3, 4]);
    expect(calls.at(-1)?.isFinalAttempt).toBe(true);
    await queue.close();
  });
});

describe('LocalFileStorage', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'orchestra-storage-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('stores and reads files below the root', async () => {
    const storage = new LocalFileStorage(root);
    await storage.save('purchase-requests/p1/d1.pdf', Buffer.from('%PDF-1.7'));
    await expect(storage.read('purchase-requests/p1/d1.pdf')).resolves.toEqual(Buffer.from('%PDF-1.7'));
    await expect(storage.save('purchase-requests/p1/d1.pdf', Buffer.from('x'))).rejects.toThrow();
  });

  it('refuses paths that escape the root', () => {
    const storage = new LocalFileStorage(root);
    expect(() => storage.resolve('../outside.txt')).toThrow('Invalid storage path');
    expect(() => storage.resolve('/etc/passwd')).toThrow('Invalid storage path');
    expect(() => storage.resolve('a/../../b')).toThrow('Invalid storage path');
  });
});
