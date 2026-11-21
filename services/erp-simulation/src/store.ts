import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface PurchaseOrderItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrderInput {
  integrationKey: string | null;
  externalReference: string | null;
  supplierCode: string | null;
  supplierName: string;
  currency: string;
  requiredDate: string;
  documentNumber: string | null;
  taxAmount: number;
  items: PurchaseOrderItemInput[];
  createdBy: string;
}

export interface PurchaseOrder {
  poNumber: string;
  integrationKey: string | null;
  externalReference: string | null;
  supplierCode: string | null;
  supplierName: string;
  currency: string;
  requiredDate: string;
  documentNumber: string | null;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  createdBy: string;
  createdAt: string;
  items: Array<PurchaseOrderItemInput & { lineNo: number; lineTotal: number }>;
}

export type CreateResult =
  | { status: 'CREATED'; purchaseOrder: PurchaseOrder }
  | { status: 'ALREADY_EXISTS'; purchaseOrder: PurchaseOrder };

export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** ERP vendor master. SUP-006 is blocked to demonstrate business exceptions. */
const VENDORS: Array<{ code: string; name: string; blocked: boolean }> = [
  { code: 'SUP-001', name: 'PT Sinar Jaya Abadi', blocked: false },
  { code: 'SUP-002', name: 'CV Maju Bersama', blocked: false },
  { code: 'SUP-003', name: 'PT Teknologi Nusantara', blocked: false },
  { code: 'SUP-004', name: 'PT Kertas Prima Indonesia', blocked: false },
  { code: 'SUP-005', name: 'Global Office Supplies Ltd', blocked: false },
  { code: 'SUP-006', name: 'PT Mitra Lama Sentosa', blocked: true },
];

const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const fromCents = (value: number) => value / 100;

interface PoRow {
  id: number;
  po_number: string;
  integration_key: string | null;
  external_reference: string | null;
  supplier_code: string | null;
  supplier_name: string;
  currency: string;
  required_date: string;
  document_number: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  created_by: string;
  created_at: string;
}

interface ItemRow {
  line_no: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

/**
 * SQLite-backed purchase order store. The UNIQUE constraint on
 * integration_key is the last line of defense against duplicate purchase
 * orders, even if two robot runs race each other.
 */
export class PurchaseOrderStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_number TEXT NOT NULL UNIQUE,
        integration_key TEXT UNIQUE,
        external_reference TEXT,
        supplier_code TEXT,
        supplier_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        required_date TEXT NOT NULL,
        document_number TEXT,
        subtotal_cents INTEGER NOT NULL,
        tax_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
        line_no INTEGER NOT NULL,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        line_total_cents INTEGER NOT NULL
      );
    `);
  }

  vendors() {
    return VENDORS;
  }

  create(input: PurchaseOrderInput, now = new Date()): CreateResult {
    if (input.integrationKey) {
      const existing = this.findByIntegrationKey(input.integrationKey);
      if (existing) return { status: 'ALREADY_EXISTS', purchaseOrder: existing };
    }
    this.validate(input);

    const subtotalCents = input.items.reduce((sum, item) => sum + Math.round(item.quantity * toCents(item.unitPrice)), 0);
    const taxCents = toCents(input.taxAmount);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const year = now.getUTCFullYear();
      const sequence = (this.db.prepare('SELECT COUNT(*) AS count FROM purchase_orders').get() as { count: number }).count + 1;
      const poNumber = `PO-${year}-${String(sequence).padStart(6, '0')}`;
      const inserted = this.db
        .prepare(
          `INSERT INTO purchase_orders (po_number, integration_key, external_reference, supplier_code, supplier_name, currency,
             required_date, document_number, subtotal_cents, tax_cents, total_cents, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          poNumber,
          input.integrationKey,
          input.externalReference,
          input.supplierCode,
          input.supplierName,
          input.currency,
          input.requiredDate,
          input.documentNumber,
          subtotalCents,
          taxCents,
          subtotalCents + taxCents,
          input.createdBy,
          now.toISOString(),
        );
      const insertItem = this.db.prepare(
        `INSERT INTO purchase_order_items (purchase_order_id, line_no, description, quantity, unit_price_cents, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      input.items.forEach((item, index) => {
        insertItem.run(
          Number(inserted.lastInsertRowid),
          index + 1,
          item.description,
          item.quantity,
          toCents(item.unitPrice),
          Math.round(item.quantity * toCents(item.unitPrice)),
        );
      });
      this.db.exec('COMMIT');
      return { status: 'CREATED', purchaseOrder: this.findByPoNumber(poNumber)! };
    } catch (error) {
      this.db.exec('ROLLBACK');
      const sqliteCode = (error as { errcode?: number }).errcode;
      if (sqliteCode === 2067 && input.integrationKey) {
        const existing = this.findByIntegrationKey(input.integrationKey);
        if (existing) return { status: 'ALREADY_EXISTS', purchaseOrder: existing };
      }
      throw error;
    }
  }

  list(filter: { integrationKey?: string; externalReference?: string } = {}): PurchaseOrder[] {
    const conditions: string[] = [];
    const values: string[] = [];
    if (filter.integrationKey) {
      conditions.push('integration_key = ?');
      values.push(filter.integrationKey);
    }
    if (filter.externalReference) {
      conditions.push('external_reference = ?');
      values.push(filter.externalReference);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM purchase_orders ${where} ORDER BY id DESC LIMIT 500`).all(...values) as unknown as PoRow[];
    return rows.map((row) => this.hydrate(row));
  }

  findByPoNumber(poNumber: string): PurchaseOrder | null {
    const row = this.db.prepare('SELECT * FROM purchase_orders WHERE po_number = ?').get(poNumber) as unknown as PoRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  findByIntegrationKey(integrationKey: string): PurchaseOrder | null {
    const row = this.db
      .prepare('SELECT * FROM purchase_orders WHERE integration_key = ?')
      .get(integrationKey) as unknown as PoRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  close(): void {
    this.db.close();
  }

  private validate(input: PurchaseOrderInput): void {
    if (!input.supplierName.trim()) throw new BusinessError('Supplier name is required');
    if (input.supplierCode) {
      const vendor = VENDORS.find((candidate) => candidate.code === input.supplierCode);
      if (!vendor) throw new BusinessError(`Vendor ${input.supplierCode} does not exist in the ERP vendor master`);
      if (vendor.blocked) throw new BusinessError(`Vendor ${input.supplierCode} is blocked for purchasing`);
    }
    if (!['IDR', 'USD'].includes(input.currency)) throw new BusinessError(`Currency ${input.currency} is not supported`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requiredDate)) throw new BusinessError('Required date must be YYYY-MM-DD');
    if (input.items.length === 0) throw new BusinessError('At least one line item is required');
    if (input.items.length > 10) throw new BusinessError('A purchase order supports at most 10 line items');
    input.items.forEach((item, index) => {
      if (!item.description.trim()) throw new BusinessError(`Line ${index + 1}: description is required`);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new BusinessError(`Line ${index + 1}: invalid quantity`);
      if (!(item.unitPrice > 0)) throw new BusinessError(`Line ${index + 1}: invalid unit price`);
    });
    if (!(input.taxAmount >= 0)) throw new BusinessError('Tax amount cannot be negative');
  }

  private hydrate(row: PoRow): PurchaseOrder {
    const items = this.db
      .prepare('SELECT line_no, description, quantity, unit_price_cents, line_total_cents FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY line_no')
      .all(row.id) as unknown as ItemRow[];
    return {
      poNumber: row.po_number,
      integrationKey: row.integration_key,
      externalReference: row.external_reference,
      supplierCode: row.supplier_code,
      supplierName: row.supplier_name,
      currency: row.currency,
      requiredDate: row.required_date,
      documentNumber: row.document_number,
      subtotalAmount: fromCents(row.subtotal_cents),
      taxAmount: fromCents(row.tax_cents),
      totalAmount: fromCents(row.total_cents),
      createdBy: row.created_by,
      createdAt: row.created_at,
      items: items.map((item) => ({
        lineNo: item.line_no,
        description: item.description,
        quantity: item.quantity,
        unitPrice: fromCents(item.unit_price_cents),
        lineTotal: fromCents(item.line_total_cents),
      })),
    };
  }
}
