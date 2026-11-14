import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, diffDays, fmt, today } from '../lib/dates'
import { Empty, Modal, Pill } from '../components/ui'
import { METHODS, STATUS, money, priceText, usageText } from '../lib/plans'
import { useUsage } from './Plans'

export default function Members({ box, data, reload, toast, log, onBoxChange }) {
  const t = today()
  const rules0 = { enabled: true, open_days: 7, cancel_hours: 2, ...((box.settings || {}).booking || {}) }
  const [rules, setRules] = useState(rules0)
  const [stats, setStats] = useState({})
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('tous')
  const [newCode, setNewCode] = useState('')
  const [usage, reloadUsage] = useUsage(box.id)
  const [subsFor, setSubsFor] = useState(null)
  const subsOf = (id) => usage.filter((u) => u.member_id === id)
  const link = window.location.origin + '/?rejoindre=' + box.join_code

  useEffect(() => {
    supabase.from('bookings').select('member_id, status').eq('box_id', box.id).gte('day', addDays(t, -30)).lte('day', t).then(({ data: rows }) => {
      const s = {}
      ;(rows || []).forEach((r) => { const x = (s[r.member_id] = s[r.member_id] || { present: 0, absent: 0, tard: 0 }); if (r.status === 'present') x.present++; if (r.status === 'absent') x.absent++; if (r.status === 'annule_tard') x.tard++ })
      setStats(s)
    })
  }, [box.id, data.members.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function copy() {
    try { await navigator.clipboard.writeText(link); toast('Lien copié : partage-le à tes adhérents') } catch { window.prompt('Copie ce lien', link) }
  }
  async function changeCode(e, random) {
    if (e) e.preventDefault()
    if (random && !window.confirm("Tirer un nouveau code au hasard ? L'ancien ne fonctionnera plus (les adhérents déjà inscrits ne sont pas touchés).")) return
    const { error } = await supabase.rpc('set_join_code', { p_box: box.id, p_code: random ? null : newCode })
    if (error) return toast(error.message)
    setNewCode('')
    await onBoxChange()
    toast('Code de salle mis à jour')
  }
  async function saveRules(e) {
    e.preventDefault()
    const booking = { enabled: !!rules.enabled, require_plan: rules.require_plan !== false, open_days: Math.max(1, Math.min(30, Number(rules.open_days) || 7)), cancel_hours: Math.max(0, Math.min(48, Number(rules.cancel_hours) || 0)) }
    const { error } = await supabase.from('boxes').update({ settings: { ...(box.settings || {}), booking } }).eq('id', box.id)
    if (error) return toast(error.message)
    await log('Règles de réservation mises à jour')
    await onBoxChange()
    toast('Règles enregistrées')
  }
  async function toggle(m) {
    const { error } = await supabase.from('members').update({ active: !m.active }).eq('id', m.id)
    if (error) return toast(error.message)
    reload()
  }

  const status = (m) => {
    if (!m.active) return ['neutral', 'Suspendu']
    if (m.joined && diffDays(t, m.joined) <= 60) return ['warn', 'Nouveau']
    if (!m.last_visit) return ['bad', 'Jamais venu']
    const d = diffDays(t, m.last_visit)
    if (d > 14) return ['bad', 'Absent depuis ' + d + ' j']
    return ['good', 'Régulier']
  }
  const list = useMemo(() => data.members
    .filter((m) => !q || (m.name + ' ' + (m.email || '')).toLowerCase().includes(q.toLowerCase()))
    .filter((m) => filter === 'tous' || (filter === 'nouveaux' && status(m)[1] === 'Nouveau') || (filter === 'risque' && status(m)[0] === 'bad'))
  , [data.members, q, filter]) // eslint-disable-line react-hooks/exhaustive-deps
  const atRisk = data.members.filter((m) => status(m)[0] === 'bad').length
  const news = data.members.filter((m) => status(m)[1] === 'Nouveau').length

  return (
    <div className="stack">
      <div className="grid g2 top">
        <div className="card">
          <h2>Inscription des adhérents</h2>
          <p className="sub">L'adhérent crée son compte dans l'app puis tape ce code pour retrouver ta salle. Affiche-le à l'accueil, ou envoie directement le lien.</p>
          <div className="bigcode" aria-label="Code de la salle">{box.join_code}</div>
          <div className="linkbox"><code>{link}</code></div>
          <div className="row"><button className="btn" onClick={copy}>Copier le lien</button></div>
          <form className="row sep" onSubmit={(e) => changeCode(e, false)}>
            <input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={16} placeholder="Personnaliser, ex. BLACKWINGS" style={{ flex: 1 }} aria-label="Nouveau code" />
            <button className="btn small" disabled={newCode.length < 4}>Changer</button>
            <button type="button" className="btn small ghost" onClick={() => changeCode(null, true)}>Au hasard</button>
          </form>
        </div>
        <div className="card">
          <h2>Règles de réservation</h2>
          <form className="form" onSubmit={saveRules}>
            <label className="full inline"><input type="checkbox" checked={!!rules.enabled} onChange={(e) => setRules({ ...rules, enabled: e.target.checked })} /> Réservations en ligne ouvertes</label>
            <label className="full inline"><input type="checkbox" checked={rules.require_plan !== false} onChange={(e) => setRules({ ...rules, require_plan: e.target.checked })} /> Réserver demande une formule active (dès que tu as créé des formules)</label>
            <label>Ouverture (jours avant le cours)<input type="number" min="1" max="30" value={rules.open_days} onChange={(e) => setRules({ ...rules, open_days: e.target.value })} /></label>
            <label>Annulation sans pénalité (heures avant)<input type="number" min="0" max="48" value={rules.cancel_hours} onChange={(e) => setRules({ ...rules, cancel_hours: e.target.value })} /></label>
            <div className="row full end"><button className="btn small">Enregistrer</button></div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <div><h2>Adhérents</h2><p className="sub">{data.members.length} inscrits · {news} nouveaux (moins de 60 jours) · {atRisk} à relancer</p></div>
          <div className="row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" aria-label="Rechercher un adhérent" />
            <div className="seg">{[['tous', 'Tous'], ['nouveaux', 'Nouveaux'], ['risque', 'À relancer']].map(([k, l]) => <button key={k} className="rper" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
          </div>
        </div>
        <div className="scroll"><table>
          <thead><tr><th>Adhérent</th><th>Formule</th><th>Inscrit le</th><th>Dernière venue</th><th>30 derniers jours</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {list.map((m) => { const s = stats[m.id] || { present: 0, absent: 0, tard: 0 }, st = status(m); return (
              <tr key={m.id}>
                <td><b>{m.name}</b><div className="sub">{m.email || ''}{m.phone ? ' · ' + m.phone : ''}</div></td>
                <td>{(() => { const ss = subsOf(m.id).filter((u) => u.status === 'active' || u.status === 'attente_paiement'); return ss.length ? ss.map((u) => <div key={u.id}><b>{u.name}</b><div className="sub">{usageText(u)}</div></div>) : <span className="sub">Aucune</span> })()}</td>
                <td>{fmt(m.joined)}</td>
                <td>{fmt(m.last_visit)}</td>
                <td>{s.present} venue{s.present > 1 ? 's' : ''}{s.absent ? <span className="sub"> · {s.absent} absences</span> : null}{s.tard ? <span className="sub"> · {s.tard} annul. tardives</span> : null}</td>
                <td><Pill cls={st[0]}>{st[1]}</Pill></td>
                <td><div className="row"><button className="btn small" onClick={() => setSubsFor(m)}>Formules</button><button className="btn small ghost" onClick={() => toggle(m)}>{m.active ? 'Suspendre' : 'Réactiver'}</button></div></td>
              </tr>
            ) })}
          </tbody>
        </table></div>
        {subsFor && <MemberSubs m={subsFor} subs={subsOf(subsFor.id)} plans={data.plans.filter((p) => p.active)} toast={toast} log={log} onClose={() => setSubsFor(null)} onChange={reloadUsage} />}
        {!list.length && <Empty>{data.members.length ? 'Aucun adhérent ne correspond.' : 'Aucun adhérent pour l’instant : partage le lien d’inscription.'}</Empty>}
      </div>
    </div>
  )
}

function MemberSubs({ m, subs, plans, toast, log, onClose, onChange }) {
  const [f, setF] = useState({ plan: plans[0] ? plans[0].id : '', start: today(), method: 'sur_place' })
  async function assign(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('assign_plan', { p_member: m.id, p_plan: f.plan, p_start: f.start, p_method: f.method })
    if (error) return toast(error.message)
    await log('Formule attribuée à ' + m.name)
    toast('Formule attribuée')
    onChange()
  }
  async function setStatus(u, status) {
    const patch = { status }
    if (status === 'terminee') patch.end_date = today()
    const { error } = await supabase.from('subscriptions').update(patch).eq('id', u.id)
    if (error) return toast(error.message)
    onChange()
  }
  async function activate(u) {
    const { error } = await supabase.rpc('activate_subscription', { p_sub: u.id, p_method: f.method })
    if (error) return toast(error.message)
    onChange()
  }
  return (
    <Modal title={'Formules de ' + m.name} onClose={onClose} wide>
      <div className="list">
        {subs.map((u) => (
          <div className="prow" key={u.id}>
            <div style={{ flex: 1, minWidth: 200 }}><b>{u.name}</b> <Pill cls={STATUS[u.status][0]}>{STATUS[u.status][1]}</Pill>
              <div className="sub">{usageText(u)} · {money(u.price_cents)} · depuis le {fmt(u.start_date)}{u.end_date ? ' · jusqu’au ' + fmt(u.end_date) : ''}{u.commitment_until ? ' · engagé jusqu’au ' + fmt(u.commitment_until) : ''}</div></div>
            {u.status === 'attente_paiement' && <button className="btn small" onClick={() => activate(u)}>Paiement reçu</button>}
            {u.status === 'active' && <button className="btn small ghost" onClick={() => setStatus(u, 'suspendue')}>Suspendre</button>}
            {u.status === 'suspendue' && <button className="btn small ghost" onClick={() => setStatus(u, 'active')}>Réactiver</button>}
            {(u.status === 'active' || u.status === 'suspendue') && <button className="btn small ghost" onClick={() => setStatus(u, 'terminee')}>Terminer</button>}
          </div>
        ))}
        {!subs.length && <Empty>Aucune formule pour cet adhérent.</Empty>}
      </div>
      {plans.length ? (
        <form className="form sep" onSubmit={assign}>
          <label className="full">Attribuer une formule<select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {priceText(p)}</option>)}</select></label>
          <label>À partir du<input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
          <label>Payé par<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <div className="row full end"><button className="btn">Attribuer</button></div>
        </form>
      ) : <p className="sub">Crée d'abord tes formules dans l'onglet Formules.</p>}
    </Modal>
  )
}
