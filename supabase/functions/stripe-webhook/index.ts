// Notifications Stripe (comptes des salles) : active, renouvelle, suspend ou termine les formules.
import { Stripe, admin, secret, stripe } from '../_shared/stripe.ts'

const day = (ts?: number | null) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null)
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10)

async function activateFromSession(s: Stripe.Checkout.Session) {
  const subId = s.metadata && s.metadata.subscription_id
  if (!subId) return
  const { data: sub } = await admin.from('subscriptions').select('*').eq('id', subId).single()
  if (!sub || sub.status === 'active') return
  let end = sub.end_date
  if (sub.kind === 'carnet' && sub.plan_id) {
    const { data: plan } = await admin.from('plans').select('validity_days').eq('id', sub.plan_id).single()
    if (plan && plan.validity_days) end = addDays(today(), plan.validity_days)
  }
  let commitment = sub.commitment_until
  if (sub.plan_id) {
    const { data: plan } = await admin.from('plans').select('commitment_months').eq('id', sub.plan_id).single()
    if (plan && plan.commitment_months) { const d = new Date(); d.setMonth(d.getMonth() + plan.commitment_months); commitment = d.toISOString().slice(0, 10) }
  }
  await admin.from('subscriptions').update({
    status: 'active', paid_at: new Date().toISOString(), payment_method: 'en_ligne', start_date: today(), end_date: end,
    commitment_until: commitment, payment_issue: null,
    stripe_subscription_id: typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null,
    stripe_customer_id: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? sub.stripe_customer_id,
  }).eq('id', subId)
  await admin.from('journal').insert({ box_id: sub.box_id, text: 'Paiement en ligne reçu : ' + sub.name, actor: null })
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()
  const whsec = await secret('STRIPE_WEBHOOK_SECRET', 'stripe_webhook_secret')
  if (!sig || !whsec) return new Response('Non configuré', { status: 400 })
  const s = await stripe()
  let event: Stripe.Event
  try {
    event = await s.webhooks.constructEventAsync(body, sig, whsec, undefined, Stripe.createSubtleCryptoProvider())
  } catch (e) {
    return new Response('Signature invalide : ' + (e as Error).message, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const ses = event.data.object as Stripe.Checkout.Session
        if (ses.payment_status === 'paid' || ses.payment_status === 'no_payment_required') await activateFromSession(ses)
        break
      }
      case 'checkout.session.expired': {
        const ses = event.data.object as Stripe.Checkout.Session
        await admin.from('subscriptions').delete().eq('stripe_session_id', ses.id).eq('status', 'attente_paiement')
        break
      }
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice & { subscription?: string }
        if (!inv.subscription) break
        const end = inv.lines?.data?.[0]?.period?.end
        await admin.from('subscriptions').update({ status: 'active', payment_issue: null, ...(end ? { current_period_end: day(end) } : {}) })
          .eq('stripe_subscription_id', inv.subscription).neq('status', 'terminee')
        break
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice & { subscription?: string }
        if (!inv.subscription) break
        await admin.from('subscriptions').update({ payment_issue: 'Paiement refusé le ' + new Date().toLocaleDateString('fr-FR') })
          .eq('stripe_subscription_id', inv.subscription)
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const patch: Record<string, unknown> = { current_period_end: day(sub.current_period_end) }
        if (event.type === 'customer.subscription.deleted' || sub.status === 'canceled') {
          patch.status = 'terminee'; patch.end_date = today()
        } else if (['unpaid', 'incomplete_expired', 'paused'].includes(sub.status)) {
          patch.status = 'suspendue'
        } else if (sub.status === 'active' || sub.status === 'trialing') {
          patch.status = 'active'; patch.end_date = sub.cancel_at_period_end ? day(sub.current_period_end) : null
        } else if (sub.status === 'past_due') {
          patch.payment_issue = 'Paiement en retard'
        }
        await admin.from('subscriptions').update(patch).eq('stripe_subscription_id', sub.id)
        break
      }
      case 'account.updated': {
        const acct = event.data.object as Stripe.Account
        await admin.from('boxes').update({ stripe_charges_enabled: !!acct.charges_enabled, stripe_details_submitted: !!acct.details_submitted })
          .eq('stripe_account_id', acct.id)
        break
      }
    }
  } catch (e) {
    console.error(event.type, e)
    return new Response('Erreur : ' + (e as Error).message, { status: 500 })
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
})
