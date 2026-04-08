export type FlowStatus = "draft" | "active" | "paused" | "passed" | "failed";
export type HealthStatus = "healthy" | "failing" | "untested";
export type RunStatus =
  | "queued"
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "canceled"
  | "skipped";
export type TriggerType = "manual" | "scheduled" | "retry" | "system";
export type ScheduleFrequency = "hourly" | "daily";
export type StepActionType =
  | "click"
  | "input"
  | "select"
  | "navigate"
  | "wait"
  | "scroll"
  | "KeyPress"
  | "assert";
export type BackoffType = "fixed" | "exponential";

export interface RetryPolicy {
  attempts: number;
  backoffType: BackoffType;
  backoffMs: number;
}

export interface FlowStep {
  id?: string;
  testCaseId?: string;
  sortOrder: number;
  actionType: StepActionType;
  semanticLabel: string;
  selector?: string | null;
  value?: string | null;
  expectedOutcome?: string | null;
  timeoutMs?: number | null;
}

export interface FlowDraftPayload {
  intent: string;
  targetUrl?: string | null;
  executionMode?: string | null;
  healthStatus?: HealthStatus;
  steps: FlowStep[];
}

export interface FlowSummary {
  id: string;
  projectId: string;
  name: string;
  status: FlowStatus;
  runCount: number;
  targetUrl: string | null;
  flowType: string | null;
  lastRunAt: string | null;
  lastPassedAt: string | null;
  lastFailedAt: string | null;
}

export interface FlowDetail extends FlowSummary {
  testCaseId: string;
  intent: string | null;
  executionMode: string | null;
  healthStatus: HealthStatus;
  totalRuns: number;
  draftPayload: FlowDraftPayload | null;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  steps: FlowStep[];
}

export interface FlowVersion {
  id: string;
  flowId: string;
  testCaseId: string;
  versionNumber: number;
  definition: FlowDraftPayload;
  createdBy: string;
  createdAt: string;
}

export interface FlowSchedule {
  id: string;
  flowId: string;
  testCaseId: string;
  frequency: ScheduleFrequency;
  timezone: string;
  minute: number;
  hour: number | null;
  everyHours: number | null;
  enabled: boolean;
  retryPolicy: RetryPolicy;
  environment: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariableRecord {
  id: string;
  projectId: string;
  flowId: string | null;
  name: string;
  cipherText: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariableInput {
  projectId: string;
  flowId?: string | null;
  name: string;
  value: string;
  description?: string | null;
}

export interface DashboardSummary {
  all: number;
  failed: number;
  passed: number;
  notRun: number;
  totalRuns: number;
  recentRuns: number;
}

export interface DashboardProblem {
  flowId: string;
  testCaseId: string;
  flowName: string;
  failureCount: number;
  latestError: string;
  latestFailedAt: string;
}

export interface DashboardInsight {
  type: "never_run" | "stable" | "warning";
  flowId?: string;
  testCaseId?: string;
  title: string;
  description: string;
}

export interface RunRecord {
  id: string;
  flowId: string;
  testCaseId: string;
  projectId: string;
  status: RunStatus;
  triggerType: TriggerType;
  environment: string | null;
  versionId: string | null;
  retryOfRunId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  stepResults: FlowStepResult[];
  screenshotPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowStepResult {
  stepOrder: number;
  actionType: StepActionType;
  semanticLabel: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessage?: string;
  screenshotPath?: string;
  output?: Record<string, unknown>;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  artifactType: "screenshot" | "trace" | "result_json";
  storagePath: string;
  contentType: string;
  createdAt: string;
}

export interface AuthContext {
  userId: string;
  email: string | null;
  spaceIds: string[];
  projectIds: string[];
  roles: string[];
  token: string;
}

export interface RunJobPayload {
  runId: string;
  flowId: string;
  testCaseId: string;
  projectId: string;
  triggerType: TriggerType;
  versionId: string | null;
  environment: string | null;
  idempotencyKey: string;
  retryOfRunId?: string | null;
}

export interface SchedulerJobPayload {
  scheduleId: string;
  flowId: string;
  testCaseId: string;
  projectId: string;
}
