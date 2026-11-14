import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt } from '../lib/dates'
import { money } from '../lib/plans'
import { Empty, Modal, Pill } from '../components/ui'
import { stripeApi } from '../lib/stripe'

const STATUS = { pilote: ['warn', 'Pilote'], active: ['good', 'Active'], suspendue: ['bad', 'Suspendue'], archivee: ['neutral', 'Archivée'] }
const ago = (ts) => {
  if (!ts) return 'jamais'
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 864e5)
  return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : 'il y a ' + d + ' j'
}
const inviteLink = (token) => window.location.origin + '/?invite=' + token

// La console Drill's & Skills : toutes les salles, leurs chiffres, leurs accès.
export default function AdminConsole({ toast, onOpen }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [st, setSt] = useState('tous')
  const [creating, setCreating] = useState(false)
  const [sel, setSel] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_overview')
    if (error) return toast(error.message)
    setRows(data || [])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const [demoBusy, setDemoBusy] = useState(false)
  async function createDemo() {
    if (!window.confirm('Créer une salle de démo complète (80 adhérents, planning, formules, 2 mois d’historique) ? Tu pourras la supprimer en un clic.')) return
    setDemoBusy(true)
    const { data, error } = await supabase.rpc('admin_create_demo')
    setDemoBusy(false)
    if (error) return toast(error.message)
    toast('Salle de démo prête')
    await load()
    onOpen(data)
  }
  async function deleteDemo(r) {
    if (!window.confirm('Supprimer définitivement « ' + r.name + ' » et toutes ses données de démo ?')) return
    const { error } = await supabase.rpc('admin_delete_demo', { p_box: r.id })
    if (error) return toast(error.message)
    toast('Salle de démo supprimée')
    load()
  }

  if (!rows) return <div className="loading">Chargement des salles…</div>
  const live = rows.filter((r) => (r.status === 'active' || r.status === 'pilote') && !r.is_demo)
  const list = rows.filter((r) => (st === 'tous' ? r.status !== 'archivee' : r.status === st)).filter((r) => !q || (r.name + ' ' + (r.city || '') + ' ' + (r.owners || '')).toLowerCase().includes(q.toLowerCase()))
  const quiet = live.filter((r) => !r.last_activity || Date.now() - new Date(r.last_activity).getTime() > 7 * 864e5)

  return (
    <main>
      <div className="head"><h1 className="boxname">Console Drill's &amp; Skills</h1></div>
      <div className="kpis">
        <div className="kpi"><span>Salles</span><b>{live.length}</b><span>{rows.filter((r) => r.status === 'active').length} actives · {rows.filter((r) => r.status === 'pilote').length} pilotes</span></div>
        <div className="kpi"><span>Adhérents</span><b>{live.reduce((a, r) => a + r.adherents, 0)}</b><span>{live.reduce((a, r) => a + r.coaches, 0)} coachs</span></div>
        <div className="kpi"><span>Revenu mensuel des salles</span><b>{money(live.reduce((a, r) => a + r.mrr_cents, 0))}</b><span>abonnements actifs</span></div>
        <div className="kpi"><span>Réservations (30 j)</span><b>{live.reduce((a, r) => a + r.bookings_30, 0)}</b><span>{live.reduce((a, r) => a + r.presents_30, 0)} présences</span></div>
        <div className={'kpi' + (quiet.length ? ' hl' : '')}><span>À surveiller</span><b>{quiet.length}</b><span>aucune activité depuis 7 jours</span></div>
      </div>

      <div className="card">
        <div className="spread">
          <h2>Mes salles</h2>
          <div className="row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" aria-label="Rechercher une salle" />
            <div className="seg">{[['tous', 'Toutes'], ['active', 'Actives'], ['pilote', 'Pilotes'], ['suspendue', 'Suspendues'], ['archivee', 'Archivées']].map(([k, l]) => <button key={k} className="rper" aria-pressed={st === k} onClick={() => setSt(k)}>{l}</button>)}</div>
            <button className="btn ghost" disabled={demoBusy} onClick={createDemo}>{demoBusy ? 'Création de la démo…' : 'Créer une salle de démo'}</button>
            <button className="btn" onClick={() => setCreating(true)}>Nouvelle salle</button>
          </div>
        </div>
        <div className="scroll"><table>
          <thead><tr><th>Salle</th><th>Statut</th><th>Owner</th><th>Adhérents</th><th>Abonnés</th><th>Revenu / mois</th><th>Paiement CB</th><th>Réserv. 30 j</th><th>Activité</th><th></th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b> {r.is_demo && <Pill cls="warn">Démo</Pill>}<div className="sub">{r.city ? r.city + ' · ' : ''}code {r.join_code}</div></td>
                <td><Pill cls={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill></td>
                <td>{r.owners ? <span className="sub">{r.owners}</span> : r.pending_invites ? <Pill cls="warn">Invitation en attente</Pill> : <Pill cls="bad">Pas d'owner</Pill>}</td>
                <td>{r.adherents}</td>
                <td>{r.active_subs}</td>
                <td>{money(r.mrr_cents)}</td>
                <td>{r.stripe_charges_enabled ? <Pill cls="good">Actif</Pill> : r.stripe_account_id ? <Pill cls="warn">En cours</Pill> : <Pill>Non</Pill>}</td>
                <td>{r.bookings_30}{r.bookings_30 ? <span className="sub"> · {Math.round(r.presents_30 / r.bookings_30 * 100)} % venus</span> : null}</td>
                <td className={r.last_activity && Date.now() - new Date(r.last_activity).getTime() <= 7 * 864e5 ? '' : 'warntxt'}>{ago(r.last_activity)}</td>
                <td><div className="row"><button className="btn small" onClick={() => onOpen(r.id)}>Ouvrir</button>{r.is_demo ? <button className="btn small ghost" onClick={() => deleteDemo(r)}>Supprimer la démo</button> : <button className="btn small ghost" onClick={() => setSel(r)}>Gérer</button>}</div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!list.length && <Empty>Aucune salle.</Empty>}
      </div>

      {creating && <NewBox toast={toast} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
      {sel && <ManageBox box={sel} toast={toast} onClose={() => setSel(null)} onChange={load} onOpen={onOpen} />}
    </main>
  )
}

async function copy(text, toast, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg) } catch { window.prompt('Copie ce lien', text) }
}

function NewBox({ toast, onClose, onDone }) {
  const [f, setF] = useState({ name: '', city: '', email: '', status: 'pilote' })
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { data: id, error } = await supabase.rpc('create_box', { box_name: f.name })
    if (error) { setBusy(false); return toast(error.message) }
    await supabase.from('boxes').update({ city: f.city.trim() || null, status: f.status }).eq('id', id)
    if (f.email.trim()) {
      const { data: inv, error: e2 } = await supabase.from('invitations').insert({ box_id: id, email: f.email.trim().toLowerCase(), role: 'owner' }).select().single()
      if (e2) toast(e2.message)
      else { setLink(inviteLink(inv.token)); copy(inviteLink(inv.token), toast, "Salle créée, lien d'invitation copié") }
    } else toast('Salle créée')
    setBusy(false)
    if (!f.email.trim()) onDone()
  }
  return (
    <Modal title="Nouvelle salle" onClose={link ? onDone : onClose}>
      {link ? (
        <div className="stack">
          <p>La salle <b>{f.name}</b> est créée. Envoie ce lien à <b>{f.email}</b> : il crée son compte avec cette adresse et arrive directement dans sa salle en tant qu'owner.</p>
          <div className="linkbox"><code>{link}</code></div>
          <div className="row end"><button className="btn ghost" onClick={() => copy(link, toast, 'Lien copié')}>Copier à nouveau</button><button className="btn" onClick={onDone}>Terminé</button></div>
        </div>
      ) : (
        <form className="form" onSubmit={save}>
          <label className="full">Nom de la salle<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex. : CrossFit Canet" /></label>
          <label>Ville<input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Ex. : Perpignan" /></label>
          <label>Statut<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="pilote">Pilote</option><option value="active">Active</option></select></label>
          <label className="full">E-mail de l'owner (invitation)<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="owner@salle.fr" /></label>
          <div className="row full end"><button type="button" className="btn ghost" onClick={onClose}>Annuler</button><button className="btn" disabled={busy}>Créer la salle</button></div>
        </form>
      )}
    </Modal>
  )
}

function ManageBox({ box, toast, onClose, onChange, onOpen }) {
  const [people, setPeople] = useState([])
  const [invites, setInvites] = useState([])
  const [coaches, setCoaches] = useState([])
  const [f, setF] = useState({ status: box.status, city: box.city || '', admin_notes: box.admin_notes || '', name: box.name })
  const [inv, setInv] = useState({ email: '', role: 'owner', coach_id: '' })

  const load = useCallback(async () => {
    const [{ data: p }, { data: i }, { data: c }] = await Promise.all([
      supabase.rpc('admin_box_people', { p_box: box.id }),
      supabase.from('invitations').select('*').eq('box_id', box.id).is('accepted_at', null).order('created_at', { ascending: false }),
      supabase.from('coaches').select('id, name, role_label').eq('box_id', box.id).order('name'),
    ])
    setPeople(p || []); setInvites(i || []); setCoaches(c || [])
  }, [box.id])
  useEffect(() => { load() }, [load])

  async function saveInfo(e) {
    e.preventDefault()
    const { error } = await supabase.from('boxes').update({ name: f.name.trim(), status: f.status, city: f.city.trim() || null, admin_notes: f.admin_notes.trim() || null }).eq('id', box.id)
    if (error) return toast(error.message)
    toast('Salle mise à jour')
    onChange()
  }
  async function invite(e) {
    e.preventDefault()
    if (inv.role === 'coach' && !inv.coach_id) return toast('Choisis la fiche coach à relier (créée par l’owner dans Équipe)')
    const { data, error } = await supabase.from('invitations').insert({ box_id: box.id, email: inv.email.trim().toLowerCase(), role: inv.role, coach_id: inv.role === 'coach' ? inv.coach_id : null }).select().single()
    if (error) return toast(error.message)
    copy(inviteLink(data.token), toast, 'Invitation créée, lien copié')
    setInv({ email: '', role: inv.role, coach_id: '' })
    load(); onChange()
  }
  async function revoke(i) {
    const { error } = await supabase.from('invitations').delete().eq('id', i.id)
    if (error) return toast(error.message)
    load(); onChange()
  }
  async function remove(p) {
    if (!window.confirm('Retirer l’accès ' + (p.role === 'owner' ? 'owner' : 'coach') + ' de ' + p.email + ' à ' + box.name + ' ?')) return
    const { error } = await supabase.rpc('admin_remove_access', { p_box: box.id, p_user: p.user_id })
    if (error) return toast(error.message)
    load(); onChange()
  }
  async function disconnectStripe() {
    if (!window.confirm('Détacher le compte Stripe de ' + box.name + ' ? L’owner devra reconnecter sa salle depuis l’onglet Paiements. Les abonnements déjà payés sur l’ancien compte ne seront plus suivis.')) return
    try { await stripeApi('disconnect', { box_id: box.id, close: true }) } catch (e) { return toast(e.message) }
    toast('Compte Stripe détaché')
    onChange()
  }
  const linked = (cid) => people.some((p) => p.coach_name && coaches.find((c) => c.id === cid && c.name === p.coach_name))

  return (
    <Modal title={box.name} onClose={onClose} wide>
      <div className="stack">
        <form className="form" onSubmit={saveInfo}>
          <label>Nom<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label>Ville<input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
          <label>Statut<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select></label>
          <label className="full">Notes privées (visibles par toi seul)<textarea value={f.admin_notes} onChange={(e) => setF({ ...f, admin_notes: e.target.value })} placeholder="Ex. : contrat signé le…, prochaine visio le…, point d'attention…" /></label>
          <div className="row full end"><button className="btn ghost" type="button" onClick={() => onOpen(box.id)}>Ouvrir la salle</button><button className="btn">Enregistrer</button></div>
        </form>

        <div className="prow">
          <div style={{ flex: 1 }}><b>Paiement en ligne</b><div className="sub">{box.stripe_account_id ? (box.stripe_charges_enabled ? 'Actif · ' : 'Inscription Stripe en cours · ') + box.stripe_account_id : 'Pas encore connecté : l’owner le fait depuis son onglet Paiements'}</div></div>
          {box.stripe_account_id && <button className="btn small ghost" onClick={disconnectStripe}>Détacher le compte Stripe</button>}
        </div>

        <div>
          <p className="phase">Accès salle</p>
          <div className="list">
            {people.map((p) => (
              <div className="prow" key={p.user_id}>
                <div style={{ flex: 1, minWidth: 200 }}><b>{p.full_name || p.email}</b><div className="sub">{p.email} · {p.role === 'owner' ? 'Owner' : 'Coach' + (p.coach_name ? ' (' + p.coach_name + ')' : '')} · depuis le {fmt(p.created_at.slice(0, 10))}</div></div>
                <button className="btn small ghost" onClick={() => remove(p)}>Retirer l'accès</button>
              </div>
            ))}
            {!people.length && <Empty>Personne n'a encore accès à l'espace salle.</Empty>}
          </div>
        </div>

        {invites.length > 0 && <div>
          <p className="phase">Invitations en attente</p>
          {invites.map((i) => (
            <div className="prow" key={i.id}>
              <div style={{ flex: 1 }}><b>{i.email}</b><div className="sub">{i.role === 'owner' ? 'Owner' : 'Coach'} · envoyée le {fmt(i.created_at.slice(0, 10))}</div></div>
              <button className="btn small ghost" onClick={() => copy(inviteLink(i.token), toast, 'Lien copié')}>Copier le lien</button>
              <button className="btn small ghost" onClick={() => revoke(i)}>Annuler</button>
            </div>
          ))}
        </div>}

        <form className="form sep" onSubmit={invite}>
          <label>Inviter (e-mail)<input type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
          <label>Accès<select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="owner">Owner</option><option value="coach">Coach</option></select></label>
          {inv.role === 'coach' && <label className="full">Fiche coach<select value={inv.coach_id} onChange={(e) => setInv({ ...inv, coach_id: e.target.value })}>
            <option value="">{coaches.length ? 'Choisir…' : 'Aucune fiche : l’owner doit d’abord créer ses coachs'}</option>
            {coaches.filter((c) => !linked(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.role_label}</option>)}
          </select></label>}
          <div className="row full end"><button className="btn">Créer l'invitation et copier le lien</button></div>
        </form>
      </div>
    </Modal>
  )
}
