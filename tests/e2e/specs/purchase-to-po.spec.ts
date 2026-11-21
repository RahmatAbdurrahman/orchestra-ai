/**
 * End-to-end through the web UI: real API, database, worker logic and Python
 * document intelligence; UiPath Orchestrator is the development MOCK whose
 * simulated robot drives the ERP simulation web UI. This is not evidence that
 * the real UiPath process works (see docs/testing.md).
 */
import { expect, test } from '@playwright/test';
import { approveAs, createAndVerifyRequest, erpOrdersForReference, login, setMockScenario } from './helpers';

test('requester to purchase order: extraction, verification, approval and robot execution', async ({ page, request }) => {
  const { url, requestNumber } = await createAndVerifyRequest(page, 'E2E laptop stands', 'invoice-sinar-jaya-idr.pdf');
  await approveAs(page, 'approver.ops@orchestra.local', requestNumber);

  await login(page, 'requester@orchestra.local');
  await page.goto(url);
  await expect(page.getByTestId('po-number')).toHaveText(/^PO-\d{4}-\d{6}$/, { timeout: 60_000 });
  await expect(page.getByTestId('request-status')).toHaveText(/Completed/);

  const orders = await erpOrdersForReference(request, requestNumber);
  expect(orders).toHaveLength(1);
});

test('high value request needs department and finance approval', async ({ page }) => {
  const { url, requestNumber } = await createAndVerifyRequest(page, 'E2E workstations', 'invoice-teknologi-nusantara-idr.pdf');
  await approveAs(page, 'approver.ops@orchestra.local', requestNumber);
  await approveAs(page, 'approver.finance@orchestra.local', requestNumber);
  await page.goto(url);
  await expect(page.getByTestId('po-number')).toBeVisible({ timeout: 60_000 });
});

test('operator retries a failed robot job without creating a duplicate purchase order', async ({ page, request }) => {
  const { url, requestNumber } = await createAndVerifyRequest(page, 'E2E robot crash', 'invoice-sinar-jaya-idr.pdf');
  await setMockScenario(request, 'fault-after-erp');
  await approveAs(page, 'approver.ops@orchestra.local', requestNumber);

  await login(page, 'operator@orchestra.local');
  await page.goto(url);
  await expect(page.getByTestId('request-status')).toHaveText(/Failed/, { timeout: 60_000 });
  await page.getByTestId('retry-button').click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('request-status')).toHaveText(/Completed/, { timeout: 60_000 });

  const orders = await erpOrdersForReference(request, requestNumber);
  expect(orders, 'the retry must reuse the idempotency key').toHaveLength(1);
  await expect(page.getByTestId('po-number')).toHaveText(orders[0]!.poNumber);
});

test('role based navigation hides what a role cannot do (server enforces it regardless)', async ({ page }) => {
  await login(page, 'viewer@orchestra.local');
  await expect(page.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Approvals' })).toHaveCount(0);
  const response = await page.request.get('/api/v1/users');
  expect(response.status()).toBe(403);
});
