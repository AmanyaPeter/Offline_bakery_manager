import { createClient } from "@supabase/supabase-js";
import type { Transport } from "./sync";
const env = (import.meta as any).env;
export const supabase =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
export async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase)
    throw new Error("Supabase is not configured. Follow the deployment guide.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const transport: Transport = {
  push: (events) => rpc("push_events", { batch: events }),
  pull: (cursor) => rpc("pull_events", { after_seq: cursor }),
};
