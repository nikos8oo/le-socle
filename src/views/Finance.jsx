import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, monthly } from '../lib/plans'
import { useUsage } from './Plans'
import { Empty, Pill } from '../components/ui'

// ---------------------------------------------------------------------------
// Plan comptable simplifié d'une box (comptes du PCG utilisés par les experts-comptables)
// groupe : ext = consommations externes · mar = achats de marchandises · imp = impôts et taxes
// ---------------------------------------------------------------------------
const CHARGE_ACCOUNTS = {
  '607': ['Achats de marchandises', 'Boissons, compléments, textile revendus', 'mar'],
  '606': ['Achats non stockés', 'Énergie, eau, petit matériel, fournitures', 'ext'],
  '613': ['Locations', 'Loyer du local, location de matériel', 'ext'],
  '615': ['Entretien et réparations', 'Ménage, maintenance, réparations', 'ext'],
  '616': ['Assurances', 'RC pro, multirisque locaux', 'ext'],
  '622': ['Honoraires', 'Expert-comptable, avocat', 'ext'],
  '623': ['Publicité', 'Réseaux sociaux, flyers, site', 'ext'],
  '626': ['Télécom et frais postaux', 'Internet, téléphone', 'ext'],
  '627': ['Services bancaires', 'Frais bancaires, terminal de paiement', 'ext'],
  '651': ['Redevances et licences', 'Affiliation CrossFit, logiciels', 'ext'],
  '628': ['Charges diverses', 'Cotisations, autres', 'ext'],
  '635': ['Impôts et taxes', 'CFE, taxe foncière (sans TVA)', 'imp'],
}
const REVENUE_ACCOUNTS = {
  '706': ['Prestations de services', 'Abonnements, carnets, coaching privé, stages'],
  '707': ['Ventes de marchandises', 'Boissons, compléments, textile'],
  '708': ['Produits des activités annexes', 'Sous-location, sponsoring, événements'],
}
const CHARGE_PRESETS = [
  ['Loyer du local', '613', 'mois', 20, false], ['Électricité', '606', 'mois', 20, true], ['Eau', '606', 'mois', 5.5, true],
  ['Petit matériel (barres, ballons…)', '606', 'mois', 20, true], ['Ménage et entretien', '615', 'mois', 20, true],
  ['Assurance RC pro et locaux', '616', 'an', 0, true], ['Expert-comptable', '622', 'mois', 20, false], ['Publicité', '623', 'mois', 20, true],
  ['Internet et téléphone', '626', 'mois', 20, true], ['Frais bancaires', '627', 'mois', 20, true],
  ['Affiliation CrossFit', '651', 'an', 0, true], ['Logiciel de réservation', '651', 'mois', 20, true],
  ['Achats de boissons et compléments', '607', 'mois', 5.5, true], ['CFE', '635', 'an', 0, true],
]
const REVENUE_PRESETS = [
  ['Abonnements et carnets', '706', 'mois', 20, true], ['Coaching privé', '706', 'mois', 20, true], ['Stages et séminaires', '706', 'an', 20, true],
  ['Ventes boissons et compléments', '707', 'mois', 5.5, true], ['Ventes textile', '707', 'mois', 20, true],
  ['Sponsoring', '708', 'an', 20, false], ['Sous-location de la salle', '708', 'mois', 20, false],
]
// anciennes catégories (première version de l'onglet) → comptes
const LEGACY = { loyer: '613', energie: '606', telecom: '626', logiciel: '651', assurance: '616', services: '622', achats: '606', marketing: '623', autre: '628' }

const DEF = { vat_registered: true, vat_rate: 20, employer_rate: 42, employee_rate: 22, tax_regime: 'is', is_reduced: true, revenues: [], charges: [], staff: [], assets: [], loans: [] }
const IS_CAP = 4250000 // 42 500 € de bénéfice au taux réduit de 15 % (art. 219 CGI), puis 25 %
const uid = () => Math.random().toString(36).slice(2, 9)
const eur = (c) => (c || 0) / 100
const cents = (v) => Math.round((Number(String(v).replace(',', '.')) || 0) * 100)
const pct = (a, b) => (b && Math.abs(a / b) < 10 ? (a / b * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '—')

function normalize(raw) {
  const f = { ...DEF, ...(raw || {}) }
  f.charges = (f.charges || []).map((c) => (c.account ? c : { ...c, account: c.category === 'services' && /m[ée]nage|entretien/i.test(c.label || '') ? '615' : LEGACY[c.category] || '628' }))
  ;['revenues', 'staff', 'assets', 'loans'].forEach((k) => { f[k] = f[k] || [] })
  return f
}

// Montant mensuel d'une ligne, en HT, TVA et TTC
function lineMonth(c, vatOn) {
  const base = c.period === 'an' ? c.amount_cents / 12 : c.amount_cents
  const r = vatOn ? Number(c.vat) || 0 : 0
  const ht = c.ttc ? base / (1 + (Number(c.vat) || 0) / 100) : base
  // sans TVA récupérable (franchise), la charge réelle est le TTC
  return vatOn ? { ht, vat: ht * r / 100, ttc: ht * (1 + r / 100) } : { ht: c.ttc ? base : ht * (1 + (Number(c.vat) || 0) / 100), vat: 0, ttc: base }
}
function staffMonth(s, f) {
  if (s.type === 'independant') return { brut: 0, patronal: 0, fact: s.amount_cents, cost: s.amount_cents }
  const brut = s.basis === 'net' ? s.amount_cents / (1 - (Number(f.employee_rate) || 0) / 100) : s.amount_cents
  const patronal = brut * (Number(f.employer_rate) || 0) / 100
  return { brut, patronal, fact: 0, cost: brut + patronal }
}
function corpTax(yearProfit, reduced) {
  if (yearProfit <= 0) return 0
  if (!reduced) return yearProfit * 0.25
  return Math.min(yearProfit, IS_CAP) * 0.15 + Math.max(0, yearProfit - IS_CAP) * 0.25
}

export default function Finance({ box, data, toast }) {
  const [f, setF] = useState(null)
  const [saved, setSaved] = useState(null)
  const [per, setPer] = useState('mois')
  const [edit, setEdit] = useState('charges')
  const [usage] = useUsage(box.id)
  const auto = !!box.booking_module

  useEffect(() => {
    supabase.from('box_private').select('settings').eq('box_id', box.id).maybeSingle().then(({ data: d }) => {
      const fin = normalize(d && d.settings && d.settings.finance)
      setF(fin); setSaved(JSON.stringify(fin))
    })
  }, [box.id])

  const c = useMemo(() => {
    if (!f) return null
    const vatOn = !!f.vat_registered
    const r = vatOn ? (Number(f.vat_rate) || 0) / 100 : 0
    const acc = {} // compte → montant mensuel HT
    const add = (k, v) => { acc[k] = (acc[k] || 0) + v }
    let vatCollected = 0, vatDeductible = 0, stripe = 0

    // Produits : abonnements suivis dans Le Socle (module réservations) + lignes saisies
    const active = auto ? usage.filter((u) => u.status === 'active') : []
    let subsTTC = 0
    if (auto) {
      const since = Date.now() - 90 * 864e5
      active.forEach((u) => {
        const m = monthly(u)
        if (m) {
          subsTTC += m
          if (u.payment_method === 'en_ligne') stripe += (u.price_cents * 0.022 + 25) / (u.period === 'trimestre' ? 3 : u.period === 'annee' ? 12 : 1)
        } else if (new Date(u.created_at).getTime() >= since) {
          subsTTC += u.price_cents / 3
          if (u.payment_method === 'en_ligne') stripe += (u.price_cents * 0.015 + 25) / 3
        }
      })
      add('706', subsTTC / (1 + r)); vatCollected += subsTTC - subsTTC / (1 + r)
    }
    const rev = f.revenues.map((l) => ({ ...l, m: lineMonth(l, vatOn) }))
    rev.forEach((l) => { add(l.account, l.m.ht); vatCollected += l.m.vat })

    // Charges
    const ch = f.charges.map((l) => ({ ...l, m: lineMonth({ ...l, vat: l.account === '635' ? 0 : l.vat }, vatOn) }))
    ch.forEach((l) => { add(l.account, l.m.ht); vatDeductible += l.m.vat })
    if (stripe) add('627s', stripe)
    const st = f.staff.map((s) => ({ ...s, m: staffMonth(s, f) }))
    st.forEach((s) => { add('641', s.m.brut); add('645', s.m.patronal); add('611', s.m.fact) })
    const as = f.assets.map((a) => ({ ...a, dot: (a.amount_cents || 0) / Math.max(1, Number(a.years) || 1) / 12 }))
    as.forEach((a) => add('681', a.dot))
    const lo = f.loans.map((l) => { const int = (l.remaining_cents || 0) * (Number(l.rate) || 0) / 100 / 12; return { ...l, int, cap: Math.max(0, (l.payment_cents || 0) - int) } })
    lo.forEach((l) => add('661', l.int))

    const g = (k) => acc[k] || 0
    const ventes = g('707'), production = g('706') + g('708'), ca = ventes + production
    const achats = g('607'), margeCo = ventes - achats
    const extKeys = Object.keys(CHARGE_ACCOUNTS).filter((k) => CHARGE_ACCOUNTS[k][2] === 'ext')
    const ext = extKeys.reduce((a, k) => a + g(k), 0) + g('627s') + g('611')
    const va = margeCo + production - ext
    const personnel = g('641') + g('645')
    const ebe = va - g('635') - personnel
    const rex = ebe - g('681')
    const rcai = rex - g('661')
    const is = f.tax_regime === 'is' ? corpTax(rcai * 12, f.is_reduced !== false) / 12 : 0
    const net = rcai - is
    const caf = net + g('681')
    const capital = lo.reduce((a, l) => a + l.cap, 0)
    const cash = caf - capital

    // Point mort : charges variables = marchandises + frais de paiement ; le reste est fixe
    const variable = achats + g('627s')
    const fixed = ext - g('627s') + g('635') + personnel + g('681') + g('661')
    const mcvRate = ca ? (ca - variable) / ca : 0
    const breakevenCA = mcvRate > 0 ? fixed / mcvRate : null
    const members = auto ? new Set(active.map((u) => u.member_id)).size : (data ? data.members.filter((m) => m.active).length : 0)
    const perMember = members ? ca / members : 0
    const breakevenMembers = breakevenCA != null && perMember ? Math.ceil(breakevenCA / perMember) : null

    return { acc, g, ventes, production, ca, achats, margeCo, ext, extKeys, va, personnel, ebe, rex, rcai, is, net, caf, capital, cash,
      vatCollected, vatDeductible, vatDue: vatCollected - vatDeductible, variable, fixed, mcvRate, breakevenCA, members, perMember, breakevenMembers,
      rev, ch, st, as, lo, subsHT: subsTTC / (1 + r) }
  }, [f, usage, auto, data])

  if (!f || !c) return <div className="loading">Chargement…</div>
  const dirty = JSON.stringify(f) !== saved
  const k = per === 'annee' ? 12 : 1
  const M = (v) => money(Math.round(v * k))
  const set = (key, v) => setF({ ...f, [key]: v })
  const patch = (key, id, p) => set(key, f[key].map((x) => (x.id === id ? { ...x, ...p } : x)))
  const drop = (key, id) => set(key, f[key].filter((x) => x.id !== id))

  async function save() {
    const { data: d } = await supabase.from('box_private').select('settings').eq('box_id', box.id).maybeSingle()
    const settings = { ...((d && d.settings) || {}), finance: f }
    const { error } = await supabase.from('box_private').upsert({ box_id: box.id, settings, updated_at: new Date().toISOString() })
    if (error) return toast(error.message)
    setSaved(JSON.stringify(f))
    toast('Rentabilité enregistrée')
  }

  // Compte de résultat présenté en soldes intermédiaires de gestion
  const rows = []
  const line = (code, label, v, sign = 1) => { if (Math.abs(v) >= 1) rows.push({ t: 'l', code, label, v: v * sign }) }
  const sub = (label, v, strong) => rows.push({ t: strong ? 'total' : 'sig', label, v })
  if (c.ventes || c.achats) {
    line('707', 'Ventes de marchandises', c.ventes)
    line('607', 'Achats de marchandises', c.achats, -1)
    sub('Marge commerciale', c.margeCo)
  }
  line('706', 'Prestations de services' + (auto && c.subsHT ? ' (dont ' + M(c.subsHT) + ' d’abonnements suivis dans Le Socle)' : ''), c.g('706'))
  line('708', 'Produits des activités annexes', c.g('708'))
  sub("Chiffre d'affaires", c.ca)
  c.extKeys.forEach((key) => line(key, CHARGE_ACCOUNTS[key][0], c.g(key), -1))
  line('627', 'Commissions de paiement en ligne (Stripe)', c.g('627s'), -1)
  line('611', 'Sous-traitance (coachs indépendants)', c.g('611'), -1)
  sub('Valeur ajoutée', c.va)
  line('635', 'Impôts et taxes', c.g('635'), -1)
  line('641', 'Salaires bruts', c.g('641'), -1)
  line('645', 'Charges sociales patronales', c.g('645'), -1)
  sub("Excédent brut d'exploitation (EBE)", c.ebe)
  line('681', 'Dotations aux amortissements', c.g('681'), -1)
  sub("Résultat d'exploitation", c.rex)
  line('661', "Charges d'intérêts", c.g('661'), -1)
  sub('Résultat courant avant impôt', c.rcai)
  if (f.tax_regime === 'is') line('695', 'Impôt sur les sociétés (estimé)', c.is, -1)
  sub(f.tax_regime === 'is' ? 'Résultat net' : 'Résultat imposable (avant cotisations du dirigeant)', c.net, true)

  function exportCsv() {
    const lines = [['Compte', 'Libellé', per === 'annee' ? 'Montant annuel (€)' : 'Montant mensuel (€)', '% du CA']]
    rows.forEach((r) => lines.push([r.code || '', r.label, (Math.round(r.v * k) / 100).toFixed(2).replace('.', ','), c.ca ? (r.v / c.ca * 100).toFixed(1).replace('.', ',') : '']))
    lines.push([], ['', 'Capacité d’autofinancement (CAF)', (Math.round(c.caf * k) / 100).toFixed(2).replace('.', ',')], ['', 'Remboursement du capital des emprunts', (Math.round(-c.capital * k) / 100).toFixed(2).replace('.', ',')], ['', 'Trésorerie dégagée', (Math.round(c.cash * k) / 100).toFixed(2).replace('.', ',')])
    if (f.vat_registered) lines.push([], ['', 'TVA collectée', (Math.round(c.vatCollected * k) / 100).toFixed(2).replace('.', ',')], ['', 'TVA déductible', (Math.round(c.vatDeductible * k) / 100).toFixed(2).replace('.', ',')], ['', 'TVA à reverser', (Math.round(c.vatDue * k) / 100).toFixed(2).replace('.', ',')])
    const csv = '﻿' + lines.map((l) => l.map((x) => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'compte-de-resultat-' + box.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + per + '.csv'
    a.click()
  }

  const groups = [
    ['Loyer et locations', c.g('613')], ['Salaires et charges', c.personnel], ['Coachs indépendants', c.g('611')],
    ['Énergie, matériel, fournitures', c.g('606')], ['Marchandises', c.achats], ['Licences et affiliation', c.g('651')],
    ['Services (entretien, honoraires, assurance, télécom, pub)', ['615', '616', '622', '623', '626', '628'].reduce((a, x) => a + c.g(x), 0)],
    ['Frais bancaires et Stripe', c.g('627') + c.g('627s')], ['Impôts et taxes', c.g('635')], ['Amortissements', c.g('681')], ['Intérêts d’emprunt', c.g('661')],
  ].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const totalCost = groups.reduce((a, [, v]) => a + v, 0) || 1

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <div><h2>Rentabilité de la salle</h2><p className="sub">Ton compte de résultat présenté comme celui de ton expert-comptable : montants {f.vat_registered ? 'hors taxes' : 'TTC (TVA non récupérable)'}, soldes intermédiaires de gestion, point mort. Visible par toi seul.</p></div>
          <div className="row">
            <div className="seg">{[['mois', 'Par mois'], ['annee', 'Sur un an']].map(([key, l]) => <button key={key} className="rper" aria-pressed={per === key} onClick={() => setPer(key)}>{l}</button>)}</div>
            <button className="btn ghost" onClick={exportCsv}>Exporter pour le comptable</button>
            <button className="btn" disabled={!dirty} onClick={save}>{dirty ? 'Enregistrer' : 'Enregistré'}</button>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi"><span>Chiffre d'affaires {f.vat_registered ? 'HT' : ''}</span><b>{M(c.ca)}</b><span>{per === 'annee' ? 'sur 12 mois' : 'par mois'}</span></div>
          <div className={'kpi' + (c.ebe < 0 ? ' bad' : '')}><span>EBE</span><b>{M(c.ebe)}</b><span>taux de marge {pct(c.ebe, c.ca)}</span></div>
          <div className={'kpi' + (c.net < 0 ? ' bad' : ' hl')}><span>{f.tax_regime === 'is' ? 'Résultat net' : 'Résultat imposable'}</span><b>{M(c.net)}</b><span>{f.tax_regime === 'is' ? 'après impôt sur les sociétés' : 'avant impôt sur le revenu'}</span></div>
          <div className={'kpi' + (c.cash < 0 ? ' bad' : '')}><span>Trésorerie dégagée</span><b>{M(c.cash)}</b><span>CAF − remboursement des emprunts</span></div>
          <div className="kpi"><span>Point mort</span><b>{c.breakevenCA == null ? '—' : M(c.breakevenCA)}</b><span>{c.breakevenMembers != null ? 'soit ' + c.breakevenMembers + ' adhérents (tu en as ' + c.members + ')' : 'de CA HT nécessaire'}</span></div>
        </div>
      </div>

      <div className="grid g2 top">
        <div className="card">
          <div className="spread"><h3>Compte de résultat</h3><span className="sub">{per === 'annee' ? 'Annuel' : 'Mensuel'} · % du CA</span></div>
          <table className="fintable pl"><tbody>
            {rows.map((r, i) => r.t === 'l'
              ? <tr key={i} className={r.v < 0 ? 'minus' : ''}><td className="acc">{r.code}</td><td>{r.label}</td><td className="num">{r.v < 0 ? '− ' + M(-r.v) : M(r.v)}</td><td className="num pc">{pct(Math.abs(r.v), c.ca)}</td></tr>
              : <tr key={i} className={r.t}><td /><td>{r.label}</td><td className="num">{M(r.v)}</td><td className="num pc">{pct(r.v, c.ca)}</td></tr>)}
          </tbody></table>
          {!c.ca && <Empty>{auto ? 'Aucun abonnement actif pour l’instant : ajoute tes autres recettes dans « Produits ».' : 'Saisis ton chiffre d’affaires dans « Produits » ci-dessous (par exemple le total mensuel de ton logiciel de réservation).'}</Empty>}
        </div>

        <div className="stack">
          <div className="card">
            <h3>Trésorerie</h3>
            <table className="fintable"><tbody>
              <tr><td>{f.tax_regime === 'is' ? 'Résultat net' : 'Résultat'}</td><td className="num">{M(c.net)}</td></tr>
              {c.g('681') > 0 && <tr><td>+ Amortissements (charge sans sortie d'argent)</td><td className="num">{M(c.g('681'))}</td></tr>}
              <tr className="sig"><td>Capacité d'autofinancement (CAF)</td><td className="num">{M(c.caf)}</td></tr>
              {c.capital > 0 && <tr className="minus"><td>Remboursement du capital des emprunts</td><td className="num">− {M(c.capital)}</td></tr>}
              <tr className="total"><td>Trésorerie dégagée</td><td className="num">{M(c.cash)}</td></tr>
            </tbody></table>
            <p className="sub">C'est l'argent qui reste vraiment sur le compte pour te rémunérer{f.tax_regime === 'is' ? ' (dividendes)' : ''}, investir ou constituer une réserve.</p>
          </div>
          {f.vat_registered && <div className="card">
            <h3>TVA</h3>
            <table className="fintable"><tbody>
              <tr><td>TVA collectée sur tes ventes</td><td className="num">{M(c.vatCollected)}</td></tr>
              <tr className="minus"><td>TVA déductible sur tes achats</td><td className="num">− {M(c.vatDeductible)}</td></tr>
              <tr className="total"><td>{c.vatDue >= 0 ? 'TVA à reverser' : 'Crédit de TVA (à récupérer)'}</td><td className="num">{M(Math.abs(c.vatDue))}</td></tr>
            </tbody></table>
            <p className="sub">Elle n'apparaît pas dans le résultat : elle transite par ta salle pour le compte de l'État. Garde-la de côté.</p>
          </div>}
        </div>
      </div>

      <div className="grid g2 top">
        <div className="card">
          <h3>Indicateurs</h3>
          <table className="fintable"><tbody>
            <tr><td>Taux de marge sur coûts variables</td><td className="num">{pct(c.mcvRate * 100, 100)}</td></tr>
            <tr><td>Charges fixes</td><td className="num">{M(c.fixed)}</td></tr>
            <tr><td>Masse salariale (salaires, charges, coachs indépendants) / CA</td><td className="num">{pct(c.personnel + c.g('611'), c.ca)}</td></tr>
            <tr><td>Loyer / CA</td><td className="num">{pct(c.g('613'), c.ca)}</td></tr>
            <tr><td>Taux de marge (EBE / CA)</td><td className="num">{pct(c.ebe, c.ca)}</td></tr>
            {c.members > 0 && <tr><td>CA HT moyen par adhérent et par mois</td><td className="num">{money(c.perMember)}</td></tr>}
            {c.members > 0 && <tr><td>Résultat par adhérent et par mois</td><td className="num">{money(c.net / c.members)}</td></tr>}
            {c.breakevenCA != null && c.ca > 0 && <tr><td>Point mort atteint dans l'année</td><td className="num">{c.breakevenCA <= c.ca ? 'au ' + Math.max(1, Math.round(c.breakevenCA / c.ca * 365)) + 'e jour' : 'non atteint'}</td></tr>}
          </tbody></table>
          <p className="sub">Point mort = charges fixes ÷ taux de marge sur coûts variables. Coûts variables retenus : marchandises et commissions de paiement.</p>
        </div>
        <div className="card">
          <h3>Où part l'argent</h3>
          <div className="bars">
            {groups.map(([l, v]) => <div className="barrow" key={l}><span>{l}</span><div className="bar"><i style={{ width: (v / totalCost * 100) + '%' }} /></div><b className="num">{M(v)}</b></div>)}
            {!groups.length && <Empty>Ajoute tes charges et tes salaires pour voir la répartition.</Empty>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <h3>Saisie</h3>
          <div className="seg">{[['revenues', 'Produits'], ['charges', 'Charges'], ['staff', 'Personnel'], ['assets', 'Investissements'], ['loans', 'Emprunts'], ['hyp', 'Fiscalité']].map(([key, l]) => <button key={key} className="rper" aria-pressed={edit === key} onClick={() => setEdit(key)}>{l}</button>)}</div>
        </div>

        {edit === 'revenues' && <>
          {auto && <p className="notice">Les abonnements et carnets vendus dans Le Socle sont comptés automatiquement en 706 ({money(c.subsHT)} HT / mois). Ajoute ici tes autres recettes.</p>}
          {!auto && <p className="sub">Reporte ici ton chiffre d'affaires (par exemple le total mensuel de tes abonnements depuis ton logiciel de réservation), puis tes autres recettes.</p>}
          <LineTable kind="revenues" accounts={REVENUE_ACCOUNTS} presets={REVENUE_PRESETS} lines={c.rev} f={f} set={set} patch={patch} drop={drop} M={M}
            empty="Aucune recette saisie." />
        </>}

        {edit === 'charges' && <LineTable kind="charges" accounts={CHARGE_ACCOUNTS} presets={CHARGE_PRESETS} lines={c.ch} f={f} set={set} patch={patch} drop={drop} M={M}
          empty="Ajoute ton loyer, ton électricité, tes licences… avec la liste ci-dessus." />}

        {edit === 'staff' && <>
          <div className="row end"><button className="btn small" onClick={() => set('staff', [...f.staff, { id: uid(), name: '', role: 'Coach', type: 'salarie', basis: 'brut', amount_cents: 0 }])}>+ Ajouter une personne</button></div>
          <div className="scroll"><table className="edittable">
            <thead><tr><th>Nom</th><th>Rôle</th><th>Statut</th><th>Montant mensuel (€)</th><th>641 Brut</th><th>645 Patronal</th><th>Coût total</th><th /></tr></thead>
            <tbody>
              {c.st.map((s) => (
                <tr key={s.id}>
                  <td><input value={s.name} onChange={(e) => patch('staff', s.id, { name: e.target.value })} placeholder="Prénom" aria-label="Nom" /></td>
                  <td><input value={s.role} onChange={(e) => patch('staff', s.id, { role: e.target.value })} aria-label="Rôle" /></td>
                  <td><select value={s.type === 'independant' ? 'facture' : s.basis} onChange={(e) => patch('staff', s.id, e.target.value === 'facture' ? { type: 'independant', basis: 'facture' } : { type: 'salarie', basis: e.target.value })}>
                    <option value="brut">Salarié · brut</option><option value="net">Salarié · net</option><option value="facture">Indépendant · facture (611)</option></select></td>
                  <td><input className="amount" inputMode="decimal" value={eur(s.amount_cents) || ''} onChange={(e) => patch('staff', s.id, { amount_cents: cents(e.target.value) })} aria-label="Montant" /></td>
                  <td className="num">{s.type === 'independant' ? '—' : M(s.m.brut)}</td>
                  <td className="num">{s.type === 'independant' ? '—' : M(s.m.patronal)}</td>
                  <td className="num"><b>{M(s.m.cost)}</b></td>
                  <td><button className="btn small ghost" onClick={() => drop('staff', s.id)} aria-label="Supprimer">×</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!f.staff.length && <Empty>Ajoute tes salariés (en brut ou en net) et tes coachs indépendants (montant facturé).</Empty>}
          <div className="form sep">
            <label>Charges patronales (% du brut)<input type="number" step="1" min="0" max="80" value={f.employer_rate} onChange={(e) => set('employer_rate', e.target.value)} /></label>
            <label>Charges salariales (% du brut, pour convertir un net)<input type="number" step="1" min="0" max="50" value={f.employee_rate} onChange={(e) => set('employee_rate', e.target.value)} /></label>
          </div>
        </>}

        {edit === 'assets' && <>
          <p className="sub">Le matériel durable (racks, rameurs, bikes, travaux) ne se passe pas en charge d'un coup : il s'amortit sur sa durée d'utilisation (compte 681).</p>
          <div className="row end"><button className="btn small" onClick={() => set('assets', [...f.assets, { id: uid(), label: '', amount_cents: 0, years: 5 }])}>+ Ajouter un investissement</button></div>
          <div className="scroll"><table className="edittable">
            <thead><tr><th>Investissement</th><th>Montant HT (€)</th><th>Durée (ans)</th><th>Dotation</th><th /></tr></thead>
            <tbody>
              {c.as.map((a) => (
                <tr key={a.id}>
                  <td><input value={a.label} onChange={(e) => patch('assets', a.id, { label: e.target.value })} placeholder="Ex. : racks et barres" aria-label="Investissement" /></td>
                  <td><input className="amount" inputMode="decimal" value={eur(a.amount_cents) || ''} onChange={(e) => patch('assets', a.id, { amount_cents: cents(e.target.value) })} aria-label="Montant" /></td>
                  <td><select value={a.years} onChange={(e) => patch('assets', a.id, { years: Number(e.target.value) })}>{[3, 4, 5, 7, 10, 15].map((y) => <option key={y} value={y}>{y} ans</option>)}</select></td>
                  <td className="num">{M(a.dot)}</td>
                  <td><button className="btn small ghost" onClick={() => drop('assets', a.id)} aria-label="Supprimer">×</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!f.assets.length && <Empty>Aucun investissement saisi.</Empty>}
        </>}

        {edit === 'loans' && <>
          <p className="sub">Seuls les intérêts sont une charge (661). Le capital remboursé sort de la trésorerie mais ne diminue pas le résultat.</p>
          <div className="row end"><button className="btn small" onClick={() => set('loans', [...f.loans, { id: uid(), label: '', remaining_cents: 0, rate: 4, payment_cents: 0 }])}>+ Ajouter un emprunt</button></div>
          <div className="scroll"><table className="edittable">
            <thead><tr><th>Emprunt</th><th>Capital restant dû (€)</th><th>Taux annuel (%)</th><th>Mensualité (€)</th><th>Intérêts / mois</th><th>Capital / mois</th><th /></tr></thead>
            <tbody>
              {c.lo.map((l) => (
                <tr key={l.id}>
                  <td><input value={l.label} onChange={(e) => patch('loans', l.id, { label: e.target.value })} placeholder="Ex. : prêt matériel" aria-label="Emprunt" /></td>
                  <td><input className="amount" inputMode="decimal" value={eur(l.remaining_cents) || ''} onChange={(e) => patch('loans', l.id, { remaining_cents: cents(e.target.value) })} aria-label="Capital restant" /></td>
                  <td><input className="amount" inputMode="decimal" value={l.rate} onChange={(e) => patch('loans', l.id, { rate: e.target.value })} aria-label="Taux" /></td>
                  <td><input className="amount" inputMode="decimal" value={eur(l.payment_cents) || ''} onChange={(e) => patch('loans', l.id, { payment_cents: cents(e.target.value) })} aria-label="Mensualité" /></td>
                  <td className="num">{money(l.int)}</td>
                  <td className="num">{money(l.cap)}</td>
                  <td><button className="btn small ghost" onClick={() => drop('loans', l.id)} aria-label="Supprimer">×</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!f.loans.length && <Empty>Aucun emprunt saisi.</Empty>}
        </>}

        {edit === 'hyp' && <div className="form">
          <label className="full inline"><input type="checkbox" checked={!!f.vat_registered} onChange={(e) => set('vat_registered', e.target.checked)} /> La salle facture la TVA (pas en franchise en base)</label>
          {f.vat_registered && <label>TVA sur les abonnements suivis dans Le Socle (%)<input type="number" step="0.1" min="0" max="30" value={f.vat_rate} onChange={(e) => set('vat_rate', e.target.value)} /></label>}
          <label>Imposition des bénéfices<select value={f.tax_regime} onChange={(e) => set('tax_regime', e.target.value)}>
            <option value="is">Société à l'impôt sur les sociétés (SAS, SARL…)</option><option value="ir">Entreprise individuelle ou société à l'IR</option></select></label>
          {f.tax_regime === 'is' && <label className="full inline"><input type="checkbox" checked={f.is_reduced !== false} onChange={(e) => set('is_reduced', e.target.checked)} /> Taux réduit PME : 15 % jusqu'à 42 500 € de bénéfice, 25 % au-delà</label>}
          <p className="sub full">Estimations indicatives : ton expert-comptable confirme tes taux (réductions de charges, éligibilité au taux réduit, statut des coachs).</p>
        </div>}
      </div>

      {dirty && <div className="savebar"><span>Modifications non enregistrées</span><button className="btn" onClick={save}>Enregistrer</button></div>}
    </div>
  )
}

function LineTable({ kind, accounts, presets, lines, f, set, patch, drop, M, empty }) {
  return <>
    <div className="row end">
      <select value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) set(kind, [...f[kind], { id: uid(), label: p[0], account: p[1], period: p[2], vat: p[3], ttc: p[4], amount_cents: 0 }]) }} aria-label="Ajouter une ligne">
        <option value="">+ Ajouter…</option>
        {presets.map((p, i) => <option key={p[0]} value={i}>{p[1]} · {p[0]}</option>)}
      </select>
      <button className="btn small ghost" onClick={() => set(kind, [...f[kind], { id: uid(), label: '', account: Object.keys(accounts)[kind === 'charges' ? 1 : 0], period: 'mois', vat: 20, ttc: true, amount_cents: 0 }])}>+ Ligne vide</button>
    </div>
    <div className="scroll"><table className="edittable">
      <thead><tr><th>Libellé</th><th>Compte</th><th>Montant (€)</th><th>Saisi en</th><th>TVA</th><th>Par</th><th>{f.vat_registered ? 'Montant HT' : 'Montant retenu'}</th><th /></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td><input value={l.label} onChange={(e) => patch(kind, l.id, { label: e.target.value })} aria-label="Libellé" /></td>
            <td><select value={l.account} onChange={(e) => patch(kind, l.id, { account: e.target.value })} title={accounts[l.account] ? accounts[l.account][1] : ''}>{Object.entries(accounts).map(([code, a]) => <option key={code} value={code}>{code} · {a[0]}</option>)}</select></td>
            <td><input className="amount" inputMode="decimal" value={eur(l.amount_cents) || ''} onChange={(e) => patch(kind, l.id, { amount_cents: cents(e.target.value) })} aria-label="Montant" /></td>
            <td><select value={l.ttc ? 'ttc' : 'ht'} onChange={(e) => patch(kind, l.id, { ttc: e.target.value === 'ttc' })}><option value="ttc">TTC</option><option value="ht">HT</option></select></td>
            <td>{l.account === '635' ? <span className="sub">sans</span> : <select value={l.vat} onChange={(e) => patch(kind, l.id, { vat: Number(e.target.value) })}>{[0, 5.5, 10, 20].map((v) => <option key={v} value={v}>{v} %</option>)}</select>}</td>
            <td><select value={l.period} onChange={(e) => patch(kind, l.id, { period: e.target.value })}><option value="mois">mois</option><option value="an">an</option></select></td>
            <td className="num">{M(l.m.ht)}</td>
            <td><button className="btn small ghost" onClick={() => drop(kind, l.id)} aria-label="Supprimer">×</button></td>
          </tr>
        ))}
      </tbody>
    </table></div>
    {!lines.length && <Empty>{empty}</Empty>}
  </>
}
