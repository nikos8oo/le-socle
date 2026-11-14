import { supabase } from './supabase'

// Appelle la fonction serveur Stripe et renvoie un message d'erreur lisible
export async function stripeApi(action, params = {}) {
  const { data, error } = await supabase.functions.invoke('stripe-api', { body: { action, return_url: window.location.origin, ...params } })
  if (error) {
    let msg = error.message
    try { const j = await error.context.json(); if (j && j.error) msg = j.error } catch { /* réponse non JSON */ }
    throw new Error(msg)
  }
  if (data && data.error) throw new Error(data.error)
  return data
}
