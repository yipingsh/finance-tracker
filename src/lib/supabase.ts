import { createClient } from '@supabase/supabase-js'

// Only public values reach the browser: the project URL and the publishable key.
// Everything privileged (service-role key, Anthropic key) stays in Edge Function secrets.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

export type Quota = {
  uploads_used: number
  uploads_limit: number
  insights_used: number
  insights_limit: number
  service_available: boolean
}

export async function getMyQuota(): Promise<Quota> {
  const { data, error } = await supabase.rpc('get_my_quota').single<Quota>()
  if (error) throw error
  return data
}
