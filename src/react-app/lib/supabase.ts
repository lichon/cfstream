import { createClient as createSupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js'

export function createClient(options?: SupabaseClientOptions<string>) {
  return createSupabaseClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_KEY!,
    options
  )
}
