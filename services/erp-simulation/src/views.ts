import type { PurchaseOrder } from './store';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const money = (value: number, currency: string) =>
  `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STYLES = `
  :root { color-scheme: light; --brand:#1f4e79; --line:#d6dbe1; --muted:#5b6673; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Segoe UI, Arial, sans-serif; background:#eef1f4; color:#1d2733; font-size:14px; }
  header { background: var(--brand); color:#fff; padding:10px 20px; display:flex; justify-content:space-between; align-items:center; }
  header .brand { font-weight:600; letter-spacing:.3px; }
  header form { margin:0; }
  main { max-width: 1100px; margin: 20px auto; background:#fff; border:1px solid var(--line); padding:20px; }
  h1 { font-size:18px; margin:0 0 16px; }
  table { width:100%; border-collapse: collapse; }
  th, td { border:1px solid var(--line); padding:6px 8px; text-align:left; }
  th { background:#f4f6f8; }
  label { display:block; font-weight:600; margin-bottom:4px; }
  input, select { width:100%; padding:6px; border:1px solid #9aa5b1; font-size:14px; }
  .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:12px 20px; margin-bottom:16px; }
  .btn { background: var(--brand); color:#fff; border:0; padding:8px 16px; cursor:pointer; font-size:14px; text-decoration:none; display:inline-block; }
  .btn.secondary { background:#5b6673; }
  .notice { padding:10px 12px; border:1px solid; margin-bottom:16px; }
  .notice.ok { background:#e8f5e9; border-color:#7cb342; }
  .notice.warn { background:#fff8e1; border-color:#f9a825; }
  .notice.error { background:#ffebee; border-color:#e53935; }
  dl { display:grid; grid-template-columns: 200px 1fr; gap:6px 12px; }
  dt { font-weight:600; color: var(--muted); }
  .muted { color: var(--muted); }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } main { margin:0; } }
`;

export function layout(title: string, body: string, options: { user?: string | null } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - SimERP</title>
  <style>${STYLES}</style>
</head>
<body>
  <header>
    <span class="brand">SimERP &middot; Procurement</span>
    ${
      options.user
        ? `<form method="post" action="/logout"><span id="current-user">${escapeHtml(options.user)}</span> &nbsp; <button class="btn secondary" id="logout-button" type="submit">Log out</button></form>`
        : ''
    }
  </header>
  <main>${body}</main>
</body>
</html>`;
}

export function loginPage(error?: string): string {
  return layout(
    'Sign in',
    `<h1>Sign in to SimERP</h1>
     ${error ? `<div class="notice error" id="login-error">${escapeHtml(error)}</div>` : ''}
     <form method="post" action="/login" id="login-form" style="max-width:360px">
       <p><label for="username">Username</label><input id="username" name="username" autocomplete="username" required /></p>
       <p><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required /></p>
       <button class="btn" id="login-button" type="submit">Sign in</button>
     </form>`,
  );
}

export function listPage(user: string, orders: PurchaseOrder[]): string {
  const rows = orders
    .map(
      (order) => `<tr>
        <td><a href="/purchase-orders/${encodeURIComponent(order.poNumber)}">${escapeHtml(order.poNumber)}</a></td>
        <td>${escapeHtml(order.externalReference ?? '')}</td>
        <td>${escapeHtml(order.supplierName)}</td>
        <td>${escapeHtml(money(order.totalAmount, order.currency))}</td>
        <td>${escapeHtml(order.requiredDate)}</td>
        <td>${escapeHtml(order.createdBy)}</td>
        <td>${escapeHtml(order.createdAt)}</td>
      </tr>`,
    )
    .join('');
  return layout(
    'Purchase orders',
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
       <h1 style="margin:0">Purchase orders</h1>
       <a class="btn" id="new-po-button" href="/purchase-orders/new">New purchase order</a>
     </div>
     <table id="po-table">
       <thead><tr><th>PO number</th><th>External ref.</th><th>Supplier</th><th>Total</th><th>Required</th><th>Created by</th><th>Created at</th></tr></thead>
       <tbody>${rows || '<tr><td colspan="7" class="muted">No purchase orders yet.</td></tr>'}</tbody>
     </table>`,
    { user },
  );
}

export const ITEM_ROWS = 10;

export function newOrderPage(user: string, vendors: Array<{ code: string; name: string; blocked: boolean }>): string {
  const itemRows = Array.from({ length: ITEM_ROWS }, (_, index) => {
    const n = index + 1;
    return `<tr>
      <td>${n}</td>
      <td><input id="item-${n}-description" name="item_${n}_description" /></td>
      <td><input id="item-${n}-quantity" name="item_${n}_quantity" inputmode="numeric" /></td>
      <td><input id="item-${n}-unitPrice" name="item_${n}_unitPrice" inputmode="decimal" /></td>
    </tr>`;
  }).join('');
  const vendorOptions = vendors
    .map((vendor) => `<option value="${escapeHtml(vendor.code)}">${escapeHtml(vendor.code)} - ${escapeHtml(vendor.name)}${vendor.blocked ? ' (blocked)' : ''}</option>`)
    .join('');
  return layout(
    'New purchase order',
    `<h1>New purchase order</h1>
     <form method="post" action="/purchase-orders" id="po-form">
       <div class="grid">
         <div><label for="supplierCode">Vendor code</label><select id="supplierCode" name="supplierCode"><option value="">(not in vendor master)</option>${vendorOptions}</select></div>
         <div><label for="supplierName">Vendor name</label><input id="supplierName" name="supplierName" required /></div>
         <div><label for="externalReference">External reference (PR number)</label><input id="externalReference" name="externalReference" /></div>
         <div><label for="integrationKey">Integration key</label><input id="integrationKey" name="integrationKey" /></div>
         <div><label for="currency">Currency</label><select id="currency" name="currency"><option>IDR</option><option>USD</option></select></div>
         <div><label for="requiredDate">Required date (YYYY-MM-DD)</label><input id="requiredDate" name="requiredDate" placeholder="2026-12-31" required /></div>
         <div><label for="documentNumber">Supplier document no.</label><input id="documentNumber" name="documentNumber" /></div>
         <div><label for="taxAmount">Tax amount</label><input id="taxAmount" name="taxAmount" inputmode="decimal" value="0" /></div>
       </div>
       <table id="items-table">
         <thead><tr><th style="width:40px">#</th><th>Description</th><th style="width:120px">Quantity</th><th style="width:180px">Unit price</th></tr></thead>
         <tbody>${itemRows}</tbody>
       </table>
       <p style="margin-top:16px"><button class="btn" id="submit-po" type="submit">Create purchase order</button>
       <a class="btn secondary" href="/purchase-orders">Cancel</a></p>
     </form>`,
    { user },
  );
}

export function resultPage(
  user: string,
  result: { status: 'CREATED' | 'ALREADY_EXISTS' | 'ERROR'; message: string; order?: PurchaseOrder },
): string {
  const tone = result.status === 'CREATED' ? 'ok' : result.status === 'ALREADY_EXISTS' ? 'warn' : 'error';
  const machine = {
    status: result.status,
    poNumber: result.order?.poNumber ?? null,
    integrationKey: result.order?.integrationKey ?? null,
    message: result.message,
  };
  return layout(
    'Purchase order result',
    `<h1>Purchase order result</h1>
     <div class="notice ${tone}" id="result-notice">
       <strong id="result-status">${escapeHtml(result.status)}</strong> &mdash; <span id="result-message">${escapeHtml(result.message)}</span>
     </div>
     ${
       result.order
         ? `<dl>
             <dt>PO number</dt><dd id="po-number">${escapeHtml(result.order.poNumber)}</dd>
             <dt>Integration key</dt><dd id="po-integration-key">${escapeHtml(result.order.integrationKey ?? '')}</dd>
             <dt>External reference</dt><dd>${escapeHtml(result.order.externalReference ?? '')}</dd>
             <dt>Vendor</dt><dd>${escapeHtml(result.order.supplierName)}</dd>
             <dt>Total</dt><dd id="po-total">${escapeHtml(money(result.order.totalAmount, result.order.currency))}</dd>
           </dl>`
         : ''
     }
     <script id="po-result" type="application/json">${JSON.stringify(machine).replace(/</g, '\\u003c')}</script>
     <p><a class="btn" href="/purchase-orders" id="back-to-list">Back to purchase orders</a></p>`,
    { user },
  );
}

export function detailPage(user: string, order: PurchaseOrder): string {
  const items = order.items
    .map(
      (item) =>
        `<tr><td>${item.lineNo}</td><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${escapeHtml(money(item.unitPrice, order.currency))}</td><td>${escapeHtml(money(item.lineTotal, order.currency))}</td></tr>`,
    )
    .join('');
  return layout(
    order.poNumber,
    `<h1>${escapeHtml(order.poNumber)}</h1>
     <dl>
       <dt>Vendor</dt><dd>${escapeHtml(order.supplierCode ?? '-')} ${escapeHtml(order.supplierName)}</dd>
       <dt>External reference</dt><dd>${escapeHtml(order.externalReference ?? '-')}</dd>
       <dt>Integration key</dt><dd>${escapeHtml(order.integrationKey ?? '-')}</dd>
       <dt>Supplier document</dt><dd>${escapeHtml(order.documentNumber ?? '-')}</dd>
       <dt>Required date</dt><dd>${escapeHtml(order.requiredDate)}</dd>
       <dt>Subtotal</dt><dd>${escapeHtml(money(order.subtotalAmount, order.currency))}</dd>
       <dt>Tax</dt><dd>${escapeHtml(money(order.taxAmount, order.currency))}</dd>
       <dt>Total</dt><dd>${escapeHtml(money(order.totalAmount, order.currency))}</dd>
       <dt>Created</dt><dd>${escapeHtml(order.createdAt)} by ${escapeHtml(order.createdBy)}</dd>
     </dl>
     <h2 style="font-size:15px;margin-top:20px">Lines</h2>
     <table><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>${items}</tbody></table>
     <p style="margin-top:16px"><a class="btn secondary" href="/purchase-orders">Back</a></p>`,
    { user },
  );
}

export function maintenancePage(): string {
  return layout('Maintenance', '<h1>SimERP is under maintenance</h1><p id="maintenance">Please try again later.</p>');
}
