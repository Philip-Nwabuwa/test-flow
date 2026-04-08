import { z } from "zod";

import type { StepActionType } from "./types.js";

export const retryPolicySchema = z.object({
  attempts: z.number().int().min(1).max(10),
  backoffType: z.enum(["fixed", "exponential"]),
  backoffMs: z.number().int().min(0).max(3_600_000)
});

export const stepActionTypeSchema = z.custom<StepActionType>((value) => {
  return [
    "click",
    "input",
    "select",
    "navigate",
    "wait",
    "scroll",
    "KeyPress",
    "assert"
  ].includes(String(value));
}, "Unsupported step action type");

export const flowStepSchema = z.object({
  id: z.string().uuid().optional(),
  testCaseId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0),
  actionType: stepActionTypeSchema,
  semanticLabel: z.string().min(1).max(255),
  selector: z.string().max(500).nullish(),
  value: z.string().max(4_000).nullish(),
  expectedOutcome: z.string().max(4_000).nullish(),
  timeoutMs: z.number().int().min(0).max(300_000).nullish()
});

export const flowDraftPayloadSchema = z.object({
  intent: z.string().min(1).max(2_000),
  targetUrl: z.string().url().nullish(),
  executionMode: z.string().max(100).nullish(),
  healthStatus: z.enum(["healthy", "failing", "untested"]).optional(),
  steps: z.array(flowStepSchema).min(1)
});

export const flowCreateSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  targetUrl: z.string().url().optional(),
  flowType: z.string().max(100).optional(),
  draft: flowDraftPayloadSchema
});

export const flowUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["draft", "active", "paused", "passed", "failed"]).optional(),
  targetUrl: z.string().url().nullish(),
  flowType: z.string().max(100).nullish(),
  intent: z.string().max(2_000).nullish(),
  healthStatus: z.enum(["healthy", "failing", "untested"]).optional()
});

export const runCreateSchema = z.object({
  versionId: z.string().uuid().nullish(),
  environment: z.string().max(100).nullish(),
  idempotencyKey: z.string().min(8).max(200).optional(),
  reason: z.string().max(500).optional()
});

const scheduleBaseSchema = z.object({
  frequency: z.enum(["hourly", "daily"]),
  timezone: z.string().min(1).max(100),
  minute: z.number().int().min(0).max(59),
  hour: z.number().int().min(0).max(23).nullish(),
  everyHours: z.number().int().min(1).max(24).nullish(),
  environment: z.string().max(100).nullish(),
  enabled: z.boolean().default(true),
  retryPolicy: retryPolicySchema
});

export const scheduleSchema = scheduleBaseSchema
  .superRefine((value, ctx) => {
    if (value.frequency === "daily" && typeof value.hour !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Daily schedules require an hour"
      });
    }

    if (value.frequency === "hourly" && typeof value.everyHours !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hourly schedules require everyHours"
      });
    }
  });

export const scheduleUpdateSchema = scheduleBaseSchema.partial();

export const variableSchema = z.object({
  projectId: z.string().uuid(),
  flowId: z.string().uuid().nullish(),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Z0-9_]+$/, "Variables must be upper snake case"),
  value: z.string().min(1).max(4_000),
  description: z.string().max(500).nullish()
});
