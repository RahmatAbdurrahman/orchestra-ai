import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Orchestra#2026';
export const SAMPLES = path.resolve(__dirname, '../../../samples/invoices');

export async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Requester creates a request with a sample invoice and verifies the extracted data. Returns the request URL. */
export async function createAndVerifyRequest(page: Page, title: string, invoice: string): Promise<{ url: string; requestNumber: string }> {
  await login(page, 'requester@orchestra.local');
  await page.goto('/requests/new');
  await page.getByLabel('Title').fill(title);
  await page.getByTestId('document-input').setInputFiles(path.join(SAMPLES, invoice));
  await page.getByRole('button', { name: 'Create & submit' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  const url = page.url();
  const requestNumber = (await page.getByTestId('request-number').textContent())!.trim();

  // Document intelligence runs in the background; the form appears when it finishes.
  const form = page.getByTestId('verification-form');
  await expect(form).toBeVisible({ timeout: 60_000 });
  // The sample invoices are reused across runs; a unique invoice number avoids the duplicate-invoice rule.
  await form.getByLabel('Invoice number').fill(`E2E-${Date.now()}`);
  for (const checkbox of await form.getByRole('checkbox').all()) {
    if ((await checkbox.getAttribute('data-state')) !== 'checked') await checkbox.click();
  }
  await page.getByTestId('verify-submit').click();
  await expect(page.getByTestId('request-status')).toHaveText(/Pending Approval/);
  return { url, requestNumber };
}

export async function approveAs(page: Page, email: string, requestNumber: string): Promise<void> {
  await login(page, email);
  await page.goto('/approvals');
  const card = page.getByTestId('pending-approval').filter({ hasText: requestNumber });
  await expect(card).toBeVisible();
  await card.getByTestId('approve-button').click();
  await page.getByTestId('approve-dialog').getByLabel('Comment (optional)').fill(`Approved by ${email} (e2e)`);
  await page.getByTestId('confirm-action').click();
  await expect(card).toHaveCount(0);
}

export async function setMockScenario(request: APIRequestContext, mode: string, count = 1): Promise<void> {
  const url = process.env.UIPATH_ORCHESTRATOR_URL ?? 'http://localhost:4200';
  const response = await request.post(`${url}/__mock/scenarios`, {
    headers: { 'X-Mock-Admin-Token': process.env.UIPATH_MOCK_ADMIN_TOKEN ?? '' },
    data: { mode, count },
  });
  expect(response.status(), 'the UiPath Orchestrator MOCK must be running for this test').toBe(201);
}

export async function erpOrdersForReference(request: APIRequestContext, requestNumber: string) {
  const url = process.env.ERP_SIMULATION_URL ?? 'http://localhost:4100';
  const response = await request.get(`${url}/api/purchase-orders`, {
    headers: { Authorization: `Bearer ${process.env.ERP_API_TOKEN ?? ''}` },
    params: { externalReference: requestNumber },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { data: Array<{ poNumber: string; integrationKey: string }> }).data;
}
