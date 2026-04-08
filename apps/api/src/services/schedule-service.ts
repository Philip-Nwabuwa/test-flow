import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Queue } from "bullmq";

import {
  buildCronPattern,
  schedulerId,
  throwIfError,
  type AuthContext,
  type FlowSchedule,
  type RunJobPayload
} from "@automation/shared";

import { HttpError } from "../lib/http.js";

export class ScheduleService {
  constructor(private readonly queue: Queue<RunJobPayload>) {}

  async list(supabase: SupabaseClient, auth: AuthContext, flowId: string): Promise<FlowSchedule[]> {
    await this.assertFlowAccess(supabase, auth, flowId);

    const { data, error } = await supabase
      .from("flow_schedules")
      .select("*")
      .eq("flow_id", flowId)
      .order("created_at", { ascending: false });

    throwIfError({ data, error });

    return (data ?? []).map(mapSchedule);
  }

  async create(
    supabase: SupabaseClient,
    auth: AuthContext,
    flowId: string,
    input: {
      frequency: FlowSchedule["frequency"];
      timezone: string;
      minute: number;
      hour?: number | null;
      everyHours?: number | null;
      environment?: string | null;
      enabled: boolean;
      retryPolicy: FlowSchedule["retryPolicy"];
    }
  ) {
    const flow = await this.assertFlowAccess(supabase, auth, flowId);
    const id = randomUUID();

    const { data, error } = await supabase
      .from("flow_schedules")
      .insert({
        id,
        flow_id: flowId,
        test_case_id: flow.testCaseId,
        frequency: input.frequency,
        timezone: input.timezone,
        minute: input.minute,
        hour: input.hour ?? null,
        every_hours: input.everyHours ?? null,
        enabled: input.enabled,
        retry_policy: input.retryPolicy,
        environment: input.environment ?? null
      })
      .select("*")
      .single();

    throwIfError({ data, error });

    const schedule = mapSchedule(data);
    await this.syncScheduler(schedule, flow.projectId);
    return schedule;
  }

  async update(
    supabase: SupabaseClient,
    auth: AuthContext,
    scheduleId: string,
    input: Partial<FlowSchedule>
  ): Promise<FlowSchedule> {
    // Fetch current schedule with project access check
    const { data: current, error: findError } = await supabase
      .from("flow_schedules")
      .select("*, test_flows!inner(project_id)")
      .eq("id", scheduleId)
      .single();

    const testFlows = current?.test_flows as unknown as { project_id: string } | undefined;
    if (findError || !current || !testFlows || !auth.projectIds.includes(testFlows.project_id)) {
      throw new HttpError(404, "Schedule not found");
    }

    const projectId = testFlows.project_id;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.frequency !== undefined) updates.frequency = input.frequency;
    if (input.timezone !== undefined) updates.timezone = input.timezone;
    if (input.minute !== undefined) updates.minute = input.minute;
    if (input.hour !== undefined) updates.hour = input.hour;
    if (input.everyHours !== undefined) updates.every_hours = input.everyHours;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.retryPolicy !== undefined) updates.retry_policy = input.retryPolicy;
    if (input.environment !== undefined) updates.environment = input.environment;

    const { data, error } = await supabase
      .from("flow_schedules")
      .update(updates)
      .eq("id", scheduleId)
      .select("*")
      .single();

    throwIfError({ data, error });

    const schedule = mapSchedule(data);
    await this.syncScheduler(schedule, projectId);
    return schedule;
  }

  async pause(supabase: SupabaseClient, auth: AuthContext, scheduleId: string) {
    return this.update(supabase, auth, scheduleId, { enabled: false });
  }

  async resume(supabase: SupabaseClient, auth: AuthContext, scheduleId: string) {
    return this.update(supabase, auth, scheduleId, { enabled: true });
  }

  async remove(supabase: SupabaseClient, auth: AuthContext, scheduleId: string): Promise<void> {
    // Fetch schedule with project check before deleting
    const { data: current, error: findError } = await supabase
      .from("flow_schedules")
      .select("flow_id, test_flows!inner(project_id)")
      .eq("id", scheduleId)
      .single();

    const testFlowsForRemove = current?.test_flows as unknown as { project_id: string } | undefined;
    if (findError || !current || !testFlowsForRemove || !auth.projectIds.includes(testFlowsForRemove.project_id)) {
      throw new HttpError(404, "Schedule not found");
    }

    const { error } = await supabase
      .from("flow_schedules")
      .delete()
      .eq("id", scheduleId);

    if (error) {
      throw new Error(`Failed to delete schedule: ${error.message}`);
    }

    await this.queue.removeJobScheduler(schedulerId(current.flow_id, scheduleId));
  }

  async reconcile(supabase: SupabaseClient): Promise<void> {
    const result = await supabase.rpc("rpc_get_schedules_with_project");
    const schedules = throwIfError(result) as (FlowSchedule & { project_id: string })[];

    for (const schedule of schedules ?? []) {
      await this.syncScheduler(schedule, schedule.project_id);
    }
  }

  private async assertFlowAccess(supabase: SupabaseClient, auth: AuthContext, flowId: string) {
    const { data, error } = await supabase
      .from("test_flows")
      .select("id, project_id, test_cases!inner(id)")
      .eq("id", flowId)
      .in("project_id", auth.projectIds)
      .single();

    if (error || !data) {
      throw new HttpError(404, "Flow not found");
    }

    const testCase = Array.isArray(data.test_cases) ? data.test_cases[0] : data.test_cases;

    return {
      flowId: data.id,
      projectId: data.project_id,
      testCaseId: testCase.id
    };
  }

  private async syncScheduler(schedule: FlowSchedule, projectId: string) {
    const repeatOptions = {
      pattern: buildCronPattern(schedule),
      tz: schedule.timezone
    };

    if (!schedule.enabled) {
      await this.queue.removeJobScheduler(schedulerId(schedule.flowId, schedule.id));
      return;
    }

    await this.queue.upsertJobScheduler(
      schedulerId(schedule.flowId, schedule.id),
      repeatOptions,
      {
        name: "scheduled-flow-run",
        data: {
          runId: "",
          flowId: schedule.flowId,
          testCaseId: schedule.testCaseId,
          projectId,
          triggerType: "scheduled",
          versionId: null,
          environment: schedule.environment,
          idempotencyKey: schedulerId(schedule.flowId, schedule.id)
        },
        opts: {
          attempts: schedule.retryPolicy.attempts,
          backoff: {
            type: schedule.retryPolicy.backoffType,
            delay: schedule.retryPolicy.backoffMs
          }
        }
      }
    );
  }
}

function mapSchedule(row: Record<string, unknown>): FlowSchedule {
  return {
    id: String(row.id),
    flowId: String(row.flow_id),
    testCaseId: String(row.test_case_id),
    frequency: row.frequency as FlowSchedule["frequency"],
    timezone: String(row.timezone),
    minute: Number(row.minute),
    hour: row.hour != null ? Number(row.hour) : null,
    everyHours: row.every_hours != null ? Number(row.every_hours) : null,
    enabled: Boolean(row.enabled),
    retryPolicy: row.retry_policy as FlowSchedule["retryPolicy"],
    environment: row.environment as string | null,
    nextRunAt: row.next_run_at as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
