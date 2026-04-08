import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type AuthContext, type VariableInput, type VariableRecord, throwIfError } from "@automation/shared";

import { encrypt } from "../lib/crypto.js";
import { HttpError } from "../lib/http.js";

export class VariableService {
  constructor(private readonly encryptionKey: string) {}

  async list(supabase: SupabaseClient, auth: AuthContext): Promise<Omit<VariableRecord, "cipherText">[]> {
    const { data, error } = await supabase
      .from("flow_variables")
      .select("id, project_id, flow_id, name, description, created_at, updated_at")
      .in("project_id", auth.projectIds)
      .order("updated_at", { ascending: false });

    throwIfError({ data, error });

    return (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      flowId: row.flow_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async create(
    supabase: SupabaseClient,
    auth: AuthContext,
    input: VariableInput
  ): Promise<Omit<VariableRecord, "cipherText">> {
    if (!auth.projectIds.includes(input.projectId)) {
      throw new HttpError(403, "Project access denied");
    }

    const id = randomUUID();
    const cipherText = encrypt(this.encryptionKey, input.value);

    const { data, error } = await supabase
      .from("flow_variables")
      .insert({
        id,
        project_id: input.projectId,
        flow_id: input.flowId ?? null,
        name: input.name,
        cipher_text: cipherText,
        description: input.description ?? null
      })
      .select("id, project_id, flow_id, name, description, created_at, updated_at")
      .single();

    const row = throwIfError({ data, error });

    return {
      id: row!.id,
      projectId: row!.project_id,
      flowId: row!.flow_id,
      name: row!.name,
      description: row!.description,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at
    };
  }

  async update(
    supabase: SupabaseClient,
    auth: AuthContext,
    variableId: string,
    input: Partial<VariableInput>
  ): Promise<Omit<VariableRecord, "cipherText">> {
    const { data: current, error: findError } = await supabase
      .from("flow_variables")
      .select("project_id")
      .eq("id", variableId)
      .single();

    if (findError || !current || !auth.projectIds.includes(current.project_id)) {
      throw new HttpError(404, "Variable not found");
    }

    const cipherText = input.value ? encrypt(this.encryptionKey, input.value) : undefined;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (cipherText) updates.cipher_text = cipherText;
    if (input.flowId !== undefined) updates.flow_id = input.flowId;

    const { data, error } = await supabase
      .from("flow_variables")
      .update(updates)
      .eq("id", variableId)
      .select("id, project_id, flow_id, name, description, created_at, updated_at")
      .single();

    const row = throwIfError({ data, error });

    return {
      id: row!.id,
      projectId: row!.project_id,
      flowId: row!.flow_id,
      name: row!.name,
      description: row!.description,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at
    };
  }

  async remove(supabase: SupabaseClient, auth: AuthContext, variableId: string): Promise<void> {
    const { data, error } = await supabase
      .from("flow_variables")
      .delete()
      .eq("id", variableId)
      .in("project_id", auth.projectIds)
      .select("id")
      .single();

    if (error || !data) {
      throw new HttpError(404, "Variable not found");
    }
  }
}
