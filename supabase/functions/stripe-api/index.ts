// Paiement en ligne : inscription Stripe des salles, paiement des formules, espace client.
import { Stripe, admin, cors, json, secret, stripe, API_VERSION } from '../_shared/stripe.ts'

const FEE = Number(Deno.env.get('PLATFORM_FEE_PERCENT') || 0) // commission de la plateforme, en %
const INTERVAL: Record<string, { interval: 'month' | 'year'; interval_count: number }> = {
  mois: { interval: 'month', interval_count: 1 },
  trimestre: { interval: 'month', interval_count: 3 },
  annee: { interval: 'year', interval_count: 1 },
}

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg) } }

async function roleIn(boxId: string, uid: string): Promise<string | null> {
  const { data: adm } = await admin.from('platform_admins').select('user_id').eq('user_id', uid)
  if (adm && adm.length) return 'admin'
  const { data } = await admin.from('box_members').select('role').eq('box_id', boxId).eq('user_id', uid).maybeSingle()
  return data ? data.role : null
}
async function getBox(boxId: string) {
  const { data } = await admin.from('boxes').select('*').eq('id', boxId).single()
  if (!data) throw new HttpError(404, 'Salle introuvable')
  return data
}
function safeReturn(url: unknown): string {
  const u = new URL(String(url || ''))
  if (!['https:', 'http:'].includes(u.protocol)) throw new HttpError(400, 'Adresse de retour invalide')
  return u.origin
}

// API Stripe v2 (comptes des salles) : obligatoire pour les nouvelles plateformes Connect
const V2_VERSION = '2026-10-28.endive'
async function v2(method: string, path: string, body?: unknown) {
  const key = (await secret('STRIPE_SECRET_KEY', 'stripe_secret_key'))!
  const res = await fetch('https://api.stripe.com' + path, {
    method, headers: { Authorization: 'Bearer ' + key, 'Stripe-Version': V2_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await res.json()
  if (!res.ok) throw new HttpError(400, 'Stripe : ' + ((j.error && (j.error.user_message || j.error.message)) || res.status))
  return j
}

async function syncAccount(box: { id: string; stripe_account_id: string }) {
  const acct = await v2('GET', '/v2/core/accounts/' + box.stripe_account_id + '?include=configuration.merchant&include=requirements')
  const cap = acct.configuration?.merchant?.capabilities?.card_payments || {}
  const card = cap.status as string | undefined
  const patch = { stripe_charges_enabled: card === 'active', stripe_details_submitted: card === 'active' || card === 'pending' }
  await admin.from('boxes').update(patch).eq('id', box.id)
  const entries = (acct.requirements && acct.requirements.entries) || []
  const missing = entries.filter((e: { minimum_deadline?: { status?: string } }) => e.minimum_deadline && ['currently_due', 'past_due'].includes(e.minimum_deadline.status || '')).length
  return { ...patch, card_status: card || 'inconnu', missing, details: (cap.status_details || []).map((d: { code: string }) => d.code) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) throw new HttpError(401, 'Connexion requise')
    const body = await req.json().catch(() => ({}))
    const s = await stripe()

    switch (body.action) {
      // ---------- Owner : relier la salle à Stripe ----------
      case 'connect': {
        const box = await getBox(body.box_id)
        const role = await roleIn(box.id, user.id)
        if (role !== 'owner' && role !== 'admin') throw new HttpError(403, "Réservé à l'owner")
        let acctId = box.stripe_account_id
        if (!acctId) {
          // Plateforme française : l'identité (nom, e-mail…) est saisie par l'owner pendant l'inscription Stripe
          const acct = await v2('POST', '/v2/core/accounts', {
            dashboard: 'full', identity: { country: 'fr' },
            defaults: { currency: 'eur', locales: ['fr-FR'], responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
            configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
            metadata: { box_id: box.id, box_name: box.name },
          })
          acctId = acct.id
          await admin.from('boxes').update({ stripe_account_id: acctId }).eq('id', box.id)
        }
        const origin = safeReturn(body.return_url)
        const link = await v2('POST', '/v2/core/account_links', {
          account: acctId,
          use_case: { type: 'account_onboarding', account_onboarding: { refresh_url: origin + '/?stripe=refresh', return_url: origin + '/?stripe=retour' } },
        })
        return json({ url: link.url })
      }
      case 'status': {
        const box = await getBox(body.box_id)
        const role = await roleIn(box.id, user.id)
        if (!role || role === 'adherent') throw new HttpError(403, 'Accès refusé')
        if (!box.stripe_account_id) return json({ connected: false })
        return json({ connected: true, ...(await syncAccount(box)) })
      }

      // ---------- Admin plateforme : détacher le compte Stripe d'une salle (ex. compte de test) ----------
      case 'disconnect': {
        const { data: adm } = await admin.from('platform_admins').select('user_id').eq('user_id', user.id)
        if (!adm || !adm.length) throw new HttpError(403, 'Réservé à l’administrateur')
        const box = await getBox(body.box_id)
        if (box.stripe_account_id && body.close) {
          try { await v2('POST', '/v2/core/accounts/' + box.stripe_account_id + '/close', { applied_configurations: ['merchant'] }) } catch (_) { /* compte déjà fermé ou non fermable */ }
        }
        await admin.from('boxes').update({ stripe_account_id: null, stripe_charges_enabled: false, stripe_details_submitted: false }).eq('id', box.id)
        await admin.from('members').update({ stripe_customer_id: null }).eq('box_id', box.id)
        return json({ ok: true })
      }

      // ---------- Athlète : payer une formule ----------
      case 'checkout': {
        const { data: plan } = await admin.from('plans').select('*').eq('id', body.plan_id).single()
        if (!plan || !plan.active || !plan.for_sale) throw new HttpError(400, 'Formule indisponible')
        if (!plan.price_cents) throw new HttpError(400, 'Cette formule n’a pas de prix')
        const box = await getBox(plan.box_id)
        if (!box.booking_module) throw new HttpError(400, 'Cette salle n’utilise pas la réservation dans Le Socle')
        if (!box.stripe_account_id || !box.stripe_charges_enabled) throw new HttpError(400, 'Le paiement en ligne n’est pas encore activé dans cette salle')
        if ((await roleIn(box.id, user.id)) !== 'adherent') throw new HttpError(403, 'Réservé aux adhérents de la salle')
        const { data: member } = await admin.from('members').select('*').eq('box_id', box.id).eq('user_id', user.id).single()
        if (!member || !member.active) throw new HttpError(403, 'Compte adhérent suspendu')
        const opts = { stripeAccount: box.stripe_account_id }

        let customer = member.stripe_customer_id
        if (!customer) {
          const c = await s.customers.create({ email: member.email || user.email || undefined, name: member.name, metadata: { member_id: member.id, box_id: box.id } }, opts)
          customer = c.id
          await admin.from('members').update({ stripe_customer_id: customer }).eq('id', member.id)
        }

        const today = new Date().toISOString().slice(0, 10)
        const { data: sub, error } = await admin.from('subscriptions').insert({
          box_id: box.id, member_id: member.id, plan_id: plan.id, name: plan.name, kind: plan.kind,
          per_week: plan.per_week, sessions: plan.sessions, course_types: plan.course_types,
          price_cents: plan.price_cents, period: plan.period, start_date: today,
          status: 'attente_paiement', source: 'achat', payment_method: 'en_ligne', stripe_customer_id: customer,
        }).select().single()
        if (error) throw error

        const origin = safeReturn(body.return_url)
        const recurring = plan.kind !== 'carnet' && INTERVAL[plan.period]
        const meta = { subscription_id: sub.id, box_id: box.id, member_id: member.id }
        const params: Stripe.Checkout.SessionCreateParams = {
          customer, locale: 'fr', client_reference_id: sub.id, metadata: meta,
          success_url: origin + '/?paiement=ok', cancel_url: origin + '/?paiement=annule',
          payment_method_types: ['card'],
          line_items: [{
            quantity: 1,
            price_data: {
              currency: 'eur', unit_amount: plan.price_cents,
              product_data: { name: plan.name + ' · ' + box.name },
              ...(recurring ? { recurring } : {}),
            },
          }],
          ...(recurring
            ? { mode: 'subscription', subscription_data: { metadata: meta, ...(FEE ? { application_fee_percent: FEE } : {}) } }
            : { mode: 'payment', payment_intent_data: { metadata: meta, ...(FEE ? { application_fee_amount: Math.round(plan.price_cents * FEE / 100) } : {}) } }),
        }
        const session = await s.checkout.sessions.create(params, opts)
        await admin.from('subscriptions').update({ stripe_session_id: session.id }).eq('id', sub.id)
        return json({ url: session.url })
      }

      // ---------- Athlète : gérer sa carte, ses factures, résilier ----------
      case 'portal': {
        const box = await getBox(body.box_id)
        const { data: member } = await admin.from('members').select('*').eq('box_id', box.id).eq('user_id', user.id).single()
        if (!member || !member.stripe_customer_id || !box.stripe_account_id) throw new HttpError(400, 'Aucun paiement en ligne pour ce compte')
        const opts = { stripeAccount: box.stripe_account_id }
        const confs = await s.billingPortal.configurations.list({ limit: 1, active: true }, opts)
        let configuration = confs.data[0] && confs.data[0].id
        if (!configuration) {
          const c = await s.billingPortal.configurations.create({
            business_profile: { headline: box.name },
            features: {
              payment_method_update: { enabled: true },
              invoice_history: { enabled: true },
              subscription_cancel: { enabled: true, mode: 'at_period_end' },
            },
          }, opts)
          configuration = c.id
        }
        const ses = await s.billingPortal.sessions.create({ customer: member.stripe_customer_id, return_url: safeReturn(body.return_url) + '/', configuration }, opts)
        return json({ url: ses.url })
      }

      // ---------- Owner : arrêter un abonnement payé en ligne ----------
      case 'cancel_sub': {
        const { data: sub } = await admin.from('subscriptions').select('*').eq('id', body.subscription_id).single()
        if (!sub) throw new HttpError(404, 'Abonnement introuvable')
        const role = await roleIn(sub.box_id, user.id)
        if (role !== 'owner' && role !== 'admin') throw new HttpError(403, "Réservé à l'owner")
        const box = await getBox(sub.box_id)
        if (sub.stripe_subscription_id && box.stripe_account_id) {
          await s.subscriptions.cancel(sub.stripe_subscription_id, {}, { stripeAccount: box.stripe_account_id })
        }
        await admin.from('subscriptions').update({ status: 'terminee', end_date: new Date().toISOString().slice(0, 10) }).eq('id', sub.id)
        return json({ ok: true })
      }

      // ---------- Admin plateforme : brancher la réception des notifications Stripe ----------
      case 'setup': {
        const { data: adm } = await admin.from('platform_admins').select('user_id').eq('user_id', user.id)
        if (!adm || !adm.length) throw new HttpError(403, 'Réservé à l’administrateur')
        const url = Deno.env.get('SUPABASE_URL') + '/functions/v1/stripe-webhook'
        const existing = (await s.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === url)
        const { data: has } = await admin.rpc('platform_secret', { secret_name: 'stripe_webhook_secret' })
        if (existing && has) return json({ ok: true, already: true })
        if (existing) await s.webhookEndpoints.del(existing.id)
        const ep = await s.webhookEndpoints.create({
          url, connect: true, api_version: API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
          enabled_events: ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded',
            'invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted', 'account.updated'],
          description: 'Le Socle',
        })
        await admin.rpc('platform_set_secret', { secret_name: 'stripe_webhook_secret', secret_value: ep.secret })
        return json({ ok: true })
      }
      default:
        throw new HttpError(400, 'Action inconnue')
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    console.error(e)
    let msg = (e as Error).message || String(e)
    if (/signed up for Connect/i.test(msg)) msg = 'Stripe Connect n’est pas encore activé sur le compte de la plateforme.'
    return json({ error: msg }, status)
  }
})
