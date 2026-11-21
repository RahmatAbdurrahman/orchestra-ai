/**
 * Simulated attended/unattended robot. It drives the ERP simulation through
 * the same web pages and element ids the real UiPath process uses
 * (login form -> new purchase order form -> result page), so the ERP code path
 * exercised in development is the one the real robot exercises.
 */
export interface RobotOutputs {
  out_Status: 'CREATED' | 'ALREADY_EXISTS' | 'BUSINESS_ERROR';
  out_PoNumber: string | null;
  out_IdempotencyKey: string;
  out_ErpReference: string | null;
  out_Message: string;
  out_ScreenshotPath: string | null;
}

export class RobotSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RobotSystemError';
  }
}

interface PurchaseOrderPayload {
  requestNumber: string;
  supplierCode: string | null;
  supplierName: string;
  currency: string;
  requiredDate: string;
  documentNumber: string | null;
  taxAmount: number;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
}

function extract(html: string, id: string): string | null {
  const match = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html);
  if (!match?.[1]) return null;
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

export class ErpUiRobot {
  constructor(
    private readonly erpUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async createPurchaseOrder(inputArguments: Record<string, unknown>): Promise<RobotOutputs> {
    const idempotencyKey = String(inputArguments.in_IdempotencyKey ?? '');
    if (!idempotencyKey) throw new RobotSystemError('in_IdempotencyKey is missing');
    let payload: PurchaseOrderPayload;
    try {
      payload = JSON.parse(String(inputArguments.in_PurchaseOrderJson ?? '')) as PurchaseOrderPayload;
    } catch {
      throw new RobotSystemError('in_PurchaseOrderJson is not valid JSON');
    }

    // 1. Log in (Type Into #username / #password, Click #login-button)
    const login = await this.request('/login', {
      method: 'POST',
      body: new URLSearchParams({ username: this.username, password: this.password }),
    });
    if (login.status !== 303) throw new RobotSystemError(`ERP login failed (HTTP ${login.status})`);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    if (!cookie) throw new RobotSystemError('ERP login did not return a session');

    // 2. Open the "New purchase order" form and check it is the expected screen.
    const formPage = await this.request('/purchase-orders/new', { headers: { Cookie: cookie } });
    const formHtml = await formPage.text();
    if (formPage.status !== 200 || !formHtml.includes('id="po-form"')) {
      throw new RobotSystemError(`Purchase order form not found (HTTP ${formPage.status})`);
    }

    // 3. Fill in and submit the form.
    const fields = new URLSearchParams({
      supplierCode: payload.supplierCode ?? '',
      supplierName: payload.supplierName,
      externalReference: payload.requestNumber,
      integrationKey: idempotencyKey,
      currency: payload.currency,
      requiredDate: payload.requiredDate,
      documentNumber: payload.documentNumber ?? '',
      taxAmount: String(payload.taxAmount ?? 0),
    });
    payload.items.forEach((item, index) => {
      fields.set(`item_${index + 1}_description`, item.description);
      fields.set(`item_${index + 1}_quantity`, String(item.quantity));
      fields.set(`item_${index + 1}_unitPrice`, String(item.unitPrice));
    });
    const submitted = await this.request('/purchase-orders', { method: 'POST', body: fields, headers: { Cookie: cookie } });
    const html = await submitted.text();
    if (submitted.status >= 500) throw new RobotSystemError(`ERP returned HTTP ${submitted.status} on submit`);

    // 4. Read the result screen (Get Text #result-status / #po-number / #result-message).
    const status = extract(html, 'result-status');
    const message = extract(html, 'result-message') ?? '';
    const poNumber = extract(html, 'po-number');
    await this.request('/logout', { method: 'POST', headers: { Cookie: cookie } }).catch(() => undefined);

    if (status === 'CREATED' || status === 'ALREADY_EXISTS') {
      if (!poNumber) throw new RobotSystemError('PO number not found on the result screen');
      return {
        out_Status: status,
        out_PoNumber: poNumber,
        out_IdempotencyKey: idempotencyKey,
        out_ErpReference: poNumber,
        out_Message: message,
        out_ScreenshotPath: null,
      };
    }
    if (status === 'ERROR') {
      return {
        out_Status: 'BUSINESS_ERROR',
        out_PoNumber: null,
        out_IdempotencyKey: idempotencyKey,
        out_ErpReference: null,
        out_Message: message || 'The ERP rejected the purchase order',
        out_ScreenshotPath: null,
      };
    }
    throw new RobotSystemError(`Unexpected result screen (HTTP ${submitted.status})`);
  }

  private async request(path: string, init: { method?: string; body?: URLSearchParams; headers?: Record<string, string> } = {}) {
    try {
      return await fetch(`${this.erpUrl.replace(/\/+$/, '')}${path}`, {
        method: init.method ?? 'GET',
        body: init.body?.toString(),
        headers: {
          ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...init.headers,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new RobotSystemError(`ERP not reachable: ${(error as Error).message}`);
    }
  }
}
