import type { NormalizedRobotState } from '@orchestra/domain';

export interface StartJobInput {
  /** UiPath process (release) name in the configured folder. */
  processName: string;
  /** Unique per attempt; used to find the job again after an ambiguous failure. */
  reference: string;
  inputArguments: Record<string, unknown>;
}

export interface StartJobResult {
  jobId: string;
  jobKey: string | null;
  state: NormalizedRobotState;
  rawState: string | null;
}

export interface RobotJobError {
  code: string | null;
  category: string | null;
  title: string | null;
  details: string | null;
}

export interface JobStatusResult {
  jobId: string;
  jobKey: string | null;
  reference: string | null;
  state: NormalizedRobotState;
  rawState: string | null;
  creationTime: string | null;
  startTime: string | null;
  endTime: string | null;
  info: string | null;
  jobError: RobotJobError | null;
  hostMachineName: string | null;
}

export interface JobResult extends JobStatusResult {
  /** Parsed OutputArguments (null when the job produced none). */
  outputArguments: Record<string, unknown> | null;
  /** Raw OutputArguments string as returned by Orchestrator. */
  rawOutputArguments: string | null;
}

export interface RpaHealthResult {
  ok: boolean;
  configured: boolean;
  mode: 'cloud' | 'onprem' | 'mock';
  authenticated: boolean;
  folderAccessible: boolean;
  processFound: boolean;
  processName: string;
  latencyMs: number;
  checkedAt: string;
  message: string | null;
}

/**
 * Internal abstraction over the RPA engine used by the automation worker.
 * The only implementation is UiPath; the interface exists to keep the
 * worker testable, not to support other RPA engines.
 */
export interface RpaExecutionProvider {
  startJob(input: StartJobInput): Promise<StartJobResult>;
  getJobStatus(jobId: string): Promise<JobStatusResult>;
  getJobResult(jobId: string): Promise<JobResult>;
  findJobByReference(reference: string): Promise<JobStatusResult | null>;
  stopJob(jobId: string, strategy?: 'SoftStop' | 'Kill'): Promise<void>;
  healthCheck(options?: { processName?: string; forceTokenRefresh?: boolean }): Promise<RpaHealthResult>;
}
