import Stripe from 'npm:stripe@17.7.0'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

export const API_VERSION = '2024-06-20'
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
export const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

export async function secret(envName: string, vaultName: string): Promise<string | null> {
  const v = Deno.env.get(envName)
  if (v) return v
  const { data } = await admin.rpc('platform_secret', { secret_name: vaultName })
  return (data as string) || null
}

let client: Stripe | null = null
export async function stripe(): Promise<Stripe> {
  if (client) return client
  const key = await secret('STRIPE_SECRET_KEY', 'stripe_secret_key')
  if (!key) throw new Error('Clé Stripe non configurée')
  client = new Stripe(key, { apiVersion: API_VERSION as Stripe.LatestApiVersion, httpClient: Stripe.createFetchHttpClient() })
  return client
}
export { Stripe }
