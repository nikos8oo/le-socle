import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt } from '../lib/dates'
import { KIND_LBL, METHODS, PERIOD_LBL, TEMPLATES, money, monthly, priceText, ruleText } from '../lib/plans'
import { Empty, Modal, Pill } from '../components/ui'

export function useUsage(boxId) {
  const [usage, setUsage] = useState([])
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('subscription_usage', { p_box: boxId })
    setUsage(data || [])
  }, [boxId])
  useEffect(() => { load() }, [load])
  return [usage, load]
}

export default function Plans({ box, data, reload, toast, log }) {
  const [edit, setEdit] = useState(null)
  const [showArch, setShowArch] = useState(false)
  const [usage, reloadUsage] = useUsage(box.id)
  const [method, setMethod] = useState({})
  const plans = data.plans.filter((p) => p.active)
  const archived = data.plans.filter((p) => !p.active)
  const pending = usage.filter((u) => u.status === 'attente_paiement')
  const active = usage.filter((u) => u.status === 'active')
  const mrr = active.reduce((a, u) => a + monthly(u), 0)
  const memberName = (id) => (data.members.find((m) => m.id === id) || {}).name || 'Adhérent'
  const count = (pid) => active.filter((u) => u.plan_id === pid).length

  async function validate(u) {
    const { error } = await supabase.rpc('activate_subscription', { p_sub: u.id, p_method: method[u.id] || 'sur_place' })
    if (error) return toast(error.message)
    await log('Formule activée : ' + u.name + ' pour ' + memberName(u.member_id))
    toast('Formule activée')
    reloadUsage()
  }
  async function refuse(u) {
    if (!window.confirm('Refuser la demande « ' + u.name + ' » de ' + memberName(u.member_id) + ' ?')) return
    const { error } = await supabase.from('subscriptions').delete().eq('id', u.id)
    if (error) return toast(error.message)
    reloadUsage()
  }
  async function save(p) {
    const row = {
      name: p.name.trim(), kind: p.kind,
      per_week: p.kind === 'hebdo' ? Number(p.per_week) : null,
      sessions: p.kind === 'carnet' ? Number(p.sessions) : null,
      validity_days: p.kind === 'carnet' && Number(p.validity_days) ? Number(p.validity_days) : null,
      price_cents: Math.round((Number(String(p.price).replace(',', '.')) || 0) * 100),
      period: p.period, commitment_months: Number(p.commitment_months) || 0,
      course_types: p.course_types && p.course_types.length ? p.course_types : null,
      description: (p.description || '').trim() || null, for_sale: !!p.for_sale,
    }
    const q = p.id ? supabase.from('plans').update(row).eq('id', p.id) : supabase.from('plans').insert({ ...row, box_id: box.id, sort: data.plans.length })
    const { error } = await q
    if (error) return toast(error.message)
    if (!p.id) await log('Formule créée : ' + row.name)
    setEdit(null)
    toast('Formule enregistrée')
    reload()
  }
  async function setActive(p, v) {
    const { error } = await supabase.from('plans').update({ active: v }).eq('id', p.id)
    if (error) return toast(error.message)
    reload()
  }
  async function toggleSale(p) {
    const { error } = await supabase.from('plans').update({ for_sale: !p.for_sale }).eq('id', p.id)
    if (error) return toast(error.message)
    reload()
  }
  const open = (p) => setEdit({ for_sale: true, period: 'mois', commitment_months: 0, course_types: [], ...p, price: p.price_cents != null ? String(p.price_cents / 100).replace('.', ',') : '' })

  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><span>Abonnés actifs</span><b>{new Set(active.map((u) => u.member_id)).size}</b><span>sur {data.members.length} adhérents</span></div>
        <div className="kpi"><span>Revenu mensuel récurrent</span><b>{money(mrr)}</b><span>abonnements actifs, hors carnets</span></div>
        <div className="kpi"><span>Carnets en cours</span><b>{active.filter((u) => u.kind === 'carnet').length}</b><span>&nbsp;</span></div>
        <div className={'kpi' + (pending.length ? ' hl' : '')}><span>Demandes à valider</span><b>{pending.length}</b><span>achats dans la boutique</span></div>
      </div>

      {pending.length > 0 && (
        <div className="card">
          <h2>Demandes à valider</h2>
          <p className="sub">Ces adhérents ont choisi une formule dans la boutique. Valide quand le paiement est reçu : la formule s'active et ils peuvent réserver.</p>
          <div className="list">
            {pending.map((u) => (
              <div className="prow" key={u.id}>
                <div style={{ flex: 1, minWidth: 180 }}><b>{memberName(u.member_id)}</b><div className="sub">{u.name} · {money(u.price_cents)} · demandé le {fmt(u.created_at.slice(0, 10))}</div></div>
                <select value={method[u.id] || 'sur_place'} onChange={(e) => setMethod({ ...method, [u.id]: e.target.value })} aria-label="Moyen de paiement">{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <button className="btn small" onClick={() => validate(u)}>Paiement reçu</button>
                <button className="btn small ghost" onClick={() => refuse(u)}>Refuser</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="spread"><div><h2>Mes formules</h2><p className="sub">Ce que tes adhérents peuvent acheter. Les réservations sont bloquées selon la formule : quota par semaine, ou séances décomptées pour un carnet.</p></div>
          <button className="btn" onClick={() => open({ name: '', kind: 'hebdo', per_week: 3 })}>Créer une formule sur mesure</button></div>
        <div className="plangrid">
          {plans.map((p) => (
            <div className="plancard" key={p.id}>
              <div className="spread"><span className="tag teal">{KIND_LBL[p.kind]}</span>{!p.for_sale && <Pill>Hors boutique</Pill>}</div>
              <b className="pname">{p.name}</b>
              <span className="pprice">{priceText(p)}</span>
              <span className="sub">{ruleText(p)}{p.commitment_months ? ' · engagement ' + p.commitment_months + ' mois' : ''}</span>
              {p.course_types && <span className="sub">Cours : {p.course_types.join(', ')}</span>}
              <span className="sub">{count(p.id)} abonné{count(p.id) > 1 ? 's' : ''} actif{count(p.id) > 1 ? 's' : ''}</span>
              <div className="row">
                <button className="btn small ghost" onClick={() => open(p)}>Modifier</button>
                <button className="btn small ghost" onClick={() => toggleSale(p)}>{p.for_sale ? 'Retirer de la boutique' : 'Mettre en boutique'}</button>
                <button className="btn small ghost" onClick={() => setActive(p, false)}>Archiver</button>
              </div>
            </div>
          ))}
          {!plans.length && <Empty>Aucune formule pour l'instant. Commence avec les modèles ci-dessous : tant qu'il n'y a aucune formule, la réservation reste libre.</Empty>}
        </div>
        {archived.length > 0 && <button className="linkbtn" onClick={() => setShowArch(!showArch)}>{showArch ? 'Masquer' : 'Voir'} les formules archivées ({archived.length})</button>}
        {showArch && archived.map((p) => <div className="prow" key={p.id}><span style={{ flex: 1 }}>{p.name} · {priceText(p)}</span><button className="btn small ghost" onClick={() => setActive(p, true)}>Réactiver</button></div>)}
      </div>

      <div className="card">
        <h3>Ajouter à partir d'un modèle</h3>
        <p className="sub">Les formules classiques d'une box. Les prix sont indicatifs : tu les ajustes avant d'enregistrer.</p>
        <div className="row">{TEMPLATES.map((tp) => <button key={tp.name} className="btn small ghost" onClick={() => open(tp)}>{tp.name}</button>)}</div>
      </div>

      {edit && <PlanEditor p={edit} types={data.course_types} onSave={save} onClose={() => setEdit(null)} />}
    </div>
  )
}

function PlanEditor({ p, types, onSave, onClose }) {
  const [f, setF] = useState(p)
  const set = (k, v) => setF({ ...f, [k]: v })
  const preview = { ...f, price_cents: Math.round((Number(String(f.price).replace(',', '.')) || 0) * 100) }
  function setKind(kind) {
    setF({ ...f, kind, period: kind === 'carnet' ? 'unique' : f.period === 'unique' ? 'mois' : f.period, sessions: f.sessions || 10, validity_days: f.validity_days ?? 180, per_week: f.per_week || 3 })
  }
  return (
    <Modal title={p.id ? 'Modifier la formule' : 'Nouvelle formule'} onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
        <div className="seg">{Object.entries(KIND_LBL).map(([k, l]) => <button type="button" key={k} className="rper" aria-pressed={f.kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
        <div className="form">
          <label className="full">Nom affiché<input required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex. : 3 séances / semaine" /></label>
          {f.kind === 'hebdo' && <label>Séances par semaine<input type="number" min="1" max="14" required value={f.per_week} onChange={(e) => set('per_week', e.target.value)} /></label>}
          {f.kind === 'carnet' && <>
            <label>Nombre de séances<input type="number" min="1" max="200" required value={f.sessions} onChange={(e) => set('sessions', e.target.value)} /></label>
            <label>Validité<select value={f.validity_days || 0} onChange={(e) => set('validity_days', Number(e.target.value))}>
              {[[30, '1 mois'], [90, '3 mois'], [180, '6 mois'], [365, '1 an'], [0, 'Sans limite']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          </>}
          <label>Prix TTC (€)<input inputMode="decimal" required value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="69" /></label>
          <label>Paiement<select value={f.period} onChange={(e) => set('period', e.target.value)}>{Object.entries(PERIOD_LBL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {f.kind !== 'carnet' && <label>Engagement<select value={f.commitment_months} onChange={(e) => set('commitment_months', Number(e.target.value))}>{[0, 3, 6, 12].map((m) => <option key={m} value={m}>{m ? m + ' mois' : 'Sans engagement'}</option>)}</select></label>}
          <label className="full">Description (affichée dans la boutique)<textarea value={f.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Ex. : idéal pour reprendre en douceur" /></label>
        </div>
        {types.length > 0 && (
          <div>
            <p className="phase">Cours compris</p>
            <div className="row">
              <label className="inline chip"><input type="checkbox" checked={!(f.course_types || []).length} onChange={() => set('course_types', (f.course_types || []).length ? [] : [types[0].name])} />Tous les cours</label>
              {types.map((t) => { const on = (f.course_types || []).includes(t.name); return (
                <label className="inline chip" key={t.id || t.name}><input type="checkbox" checked={on} onChange={() => set('course_types', on ? f.course_types.filter((x) => x !== t.name) : [...(f.course_types || []), t.name])} />{t.name}</label>
              ) })}
            </div>
            <p className="sub">{(f.course_types || []).length ? 'Seulement : ' + f.course_types.join(', ') : 'La formule donne accès à tous les cours, y compris ceux ajoutés plus tard.'}</p>
          </div>
        )}
        <label className="inline"><input type="checkbox" checked={!!f.for_sale} onChange={(e) => set('for_sale', e.target.checked)} /> Visible dans la boutique des adhérents</label>
        <div className="preview"><span className="sub">Aperçu</span><b>{f.name || 'Nom de la formule'}</b><span className="pprice">{priceText(preview)}</span><span className="sub">{ruleText(preview)}{f.kind !== 'carnet' && f.commitment_months ? ' · engagement ' + f.commitment_months + ' mois' : ''}</span></div>
        <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Annuler</button><button className="btn">Enregistrer</button></div>
      </form>
    </Modal>
  )
}
