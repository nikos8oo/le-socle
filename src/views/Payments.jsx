import { useCallback, useEffect, useState } from 'react'
import { stripeApi } from '../lib/stripe'
import { Pill } from '../components/ui'

// L'owner relie lui-même le compte Stripe de sa salle, avec un guide pas à pas.
export default function Payments({ box, toast }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!box.stripe_account_id) return setSt({ connected: false })
    try { setSt(await stripeApi('status', { box_id: box.id })) } catch (e) { setSt({ connected: true, error: e.message }) }
  }, [box.id, box.stripe_account_id])
  useEffect(() => { load() }, [load])

  async function connect() {
    setBusy(true)
    try { const { url } = await stripeApi('connect', { box_id: box.id }); window.location.href = url }
    catch (e) { toast(e.message); setBusy(false) }
  }

  if (!st) return <div className="card"><p className="sub">Vérification de ton compte Stripe…</p></div>
  const active = st.connected && st.stripe_charges_enabled
  const pending = st.connected && !active && st.card_status === 'pending'
  const step = !st.connected ? 1 : active ? 3 : 2

  return (
    <div className="stack">
      <div className={'card' + (active ? ' okcard' : '')}>
        <div className="spread">
          <div>
            <h2>Paiement en ligne</h2>
            <p className="sub">Tes adhérents paient leur formule par carte dans l'app, avec prélèvement automatique chaque mois. L'argent arrive directement sur le compte bancaire de ta salle, via ton propre compte Stripe.</p>
          </div>
          {active ? <Pill cls="good">Actif</Pill> : pending ? <Pill cls="warn">Vérification en cours</Pill> : st.connected ? <Pill cls="warn">À compléter</Pill> : <Pill>Non activé</Pill>}
        </div>

        <ol className="paysteps">
          <li className={step > 1 ? 'done' : step === 1 ? 'now' : ''}><b>Créer ton compte Stripe</b><span>Un clic, puis Stripe t'accompagne dans son formulaire sécurisé.</span></li>
          <li className={step > 2 ? 'done' : step === 2 ? 'now' : ''}><b>Faire vérifier ta salle</b><span>Identité du gérant, SIRET, IBAN. Stripe vérifie généralement en quelques minutes.</span></li>
          <li className={step === 3 ? 'done' : ''}><b>Encaisser</b><span>Le bouton « Payer par carte » apparaît dans la Boutique de tes adhérents.</span></li>
        </ol>

        {st.error && <p className="err">{st.error}</p>}
        {active ? (
          <div className="row">
            <a className="btn" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Ouvrir mon tableau de bord Stripe</a>
            <button className="btn ghost small" onClick={load}>Actualiser</button>
          </div>
        ) : pending ? (
          <div className="row">
            <p className="sub" style={{ flex: 1 }}>Stripe vérifie les informations de ta salle. Tu peux revenir plus tard : l'activation se fera toute seule.</p>
            <button className="btn ghost small" onClick={load}>Actualiser</button>
            <button className="btn small" disabled={busy} onClick={connect}>Revoir mon inscription</button>
          </div>
        ) : (
          <div className="row">
            <button className="btn" disabled={busy} onClick={connect}>{busy ? 'Ouverture de Stripe…' : st.connected ? 'Terminer mon inscription Stripe' : 'Connecter ma salle à Stripe'}</button>
            {st.connected && <button className="btn ghost small" onClick={load}>Actualiser</button>}
            {st.connected && st.missing > 0 && <span className="sub">{st.missing} information{st.missing > 1 ? 's' : ''} à fournir</span>}
          </div>
        )}
      </div>

      {!active && (
        <div className="card">
          <h3>Avant de commencer, prépare</h3>
          <ul className="checklist">
            <li>Le <b>SIRET</b> de la salle (ou ton numéro d'auto-entrepreneur)</li>
            <li>L'<b>IBAN</b> du compte bancaire professionnel qui recevra les paiements</li>
            <li>Une <b>pièce d'identité</b> du gérant (carte d'identité ou passeport)</li>
            <li>Ton <b>téléphone</b> pour le code de confirmation par SMS</li>
            <li>L'<b>adresse</b> de la salle et son site ou sa page Instagram</li>
          </ul>
          <p className="sub">Compte 10 minutes environ. Tu peux t'arrêter et reprendre plus tard avec le même bouton.</p>
        </div>
      )}

      <div className="card">
        <h3>Questions fréquentes</h3>
        <details className="faq"><summary>Combien ça coûte ?</summary><p>Aucun abonnement Stripe. Stripe prélève environ 1,5 % + 0,25 € par paiement avec une carte européenne, plus 0,7 % sur les abonnements. Pour une formule à 69 €, compte environ 1,80 € par mois.</p></details>
        <details className="faq"><summary>Quand l'argent arrive-t-il sur mon compte ?</summary><p>Stripe vire automatiquement les paiements sur ton IBAN, en général quelques jours après chaque paiement. Le calendrier exact est visible dans ton tableau de bord Stripe.</p></details>
        <details className="faq"><summary>J'ai déjà un compte Stripe, est-ce que je dois en recréer un ?</summary><p>Stripe crée un compte dédié à ta salle sur Le Socle. Si tu te connectes avec la même adresse e-mail que ton compte existant, tu retrouveras les deux dans ton tableau de bord Stripe, chacun avec ses propres paiements.</p></details>
        <details className="faq"><summary>Que se passe-t-il si un prélèvement échoue ?</summary><p>Stripe réessaie automatiquement et demande à l'adhérent de mettre sa carte à jour. L'adhérent apparaît dans « Paiements à surveiller » de l'onglet Formules ; si le paiement n'est pas régularisé, sa formule est suspendue.</p></details>
        <details className="faq"><summary>Mes adhérents peuvent-ils toujours payer à la salle ?</summary><p>Oui. Dans la Boutique, l'adhérent peut choisir « payer à la salle » ; tu valides ensuite le paiement dans l'onglet Formules.</p></details>
      </div>
    </div>
  )
}
