import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { BusinessError, type PurchaseOrderInput, type PurchaseOrderStore } from './store';
import { detailPage, ITEM_ROWS, listPage, loginPage, maintenancePage, newOrderPage, resultPage } from './views';

export interface ErpAppOptions {
  store: PurchaseOrderStore;
  username: string;
  password: string;
  apiToken: string;
  simAdminToken: string;
  sessionTtlMs?: number;
}

export interface SimulationSettings {
  maintenanceMode: boolean;
  responseDelayMs: number;
}

const SESSION_COOKIE = 'simerp_session';

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumber(value: unknown): number {
  const raw = text(value).replace(/,/g, '');
  return raw === '' ? Number.NaN : Number(raw);
}

/** Converts the HTML form (10 fixed item rows) into a purchase order input. */
function fromForm(body: Record<string, unknown>, createdBy: string): PurchaseOrderInput {
  const items: PurchaseOrderInput['items'] = [];
  for (let n = 1; n <= ITEM_ROWS; n += 1) {
    const description = text(body[`item_${n}_description`]);
    const quantity = text(body[`item_${n}_quantity`]);
    const unitPrice = text(body[`item_${n}_unitPrice`]);
    if (!description && !quantity && !unitPrice) continue;
    items.push({ description, quantity: parseNumber(quantity), unitPrice: parseNumber(unitPrice) });
  }
  const tax = text(body.taxAmount);
  return {
    integrationKey: text(body.integrationKey) || null,
    externalReference: text(body.externalReference) || null,
    supplierCode: text(body.supplierCode) || null,
    supplierName: text(body.supplierName),
    currency: text(body.currency) || 'IDR',
    requiredDate: text(body.requiredDate),
    documentNumber: text(body.documentNumber) || null,
    taxAmount: tax === '' ? 0 : parseNumber(tax),
    items,
    createdBy,
  };
}

function fromJson(body: Record<string, unknown>, idempotencyKey: string | null, createdBy: string): PurchaseOrderInput {
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    integrationKey: idempotencyKey ?? (text(body.integrationKey) || null),
    externalReference: text(body.externalReference) || null,
    supplierCode: text(body.supplierCode) || null,
    supplierName: text(body.supplierName),
    currency: text(body.currency) || 'IDR',
    requiredDate: text(body.requiredDate),
    documentNumber: text(body.documentNumber) || null,
    taxAmount: typeof body.taxAmount === 'number' ? body.taxAmount : 0,
    items: items.map((item) => {
      const value = (item ?? {}) as Record<string, unknown>;
      return {
        description: text(value.description),
        quantity: Number(value.quantity),
        unitPrice: Number(value.unitPrice),
      };
    }),
    createdBy,
  };
}

export function createErpApp(options: ErpAppOptions): { app: Express; settings: SimulationSettings } {
  const app = express();
  const sessions = new Map<string, { username: string; expiresAt: number }>();
  const settings: SimulationSettings = { maintenanceMode: false, responseDelayMs: 0 };
  const sessionTtl = options.sessionTtlMs ?? 8 * 3600_000;

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // --- Simulation controls (tests / failure injection) -------------------------
  const requireSimAdmin = (req: Request, res: Response, next: NextFunction) => {
    const token = req.header('x-sim-admin-token') ?? '';
    if (!options.simAdminToken || !safeEqual(token, options.simAdminToken)) {
      res.status(401).json({ error: 'Invalid simulation admin token' });
      return;
    }
    next();
  };
  app.get('/api/__sim/settings', requireSimAdmin, (_req, res) => {
    res.json(settings);
  });
  app.post('/api/__sim/settings', requireSimAdmin, (req, res) => {
    const body = (req.body ?? {}) as Partial<SimulationSettings>;
    if (typeof body.maintenanceMode === 'boolean') settings.maintenanceMode = body.maintenanceMode;
    if (typeof body.responseDelayMs === 'number' && body.responseDelayMs >= 0 && body.responseDelayMs <= 120_000) {
      settings.responseDelayMs = body.responseDelayMs;
    }
    res.json(settings);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'erp-simulation', maintenanceMode: settings.maintenanceMode });
  });

  // Latency / maintenance simulation applies to everything below.
  app.use(async (_req, res, next) => {
    if (settings.responseDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, settings.responseDelayMs));
    if (settings.maintenanceMode) {
      res.status(503).type('html').send(maintenancePage());
      return;
    }
    next();
  });

  // --- JSON API (used by tests and the Orchestrator mock robot) ----------------
  const requireApiToken = (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!options.apiToken || !safeEqual(token, options.apiToken)) {
      res.status(401).json({ error: 'Invalid API token' });
      return;
    }
    next();
  };
  app.get('/api/purchase-orders', requireApiToken, (req, res) => {
    const integrationKey = typeof req.query.integrationKey === 'string' ? req.query.integrationKey : undefined;
    const externalReference = typeof req.query.externalReference === 'string' ? req.query.externalReference : undefined;
    res.json({ data: options.store.list({ integrationKey, externalReference }) });
  });
  app.post('/api/purchase-orders', requireApiToken, (req, res) => {
    try {
      const input = fromJson((req.body ?? {}) as Record<string, unknown>, req.header('idempotency-key') ?? null, 'api');
      const result = options.store.create(input);
      res.status(result.status === 'CREATED' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof BusinessError) {
        res.status(422).json({ status: 'ERROR', message: error.message });
        return;
      }
      throw error;
    }
  });

  // --- Web UI (operated by the UiPath robot) -----------------------------------
  const currentUser = (req: Request): string | null => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session.username;
  };
  const requireSession = (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req);
    if (!user) {
      res.redirect(303, '/login');
      return;
    }
    res.locals.user = user;
    next();
  };

  app.get('/', (req, res) => {
    res.redirect(303, currentUser(req) ? '/purchase-orders' : '/login');
  });
  app.get('/login', (_req, res) => {
    res.type('html').send(loginPage());
  });
  app.post('/login', (req, res) => {
    const username = text(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!safeEqual(username, options.username) || !safeEqual(password, options.password)) {
      res.status(401).type('html').send(loginPage('Invalid username or password'));
      return;
    }
    const token = randomBytes(24).toString('hex');
    sessions.set(token, { username, expiresAt: Date.now() + sessionTtl });
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    res.redirect(303, '/purchase-orders');
  });
  app.post('/logout', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.redirect(303, '/login');
  });
  app.get('/purchase-orders', requireSession, (_req, res) => {
    res.type('html').send(listPage(res.locals.user as string, options.store.list()));
  });
  app.get('/purchase-orders/new', requireSession, (_req, res) => {
    res.type('html').send(newOrderPage(res.locals.user as string, options.store.vendors()));
  });
  app.post('/purchase-orders', requireSession, (req, res) => {
    const user = res.locals.user as string;
    try {
      const result = options.store.create(fromForm((req.body ?? {}) as Record<string, unknown>, user));
      const message =
        result.status === 'CREATED'
          ? `Purchase order ${result.purchaseOrder.poNumber} created`
          : `A purchase order already exists for integration key ${result.purchaseOrder.integrationKey}; no new order was created`;
      res.status(result.status === 'CREATED' ? 201 : 200).type('html').send(
        resultPage(user, { status: result.status, message, order: result.purchaseOrder }),
      );
    } catch (error) {
      if (error instanceof BusinessError) {
        res.status(422).type('html').send(resultPage(user, { status: 'ERROR', message: error.message }));
        return;
      }
      throw error;
    }
  });
  app.get('/purchase-orders/:poNumber', requireSession, (req, res) => {
    const order = options.store.findByPoNumber(String(req.params.poNumber));
    if (!order) {
      res.status(404).type('html').send(resultPage(res.locals.user as string, { status: 'ERROR', message: 'Purchase order not found' }));
      return;
    }
    res.type('html').send(detailPage(res.locals.user as string, order));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({ error: 'Internal error' });
  });

  return { app, settings };
}
