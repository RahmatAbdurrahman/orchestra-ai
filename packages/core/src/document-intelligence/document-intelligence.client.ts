import { extractionResultSchema, type ExtractionResult } from '@orchestra/domain';

export class DocumentIntelligenceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DocumentIntelligenceError';
  }
}

export interface DocumentIntelligenceClientOptions {
  baseUrl: string;
  internalToken: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** HTTP client for the Python document-intelligence service. */
export class DocumentIntelligenceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: DocumentIntelligenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async extract(input: {
    content: Buffer;
    fileName: string;
    mimeType: string;
    correlationId: string;
  }): Promise<ExtractionResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.content)], { type: input.mimeType }), input.fileName);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/extract`, {
        method: 'POST',
        body: form,
        headers: {
          'X-Internal-Token': this.options.internalToken,
          'X-Correlation-Id': input.correlationId,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new DocumentIntelligenceError(
        `Document intelligence service unreachable: ${(error as Error).message}`,
        true,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      let detail = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (parsed.detail) detail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
      } catch {
        // keep raw text
      }
      throw new DocumentIntelligenceError(
        `Document intelligence service returned ${response.status}: ${detail}`,
        retryable,
        response.status,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new DocumentIntelligenceError('Document intelligence service returned invalid JSON', true, response.status);
    }
    const parsed = extractionResultSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DocumentIntelligenceError(
        `Unexpected extraction result: ${parsed.error.issues.slice(0, 3).map((issue) => issue.path.join('.') + ' ' + issue.message).join('; ')}`,
        false,
        response.status,
      );
    }
    return parsed.data;
  }

  async health(): Promise<{ ok: boolean; message?: string; engines?: unknown }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: response.ok, engines: body.ocr ?? null };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }
}
