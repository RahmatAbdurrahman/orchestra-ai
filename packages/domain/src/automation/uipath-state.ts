/**
 * Normalization of UiPath Orchestrator job states into the small set of
 * states Orchestra reasons about. Orchestrator returns the state as a string
 * (OData) or, in some API versions, as a numeric enum value.
 */
export type NormalizedRobotState = 'PENDING' | 'RUNNING' | 'SUCCESSFUL' | 'FAULTED' | 'STOPPED' | 'UNKNOWN';

const UIPATH_NUMERIC_STATES = [
  'Pending',
  'Running',
  'Stopping',
  'Terminating',
  'Faulted',
  'Successful',
  'Stopped',
  'Suspended',
  'Resumed',
] as const;

export function normalizeUiPathJobState(state: string | number | null | undefined): NormalizedRobotState {
  if (state === null || state === undefined) return 'UNKNOWN';
  const name =
    typeof state === 'number' ? (UIPATH_NUMERIC_STATES[state] ?? '') : String(state).trim();
  switch (name.toLowerCase()) {
    case 'pending':
    case 'resumed':
      return 'PENDING';
    case 'running':
    case 'stopping':
    case 'terminating':
    case 'suspended':
      return 'RUNNING';
    case 'successful':
      return 'SUCCESSFUL';
    case 'faulted':
      return 'FAULTED';
    case 'stopped':
      return 'STOPPED';
    default:
      return 'UNKNOWN';
  }
}

export function isTerminalRobotState(state: NormalizedRobotState): boolean {
  return state === 'SUCCESSFUL' || state === 'FAULTED' || state === 'STOPPED';
}

export interface RobotFaultInfo {
  info?: string | null;
  jobError?: { code?: string | null; category?: string | null; title?: string | null; details?: string | null } | null;
}

export interface RobotFaultClassification {
  code: 'BUSINESS_EXCEPTION' | 'SYSTEM_EXCEPTION';
  retryable: boolean;
  message: string;
}

/**
 * Business exceptions (invalid data, rule violated inside the ERP) are not
 * retryable: running the robot again would fail the same way. System
 * exceptions (application crash, selector timeout) may succeed on retry.
 */
export function classifyRobotFault(fault: RobotFaultInfo): RobotFaultClassification {
  const category = fault.jobError?.category?.toLowerCase() ?? '';
  const text = [fault.info, fault.jobError?.title, fault.jobError?.details, fault.jobError?.code]
    .filter(Boolean)
    .join(' | ');
  const isBusiness = category === 'business' || /businessruleexception|business exception/i.test(text);
  const message = (text || 'The robot job faulted without an error message').slice(0, 2000);
  return isBusiness
    ? { code: 'BUSINESS_EXCEPTION', retryable: false, message }
    : { code: 'SYSTEM_EXCEPTION', retryable: true, message };
}
