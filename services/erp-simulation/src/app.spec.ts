import request from 'supertest';
import { createErpApp } from './app';
import { PurchaseOrderStore } from './store';

function setup() {
  const store = new PurchaseOrderStore(':memory:');
  const { app } = createErpApp({
    store,
    username: 'robot',
    password: 'robot-password',
    apiToken: 'api-token',
    simAdminToken: 'sim-admin',
  });
  return { app, store };
}

async function login(app: ReturnType<typeof setup>['app']) {
  const response = await request(app).post('/login').type('form').send({ username: 'robot', password: 'robot-password' });
  expect(response.status).toBe(303);
  return response.headers['set-cookie']![0]!.split(';')[0]!;
}

const form = {
  supplierCode: 'SUP-001',
  supplierName: 'PT Sinar Jaya Abadi',
  externalReference: 'PR-2026-000001',
  integrationKey: 'oa-po-1',
  currency: 'IDR',
  requiredDate: '2026-12-31',
  taxAmount: '165000',
  item_1_description: 'Laptop stand',
  item_1_quantity: '2',
  item_1_unitPrice: '750000',
};

describe('SimERP web UI', () => {
  it('requires a login', async () => {
    const { app } = setup();
    const response = await request(app).get('/purchase-orders/new');
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/login');
  });

  it('rejects invalid credentials', async () => {
    const { app } = setup();
    const response = await request(app).post('/login').type('form').send({ username: 'robot', password: 'nope' });
    expect(response.status).toBe(401);
    expect(response.text).toContain('login-error');
  });

  it('creates a purchase order from the form and exposes the PO number', async () => {
    const { app, store } = setup();
    const cookie = await login(app);
    const response = await request(app).post('/purchase-orders').set('Cookie', cookie).type('form').send(form);
    expect(response.status).toBe(201);
    expect(response.text).toMatch(/<strong id="result-status">CREATED<\/strong>/);
    expect(response.text).toMatch(/<dd id="po-number">PO-\d{4}-000001<\/dd>/);
    const [order] = store.list();
    expect(order).toMatchObject({ totalAmount: 1_665_000, subtotalAmount: 1_500_000, integrationKey: 'oa-po-1' });
  });

  it('never creates a second purchase order for the same integration key', async () => {
    const { app, store } = setup();
    const cookie = await login(app);
    const first = await request(app).post('/purchase-orders').set('Cookie', cookie).type('form').send(form);
    const second = await request(app).post('/purchase-orders').set('Cookie', cookie).type('form').send(form);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.text).toContain('ALREADY_EXISTS');
    expect(store.list({ integrationKey: 'oa-po-1' })).toHaveLength(1);
    const firstPo = /id="po-number">([^<]+)</.exec(first.text)![1];
    const secondPo = /id="po-number">([^<]+)</.exec(second.text)![1];
    expect(secondPo).toBe(firstPo);
  });

  it('reports business errors for blocked vendors', async () => {
    const { app, store } = setup();
    const cookie = await login(app);
    const response = await request(app)
      .post('/purchase-orders')
      .set('Cookie', cookie)
      .type('form')
      .send({ ...form, supplierCode: 'SUP-006', supplierName: 'PT Mitra Lama Sentosa' });
    expect(response.status).toBe(422);
    expect(response.text).toContain('blocked for purchasing');
    expect(store.list()).toHaveLength(0);
  });

  it('escapes user supplied values in HTML', async () => {
    const { app } = setup();
    const cookie = await login(app);
    const response = await request(app)
      .post('/purchase-orders')
      .set('Cookie', cookie)
      .type('form')
      .send({ ...form, integrationKey: 'k2', supplierCode: '', supplierName: '<script>alert(1)</script>' });
    expect(response.status).toBe(201);
    expect(response.text).not.toContain('<script>alert(1)</script>');
  });
});

describe('SimERP API and simulation controls', () => {
  it('requires the API token', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/purchase-orders')).status).toBe(401);
  });

  it('honours the Idempotency-Key header', async () => {
    const { app } = setup();
    const body = {
      supplierName: 'CV Maju Bersama',
      supplierCode: 'SUP-002',
      currency: 'IDR',
      requiredDate: '2026-12-31',
      items: [{ description: 'Paper', quantity: 10, unitPrice: 50_000 }],
    };
    const first = await request(app).post('/api/purchase-orders').set('Authorization', 'Bearer api-token').set('Idempotency-Key', 'k-1').send(body);
    const second = await request(app).post('/api/purchase-orders').set('Authorization', 'Bearer api-token').set('Idempotency-Key', 'k-1').send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('ALREADY_EXISTS');
    expect(second.body.purchaseOrder.poNumber).toBe(first.body.purchaseOrder.poNumber);
    const list = await request(app).get('/api/purchase-orders?integrationKey=k-1').set('Authorization', 'Bearer api-token');
    expect(list.body.data).toHaveLength(1);
  });

  it('simulates maintenance mode', async () => {
    const { app } = setup();
    await request(app).post('/api/__sim/settings').set('X-Sim-Admin-Token', 'sim-admin').send({ maintenanceMode: true });
    expect((await request(app).get('/login')).status).toBe(503);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
