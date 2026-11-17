import { useState } from 'react'
import LearnLink from '../components/LearnLink'
import { supabase } from '../lib/supabase'
import { diffDays, fmt, num, today } from '../lib/dates'
import { CRITS, LVL } from '../lib/method'
import { Empty, Modal, Pill } from '../components/ui'

const ROLES = ['Head coach', 'Coach', 'Stagiaire']

export default function Team({ box, data, reload, toast, log, session, isAdmin }) {
  const t = today()
  const [edit, setEdit] = useState(null)
  const [obsFor, setObsFor] = useState(null)
  const [inv, setInv] = useState({ email: '', role: 'coach', coach_id: '' })

  const lastObs = (id) => data.observations.find((o) => o.coach_id === id)
  const avg = (o) => { const v = Object.values(o.scores || {}).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const linked = (id) => data.box_members.find((m) => m.coach_id === id)
  const link = (token) => window.location.origin + '/?invite=' + token

  async function saveCoach(c) {
    const row = { name: c.name.trim(), role_label: c.role_label }
    const q = c.id ? supabase.from('coaches').update(row).eq('id', c.id) : supabase.from('coaches').insert({ ...row, box_id: box.id })
    const { error } = await q
    if (error) return toast(error.message)
    if (!c.id) await log('Coach ajouté : ' + row.name)
    setEdit(null)
    reload()
  }
  async function delCoach(c) {
    if (!window.confirm('Retirer ' + c.name + " de l'équipe ? Ses essais et observations seront supprimés.")) return
    const { error } = await supabase.from('coaches').delete().eq('id', c.id)
    if (error) return toast(error.message)
    setEdit(null)
    reload()
  }
  async function invite(e) {
    e.preventDefault()
    const row = { box_id: box.id, email: inv.email.trim().toLowerCase(), role: inv.role, coach_id: inv.role === 'coach' ? inv.coach_id || null : null, created_by: session.user.id }
    if (inv.role === 'coach' && !row.coach_id) return toast('Choisis la fiche coach à relier')
    const { data: r, error } = await supabase.from('invitations').insert(row).select().single()
    if (error) return toast(error.message)
    try { await navigator.clipboard.writeText(link(r.token)); toast('Lien copié : envoie-le à ' + row.email) } catch { toast('Invitation créée') }
    setInv({ email: '', role: 'coach', coach_id: '' })
    reload()
  }
  async function revoke(i) {
    const { error } = await supabase.from('invitations').delete().eq('id', i.id)
    if (error) return toast(error.message)
    reload()
  }
  async function copy(i) {
    try { await navigator.clipboard.writeText(link(i.token)); toast('Lien copié') } catch { window.prompt('Copie ce lien', link(i.token)) }
  }

  const pending = data.invitations.filter((i) => !i.accepted_at)

  return (
    <div className="stack">
      <div className="card">
        <div className="spread"><div><h2>L'équipe</h2><p className="sub">Une fiche par coach. Observation d'un cours complet au moins une fois par trimestre, avec la grille des 7 critères.</p><LearnLink k="team" /></div>
          <button className="btn" onClick={() => setEdit({ name: '', role_label: 'Coach' })}>Ajouter un coach</button></div>
        <div className="grid g3">
          {data.coaches.map((c) => { const o = lastObs(c.id), a = o && avg(o), late = !o || diffDays(t, o.day) > 92; return (
            <div className="kpi" key={c.id}>
              <div className="spread"><b className="big">{c.name}</b><span className="tag">{c.role_label}</span></div>
              <span>{o ? 'Dernière observation : ' + fmt(o.day) + (a ? ' · moyenne ' + num(a, 1) + ' / 3' : '') : 'Jamais observé'}</span>
              <span>{linked(c.id) ? <Pill cls="good">Compte relié</Pill> : <Pill>Pas encore de compte</Pill>} {late && <Pill cls="warn">Observation à prévoir</Pill>}</span>
              {c.path && <span className="sub">{c.path === 'prime' ? 'Prime à la transformation' : 'Plan de formation'}</span>}
              <div className="row"><button className="btn small" onClick={() => setObsFor(c)}>Observer un cours</button><button className="btn small ghost" onClick={() => setEdit(c)}>Modifier</button></div>
            </div>
          ) })}
          {!data.coaches.length && <Empty>Ajoute tes coachs pour leur attribuer des tâches et des essais.</Empty>}
        </div>
      </div>

      <div className="grid g2 top">
        <div className="card">
          <h3>Accès à l'app</h3>
          {isAdmin ? <>
          <p className="sub">Crée l'invitation, le lien est copié : envoie-le par message. Le coach crée son compte avec cet e-mail et arrive directement dans ta salle, sans accès aux chiffres.</p>
          <form className="form" onSubmit={invite}>
            <label>E-mail<input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
            <label>Accès<select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="coach">Coach</option><option value="owner">Owner (associé)</option></select></label>
            {inv.role === 'coach' && <label className="full">Fiche coach<select value={inv.coach_id} onChange={(e) => setInv({ ...inv, coach_id: e.target.value })}><option value="">Choisir…</option>{data.coaches.filter((c) => !linked(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            <div className="row full end"><button className="btn">Créer et copier le lien</button></div>
          </form>
          </> : <p className="sub">Les accès owner et coach sont délivrés par Drill's &amp; Skills. Crée la fiche du coach ci-dessus, puis demande son invitation : il la recevra par e-mail et arrivera directement dans ta salle, sans accès aux chiffres.</p>}
          {pending.length > 0 && <>
            <p className="phase">En attente</p>
            {pending.map((i) => <div className="prow" key={i.id}><div style={{ flex: 1 }}><b>{i.email}</b><div className="sub">{i.role === 'owner' ? 'Owner' : 'Coach'} · {fmt(i.created_at.slice(0, 10))}</div></div>{isAdmin && <><button className="btn small ghost" onClick={() => copy(i)}>Copier le lien</button><button className="btn small ghost" onClick={() => revoke(i)}>Annuler</button></>}</div>)}
          </>}
        </div>
        <div className="card">
          <h3>Historique des observations</h3>
          <div className="list">
            {data.observations.slice(0, 10).map((o) => { const c = data.coaches.find((x) => x.id === o.coach_id), a = avg(o); return (
              <div className="prow" key={o.id}><div style={{ flex: 1 }}><b>{c ? c.name : '—'}</b><div className="sub">{fmt(o.day)} · par {o.observer || 'Owner'}{o.note ? ' · ' + o.note : ''}</div></div>{a && <Pill cls={a >= 2.5 ? 'good' : a >= 1.8 ? 'warn' : 'bad'}>{num(a, 1)} / 3</Pill>}</div>
            ) })}
            {!data.observations.length && <Empty>Aucune observation.</Empty>}
          </div>
        </div>
      </div>

      {edit && (
        <Modal title={edit.id ? 'Modifier ' + edit.name : 'Nouveau coach'} onClose={() => setEdit(null)}>
          <CoachForm c={edit} onSave={saveCoach} onDelete={edit.id ? () => delCoach(edit) : null} />
        </Modal>
      )}
      {obsFor && <ObsModal coach={obsFor} box={box} toast={toast} log={log} onClose={() => setObsFor(null)} onSaved={() => { setObsFor(null); reload() }} />}
    </div>
  )
}

function CoachForm({ c, onSave, onDelete }) {
  const [f, setF] = useState(c)
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
      <label>Prénom<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Rôle<select value={f.role_label} onChange={(e) => setF({ ...f, role_label: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
      <div className="row full end">{onDelete && <button type="button" className="btn ghost" onClick={onDelete}>Retirer</button>}<button className="btn">Enregistrer</button></div>
    </form>
  )
}

function ObsModal({ coach, box, toast, log, onClose, onSaved }) {
  const [scores, setScores] = useState({})
  const [f, setF] = useState({ day: today(), observer: 'Owner', note: '' })
  async function save(e) {
    e.preventDefault()
    if (Object.keys(scores).length < CRITS.length) return toast('Note les 7 critères')
    const { error } = await supabase.from('observations').insert({ box_id: box.id, coach_id: coach.id, day: f.day, observer: f.observer.trim(), note: f.note.trim(), scores })
    if (error) return toast(error.message)
    await supabase.from('coaches').update({ last_review: f.day }).eq('id', coach.id)
    await log('Cours de ' + coach.name + ' observé')
    toast('Observation enregistrée')
    onSaved()
  }
  return (
    <Modal title={'Observer ' + coach.name} onClose={onClose} wide>
      <form onSubmit={save} className="stack">
        <div className="form">
          <label>Date<input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></label>
          <label>Observé par<input value={f.observer} onChange={(e) => setF({ ...f, observer: e.target.value })} /></label>
        </div>
        {CRITS.map((c) => (
          <div className="prow" key={c.k}>
            <div style={{ flex: 1, minWidth: 180 }}><b>{c.n}</b><div className="sub">{c.d}</div></div>
            <div className="seg">{[1, 2, 3].map((v) => <button type="button" key={v} className={'lv' + v} aria-pressed={scores[c.k] === v} onClick={() => setScores({ ...scores, [c.k]: v })}>{LVL[v]}</button>)}</div>
          </div>
        ))}
        <label className="col">Plan d'action (1 à 2 points)<textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <div className="row end"><button className="btn">Enregistrer l'observation</button></div>
      </form>
    </Modal>
  )
}
