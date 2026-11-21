# UiPath integration

Orchestra AI decides **whether and what** to automate; UiPath Orchestrator manages **how** the robot
job runs (SAD §13). The adapter is `packages/uipath-client` (`UiPathOrchestratorClient`), used by the
worker (execution) and the API (health check).

## API calls made

| Purpose | Call |
|---|---|
| Token | `POST {identity}/connect/token` — `grant_type=client_credentials`, `client_id`, `client_secret`, `scope` |
| Resolve process | `GET {orchestrator}/odata/Releases?$filter=Name eq '{process}'` → `Key` (cached 5 min) |
| Start job | `POST {orchestrator}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs` with `startInfo { ReleaseKey, Strategy: "ModernJobsCount", JobsCount: 1, InputArguments, Reference }` |
| Find by reference | `GET {orchestrator}/odata/Jobs?$filter=Reference eq '{reference}'&$orderby=CreationTime desc&$top=1` |
| Status / result | `GET {orchestrator}/odata/Jobs({id})` → `State`, `Info`, `JobError`, `OutputArguments` |
| Stop | `POST {orchestrator}/odata/Jobs/UiPath.Server.Configuration.OData.StopJobs` `{ jobIds, strategy }` |

Every folder-scoped call sends `X-UIPATH-OrganizationUnitId: {UIPATH_FOLDER_ID}`. A `401` refreshes the
token once. Errors are classified (`AUTHENTICATION`, `AUTHORIZATION`, `NOT_FOUND`, `RATE_LIMITED`,
`SERVER`, `TIMEOUT`, `NETWORK`, `ROBOT_UNAVAILABLE`, `PROCESS_NOT_FOUND`, …) with `retryable` and
`ambiguous` flags that drive the retry policy in [architecture.md](architecture.md#retry-policy).

State normalisation: `Pending`/`Resumed` → PENDING; `Running`/`Stopping`/`Terminating`/`Suspended` →
RUNNING; `Successful` → SUCCESSFUL; `Faulted` → FAULTED; `Stopped` → STOPPED (numeric states supported).

## Configuration

Set on **both** the API and the worker (server-side only; never exposed to the browser):

| Variable | Automation Cloud | On-premises |
|---|---|---|
| `UIPATH_MODE` | `cloud` | `onprem` |
| `UIPATH_ORCHESTRATOR_URL` | `https://cloud.uipath.com/{organization}/{tenant}/orchestrator_` | `https://orchestrator.example.com` |
| `UIPATH_IDENTITY_URL` | `https://cloud.uipath.com/identity_/connect/token` (default) | `https://orchestrator.example.com/identity/connect/token` (default) |
| `UIPATH_CLIENT_ID` / `UIPATH_CLIENT_SECRET` | External Application (confidential) | same |
| `UIPATH_SCOPES` | `OR.Jobs OR.Execution.Read OR.Folders.Read` | same |
| `UIPATH_FOLDER_ID` | folder (organization unit) id | same |
| `UIPATH_PROCESS_NAME` | `PurchaseOrderAutomation` | same |
| `UIPATH_RUNTIME_TYPE` | optional, e.g. `Unattended` | optional |
| `UIPATH_REQUEST_TIMEOUT_MS` | default 15000 | default 15000 |

Per-workflow settings (admin UI → *Workflows*): process name, automatic vs. manual dispatch,
`maxAutoAttempts`, `maxTotalAttempts`, `pendingTimeoutMinutes`, `executionTimeoutMinutes`.

Checklist before going live (SAD §19):

1. Licences: unattended robot (or attended for demos), API access for External Applications.
2. Create the External Application with the scopes above (least privilege).
3. Publish `uipath/PurchaseOrderAutomation` and create the process in the folder; add the assets
   `ERP_Simulation_Url` and `ERP_Simulation_Credential` (see the project README).
4. The robot machine must reach SimERP (`ERP_Simulation_Url`, e.g. `http://<docker-host>:4100`).
   The robot runs on Windows, not in Docker.
5. The Orchestra worker must reach Orchestrator over HTTPS.
6. Admin → *Integrations* → **Test connection** must show authenticated, folder accessible and process found.
7. Run the Studio test cases (`uipath/PurchaseOrderAutomation/Tests/TestArguments.json`), then one
   request end to end, then the failure cases (ERP maintenance mode, robot offline).

## Output contract

The worker accepts a finished job only if `OutputArguments` validates against
`robotOutputSchema` (`packages/domain/src/automation/robot-contract.ts`):

* `out_Status` ∈ `CREATED | ALREADY_EXISTS | BUSINESS_ERROR`;
* `out_PoNumber` matches `PO-YYYY-NNNNNN` unless `BUSINESS_ERROR`;
* `out_IdempotencyKey` equals the job's idempotency key.

Anything else fails the job with `INVALID_ROBOT_OUTPUT` (verify the ERP before retrying).

## The development mock

`services/uipath-orchestrator-mock` implements the calls above and a simulated robot that logs in to
SimERP, fills the same form fields the UiPath process uses and reads the result page. It exists so the
whole flow can be demonstrated and tested without a UiPath licence. **Results obtained with the mock are
not evidence that the real UiPath process works.** The UI labels the integration as *MOCK* whenever
`UIPATH_MODE=mock`.

Failure injection (header `X-Mock-Admin-Token`):

```bash
curl -X POST http://localhost:4200/__mock/scenarios -H "X-Mock-Admin-Token: dev-mock-admin-change-me" -H "Content-Type: application/json" -d "{\"mode\":\"submit-timeout\",\"count\":1}"
```

| Mode | Simulates |
|---|---|
| `success` | default |
| `fault` | robot faults with a selector error |
| `fault-after-erp` | robot crashes after SimERP accepted the order (tests duplicate prevention on retry) |
| `business-error` | robot reports `BUSINESS_ERROR` |
| `robot-unavailable` | job stays `Pending` until stopped |
| `submit-timeout` | job is created but the `StartJobs` response arrives too late |
| `submit-error` | `StartJobs` returns 500 and creates nothing |
