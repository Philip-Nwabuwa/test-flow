import type { AuthContext } from "@automation/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      supabase?: SupabaseClient;
    }
  }
}

export {};
