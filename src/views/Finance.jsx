import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, monthly } from '../lib/plans'
import { useUsage } from './Plans'
import { Empty, Pill } from '../components/ui'

const CATS = { loyer: 'Loyer', energie: 'Énergie et eau', telecom: 'Internet et téléphone', logiciel: 'Logiciels et affiliation', assurance: 'Assurance', services: 'Comptable, ménage, services', achats: 'Matériel et achats', marketing: 'Marketing', autre: 'Autre' }
const PRESETS = [
  ['Loyer', 'loyer', 'mois', 20, false], ['Électricité', 'energie', 'mois', 20, true], ['Eau', 'energie', 'mois', 5.5, true],
  ['Internet et téléphone', 'telecom', 'mois', 20, true], ['Logiciel de réservation', 'logiciel', 'mois', 20, true], ['Affiliation CrossFit', 'logiciel', 'an', 0, true],
  ['Assurance', 'assurance', 'an', 0, true], ['Expert-comptable', 'services', 'mois', 20, false], ['Matériel et achats', 'achats', 'mois', 20, true],
  ['Ménage et entretien', 'services', 'mois', 20, true], ['Marketing', 'marketing', 'mois', 20, true],
]
const DEF = { vat_registered: true, vat_rate: 20, employer_rate: 42, employee_rate: 22, charges: [], staff: [] }
const uid = () => Math.random().toString(36).slice(2, 9)
const eur = (c) => (c || 0) / 100
const cents = (v) => Math.round((Number(String(v).replace(',', '.')) || 0) * 100)

// Coût mensuel d'une charge, en HT et en TTC
function chargeMonth(c) {
  const base = c.period === 'an' ? c.amount_cents / 12 : c.amount_cents
  const r = Number(c.vat) || 0
  const ht = c.ttc ? base / (1 + r / 100) : base
  return { ht, ttc: ht * (1 + r / 100), vat: ht * r / 100 }
}
// Coût mensuel employeur d'un salarié ou d'un indépendant
function staffMonth(s, f) {
  if (s.type === 'independant') return { brut: s.amount_cents, cost: s.amount_cents }
  const brut = s.basis === 'net' ? s.amount_cents / (1 - (Number(f.employee_rate) || 0) / 100) : s.amount_cents
  return { brut, cost: brut * (1 + (Number(f.employer_rate) || 0) / 100) }
}

export default function Finance({ box, toast }) {
  const [f, setF] = useState(null)
  const [saved, setSaved] = useState(null)
  const [mode, setMode] = useState('ht')
  const [usage] = useUsage(box.id)

  useEffect(() => {
    supabase.from('box_private').select('settings').eq('box_id', box.id).maybeSingle().then(({ data }) => {
      const fin = { ...DEF, ...((data && data.settings && data.settings.finance) || {}) }
      setF(fin); setSaved(JSON.stringify(fin))
    })
  }, [box.id])

  const calc = useMemo(() => {
    if (!f) return null
    const r = f.vat_registered ? (Number(f.vat_rate) || 0) / 100 : 0
    const active = usage.filter((u) => u.status === 'active')
    const since = Date.now() - 90 * 864e5
    let revTTC = 0, stripeFees = 0
    active.forEach((u) => {
      const m = monthly(u)
      if (m) {
        revTTC += m
        if (u.payment_method === 'en_ligne') {
          const per = u.period === 'trimestre' ? 3 : u.period === 'annee' ? 12 : 1
          stripeFees += (u.price_cents * 0.022 + 25) / per
        }
      } else if (new Date(u.created_at).getTime() >= since) {
        revTTC += u.price_cents / 3 // carnets et paiements uniques : moyenne sur 3 mois
        if (u.payment_method === 'en_ligne') stripeFees += (u.price_cents * 0.015 + 25) / 3
      }
    })
    const revHT = revTTC / (1 + r)
    const vatCollected = revTTC - revHT
    const ch = f.charges.map((c) => ({ ...c, m: chargeMonth(c) }))
    const chargesHT = ch.reduce((a, c) => a + c.m.ht, 0)
    const chargesTTC = ch.reduce((a, c) => a + c.m.ttc, 0)
    const vatDeductible = f.vat_registered ? ch.reduce((a, c) => a + c.m.vat, 0) : 0
    const chargesCost = f.vat_registered ? chargesHT : chargesTTC
    const st = f.staff.map((s) => ({ ...s, m: staffMonth(s, f) }))
    const staffCost = st.reduce((a, s) => a + s.m.cost, 0)
    const result = revHT - stripeFees - chargesCost - staffCost
    const members = new Set(active.map((u) => u.member_id)).size
    const perMember = members ? revHT / members : 0
    const feePerMember = members ? stripeFees / members : 0
    const costPerMember = members ? (chargesCost + staffCost + stripeFees) / members : 0
    const breakeven = perMember - feePerMember > 0 ? Math.ceil((chargesCost + staffCost) / (perMember - feePerMember)) : null
    const byCat = {}
    ch.forEach((c) => (byCat[c.category] = (byCat[c.category] || 0) + (f.vat_registered ? c.m.ht : c.m.ttc)))
    byCat.__staff = staffCost
    byCat.__stripe = stripeFees
    return { r, revTTC, revHT, vatCollected, vatDeductible, chargesHT, chargesTTC, chargesCost, staffCost, stripeFees, result, members, perMember, costPerMember, breakeven, byCat, ch, st }
  }, [f, usage])

  if (!f || !calc) return <div className="loading">Chargement…</div>
  const dirty = JSON.stringify(f) !== saved
  const ttc = mode === 'ttc'
  const set = (k, v) => setF({ ...f, [k]: v })
  const setCharge = (id, patch) => set('charges', f.charges.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const setStaff = (id, patch) => set('staff', f.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  async function save() {
    const { data } = await supabase.from('box_private').select('settings').eq('box_id', box.id).maybeSingle()
    const settings = { ...((data && data.settings) || {}), finance: f }
    const { error } = await supabase.from('box_private').upsert({ box_id: box.id, settings, updated_at: new Date().toISOString() })
    if (error) return toast(error.message)
    setSaved(JSON.stringify(f))
    toast('Rentabilité enregistrée')
  }

  const rev = ttc ? calc.revTTC : calc.revHT
  const charges = ttc ? calc.chargesTTC : calc.chargesCost
  const vatDue = calc.vatCollected - calc.vatDeductible
  const total = Object.values(calc.byCat).reduce((a, b) => a + b, 0) || 1
  const catLabel = (k) => (k === '__staff' ? 'Salaires et coachs' : k === '__stripe' ? 'Frais Stripe' : CATS[k] || k)

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <div><h2>Rentabilité de la salle</h2><p className="sub">Ton chiffre d'affaires réel, une fois payés la TVA, les frais de paiement, les charges et les salaires. Visible par toi seul.</p></div>
          <div className="row">
            <div className="seg">{[['ht', 'Tout en HT'], ['ttc', 'Tout en TTC']].map(([k, l]) => <button key={k} className="rper" aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}</div>
            <button className="btn" disabled={!dirty} onClick={save}>{dirty ? 'Enregistrer' : 'Enregistré'}</button>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi"><span>Chiffre d'affaires / mois</span><b>{money(rev)}</b><span>{ttc ? 'TTC, payé par les adhérents' : 'HT, après TVA'}</span></div>
          <div className="kpi"><span>Dépenses / mois</span><b>{money(charges + calc.staffCost + calc.stripeFees + (ttc ? Math.max(0, vatDue) : 0))}</b><span>charges, salaires, Stripe{ttc ? ', TVA' : ''}</span></div>
          <div className={'kpi' + (calc.result < 0 ? ' bad' : ' hl')}><span>Résultat / mois</span><b>{money(calc.result)}</b><span>avant impôts</span></div>
          <div className="kpi"><span>Revenu réel par adhérent</span><b>{money(calc.perMember - calc.costPerMember)}</b><span>{money(calc.perMember)} HT encaissés − {money(calc.costPerMember)} de coûts</span></div>
          <div className="kpi"><span>Seuil de rentabilité</span><b>{calc.breakeven == null ? '—' : calc.breakeven + ' adh.'}</b><span>{calc.members} adhérents actifs aujourd'hui</span></div>
        </div>
      </div>

      <div className="grid g2 top">
        <div className="card">
          <h3>Le détail du mois</h3>
          <table className="fintable"><tbody>
            <tr><td>Abonnements et carnets {ttc ? 'TTC' : 'HT'}</td><td className="num">{money(rev)}</td></tr>
            {ttc && f.vat_registered && <tr className="minus"><td>TVA à reverser ({money(calc.vatCollected)} collectée − {money(calc.vatDeductible)} récupérée)</td><td className="num">− {money(vatDue)}</td></tr>}
            <tr className="minus"><td>Frais Stripe (paiements en ligne)</td><td className="num">− {money(calc.stripeFees)}</td></tr>
            <tr className="minus"><td>Charges {ttc ? 'TTC' : f.vat_registered ? 'HT' : '(TVA non récupérable)'}</td><td className="num">− {money(ttc ? calc.chargesTTC : calc.chargesCost)}</td></tr>
            <tr className="minus"><td>Salaires chargés et coachs</td><td className="num">− {money(calc.staffCost)}</td></tr>
            <tr className="total"><td>Résultat</td><td className="num">{money(calc.result)}</td></tr>
          </tbody></table>
          <p className="sub">Carnets : moyenne des ventes des 3 derniers mois. Frais Stripe estimés à 1,5 % + 0,25 € par paiement, plus 0,7 % sur les abonnements.</p>
        </div>
        <div className="card">
          <h3>Où part l'argent</h3>
          <div className="bars">
            {Object.entries(calc.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div className="barrow" key={k}><span>{catLabel(k)}</span><div className="bar"><i style={{ width: (v / total * 100) + '%' }} /></div><b className="num">{money(v)}</b></div>
            ))}
            {total <= 1 && <Empty>Ajoute tes charges et tes salaires pour voir la répartition.</Empty>}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Hypothèses</h3>
        <div className="form">
          <label className="full inline"><input type="checkbox" checked={!!f.vat_registered} onChange={(e) => set('vat_registered', e.target.checked)} /> La salle facture la TVA (pas en franchise en base)</label>
          {f.vat_registered && <label>TVA sur les abonnements (%)<input type="number" step="0.1" min="0" max="30" value={f.vat_rate} onChange={(e) => set('vat_rate', e.target.value)} /></label>}
          <label>Charges patronales (% du brut)<input type="number" step="1" min="0" max="80" value={f.employer_rate} onChange={(e) => set('employer_rate', e.target.value)} /></label>
          <label>Charges salariales (% du brut, pour convertir un net)<input type="number" step="1" min="0" max="50" value={f.employee_rate} onChange={(e) => set('employee_rate', e.target.value)} /></label>
        </div>
        <p className="sub">Taux indicatifs : ton expert-comptable peut te donner les tiens (réductions de charges, statut des coachs…).</p>
      </div>

      <div className="card">
        <div className="spread"><h3>Charges</h3>
          <select value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) set('charges', [...f.charges, { id: uid(), label: p[0], category: p[1], period: p[2], vat: p[3], ttc: p[4], amount_cents: 0 }]) }} aria-label="Ajouter une charge">
            <option value="">+ Ajouter une charge…</option>
            {PRESETS.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}
          </select>
        </div>
        <div className="scroll"><table className="edittable">
          <thead><tr><th>Charge</th><th>Catégorie</th><th>Montant (€)</th><th>Saisi en</th><th>TVA</th><th>Par</th><th>Coût / mois</th><th /></tr></thead>
          <tbody>
            {calc.ch.map((c) => (
              <tr key={c.id}>
                <td><input value={c.label} onChange={(e) => setCharge(c.id, { label: e.target.value })} aria-label="Nom de la charge" /></td>
                <td><select value={c.category} onChange={(e) => setCharge(c.id, { category: e.target.value })}>{Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td><input className="amount" inputMode="decimal" value={eur(c.amount_cents) || ''} onChange={(e) => setCharge(c.id, { amount_cents: cents(e.target.value) })} aria-label="Montant" /></td>
                <td><select value={c.ttc ? 'ttc' : 'ht'} onChange={(e) => setCharge(c.id, { ttc: e.target.value === 'ttc' })}><option value="ttc">TTC</option><option value="ht">HT</option></select></td>
                <td><select value={c.vat} onChange={(e) => setCharge(c.id, { vat: Number(e.target.value) })}>{[0, 5.5, 10, 20].map((v) => <option key={v} value={v}>{v} %</option>)}</select></td>
                <td><select value={c.period} onChange={(e) => setCharge(c.id, { period: e.target.value })}><option value="mois">mois</option><option value="an">an</option></select></td>
                <td className="num">{money(ttc ? c.m.ttc : f.vat_registered ? c.m.ht : c.m.ttc)}</td>
                <td><button className="btn small ghost" onClick={() => set('charges', f.charges.filter((x) => x.id !== c.id))} aria-label="Supprimer">×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!f.charges.length && <Empty>Ajoute ton loyer, ton électricité, tes logiciels… avec la liste ci-dessus.</Empty>}
      </div>

      <div className="card">
        <div className="spread"><h3>Salariés et coachs</h3>
          <button className="btn small" onClick={() => set('staff', [...f.staff, { id: uid(), name: '', role: 'Coach', type: 'salarie', basis: 'brut', amount_cents: 0 }])}>+ Ajouter une personne</button>
        </div>
        <div className="scroll"><table className="edittable">
          <thead><tr><th>Nom</th><th>Rôle</th><th>Statut</th><th>Montant mensuel (€)</th><th>Coût employeur / mois</th><th /></tr></thead>
          <tbody>
            {calc.st.map((s) => (
              <tr key={s.id}>
                <td><input value={s.name} onChange={(e) => setStaff(s.id, { name: e.target.value })} placeholder="Prénom" aria-label="Nom" /></td>
                <td><input value={s.role} onChange={(e) => setStaff(s.id, { role: e.target.value })} aria-label="Rôle" /></td>
                <td><select value={s.type === 'independant' ? 'facture' : s.basis} onChange={(e) => setStaff(s.id, e.target.value === 'facture' ? { type: 'independant', basis: 'facture' } : { type: 'salarie', basis: e.target.value })}>
                  <option value="brut">Salarié · brut</option><option value="net">Salarié · net</option><option value="facture">Indépendant · facture</option></select></td>
                <td><input className="amount" inputMode="decimal" value={eur(s.amount_cents) || ''} onChange={(e) => setStaff(s.id, { amount_cents: cents(e.target.value) })} aria-label="Montant" /></td>
                <td className="num">{money(s.m.cost)}{s.type !== 'independant' && <div className="sub">brut {money(s.m.brut)}</div>}</td>
                <td><button className="btn small ghost" onClick={() => set('staff', f.staff.filter((x) => x.id !== s.id))} aria-label="Supprimer">×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!f.staff.length && <Empty>Ajoute tes salariés (en brut ou en net) et tes coachs indépendants (montant facturé).</Empty>}
      </div>

      {calc.members > 0 && (
        <div className="card">
          <h3>Ce que ça veut dire</h3>
          <ul className="checklist">
            <li>Chaque adhérent rapporte en moyenne <b>{money(calc.perMember)} HT</b> par mois et coûte <b>{money(calc.costPerMember)}</b> en charges, salaires et frais : il te reste <b>{money(calc.perMember - calc.costPerMember)}</b>.</li>
            {calc.breakeven != null && <li>Tu couvres tes frais fixes à partir de <b>{calc.breakeven} adhérents</b> actifs : tu en as <b>{calc.members}</b> ({calc.members >= calc.breakeven ? <Pill cls="good">au-dessus du seuil</Pill> : <Pill cls="bad">sous le seuil</Pill>}).</li>}
            {calc.perMember > calc.costPerMember && <li>Chaque nouvel adhérent ajoute environ <b>{money(calc.perMember - (calc.members ? calc.stripeFees / calc.members : 0))}</b> à ton résultat mensuel, puisque tes frais fixes sont déjà couverts.</li>}
          </ul>
        </div>
      )}
      {dirty && <div className="savebar"><span>Modifications non enregistrées</span><button className="btn" onClick={save}>Enregistrer</button></div>}
    </div>
  )
}
