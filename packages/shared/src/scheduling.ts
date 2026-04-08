import type { FlowSchedule } from "./types.js";

export function buildCronPattern(schedule: Pick<FlowSchedule, "frequency" | "minute" | "hour" | "everyHours">): string {
  if (schedule.frequency === "daily") {
    const hour = schedule.hour ?? 0;
    return `${schedule.minute} ${hour} * * *`;
  }

  const interval = schedule.everyHours ?? 1;
  return `${schedule.minute} */${interval} * * *`;
}

export function schedulerId(flowId: string, scheduleId: string): string {
  return `schedule:${flowId}:${scheduleId}`;
}
