# PurchaseOrderAutomation (UiPath process)

Creates a purchase order in **SimERP** (the ERP simulation in `services/erp-simulation`) for a purchase
request that Orchestra AI has approved. Orchestra AI starts the job through the Orchestrator API and
reads the output arguments when the job finishes.

> **Status:** the XAML in this folder was written by hand (well-formed XML, classic UI Automation
> activities, VB expressions) and has **not** been opened, validated or executed in UiPath Studio yet.
> Open it in Studio, let it restore the packages, fix anything the designer flags, run the test cases
> below, then publish. The contract (arguments, assets, selectors) is the part Orchestra AI depends on.

## Contract with Orchestra AI

| Argument | Direction | Description |
|---|---|---|
| `in_ExecutionId` | in | Orchestra automation job id |
| `in_PurchaseRequestId`, `in_RequestNumber`, `in_WorkflowId` | in | Business identifiers |
| `in_CorrelationId` | in | Correlation id for logs |
| `in_IdempotencyKey` | in | Stable per purchase request; typed into the ERP **Integration key** field |
| `in_PurchaseOrderJson` | in | Validated payload: `requestNumber, supplierCode, supplierName, currency, requiredDate, documentNumber, department, taxAmount, totalAmount, items[{lineNo, description, quantity, unitPrice}]` |
| `out_Status` | out | `CREATED`, `ALREADY_EXISTS` (ERP recognised the key; no duplicate) or `BUSINESS_ERROR` |
| `out_PoNumber` | out | `PO-YYYY-NNNNNN` (required unless `BUSINESS_ERROR`) |
| `out_IdempotencyKey` | out | Must echo `in_IdempotencyKey`; Orchestra rejects results that do not match |
| `out_ErpReference`, `out_Message`, `out_ScreenshotPath` | out | Optional details |

Error semantics:

* **Business problem** (ERP rejected the data, vendor blocked): the job ends **Successful** with
  `out_Status = BUSINESS_ERROR`. Orchestra marks the job failed without automatic retries.
* **Technical problem** (selector not found, timeout, ERP down): the workflow takes a screenshot and
  **re-throws**, so the Orchestrator job is **Faulted**. An operator can retry safely because every
  retry sends the same idempotency key.

## Structure

```text
Main.xaml                          entry point: settings, open Chrome, login, create order, error handling
Workflows/InitializeSettings.xaml  Orchestrator assets (URL + credential)
Workflows/LoginToErp.xaml          #username / #password / #login-button
Workflows/CreatePurchaseOrder.xaml form filling, item rows, result screen
Workflows/CaptureScreenshot.xaml   screenshot on failure
Data/Config.json                   assets and selectors reference
Tests/TestArguments.json           Studio test inputs and expected results
```

Main opens Chrome and passes the `Browser` it opened (`in_Browser`) to LoginToErp and CreatePurchaseOrder.
Each of them wraps its steps in **Attach Browser** on that object, and every selector is partial
(`<webctrl id='…' />`, no `<html>` window part). The robot therefore only reads and types in its own
browser, even if other SimERP tabs or windows are open on the machine.

## Orchestrator setup

1. **Folder**: create (or reuse) a modern folder, e.g. `Orchestra AI`. Note its id (Folder settings or
   `GET /odata/Folders`). It becomes `UIPATH_FOLDER_ID` (sent as `X-UIPATH-OrganizationUnitId`).
2. **Assets** in that folder:
   * `ERP_Simulation_Url` (Text) - e.g. `http://localhost:4100` as seen **from the robot machine**.
   * `ERP_Simulation_Credential` (Credential) - the SimERP account (`ERP_USERNAME` / `ERP_PASSWORD`).
3. **Publish** this project from Studio and create a **process** named `PurchaseOrderAutomation`
   (or set `UIPATH_PROCESS_NAME` / the workflow's `processName` to the name you used).
4. **Robot**: an unattended robot (or attended for demos) on a Windows machine with Google Chrome and
   the UiPath browser extension, assigned to the folder. The UiPath Robot cannot run in Docker.
5. **External application** (Admin > External Applications > Add): confidential application with
   application scopes `OR.Jobs`, `OR.Execution.Read`, `OR.Folders.Read` (add `OR.Robots.Read` /
   `OR.Monitoring` if you extend the health check). Copy the App ID / App Secret into
   `UIPATH_CLIENT_ID` / `UIPATH_CLIENT_SECRET` on the Orchestra API **and worker** (server-side only).

See `docs/uipath-integration.md` for the full Orchestra configuration and the API calls made.

## Test cases (run in Studio)

Use `Tests/TestArguments.json`:

| Case | Expected |
|---|---|
| Valid payload | `CREATED`, PO number returned |
| Same payload again (same key) | `ALREADY_EXISTS`, **same** PO number, no new order in SimERP |
| Invalid input (unsupported currency) | `BUSINESS_ERROR`, job Successful |
| Missing fields (empty item list) | `BUSINESS_ERROR` |
| Application timeout (`responseDelayMs`) | job Faulted, screenshot saved |
| Application down (`maintenanceMode`) | job Faulted at login |
| Robot unavailable (no robot connected) | job stays Pending; Orchestra stops it after the workflow's pending timeout and resubmits automatically |

The ERP simulation exposes `POST /api/__sim/settings` (header `X-Sim-Admin-Token`) to switch on
maintenance mode or add latency for these tests.
