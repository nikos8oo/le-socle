import { useState } from 'react'
import { supabase } from '../lib/supabase'

const ROLE = { owner: 'Owner', coach: 'Coach', adherent: 'Adhérent', admin: 'Admin plateforme' }

export default function BoxPicker({ boxes, onPick, onCreated, onSignOut, isAdmin }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  async function search(e) {
    e.preventDefault()
    setBusy(true); setErr(''); setFound(null)
    const { data, error } = await supabase.rpc('find_box', { code })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data || !data.length) return setErr('Aucune salle ne correspond à ce code. Vérifie-le auprès de ta salle.')
    const mine = boxes.find((b) => b.id === data[0].id)
    if (mine) return onPick(mine.id)
    setFound(data[0])
  }
  async function join() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('join_box', { code })
    setBusy(false)
    if (error) return setErr(error.message)
    onCreated(data)
  }
  async function create(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('create_box', { box_name: name.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    onCreated(data)
  }

  return (
    <div className="authwrap">
      <div className="authcard" style={{ maxWidth: 520 }}>
        <div className="brand dark"><small>Drill's &amp; Skills</small><b>Le Socle</b></div>

        {boxes.length > 0 && <>
          <h1>Mes salles</h1>
          <div className="list">
            {boxes.map((b) => (
              <button key={b.id} className="boxrow" onClick={() => onPick(b.id)}>
                <b>{b.name}</b><span className="sub">{ROLE[b.myRole] || 'Admin plateforme'}</span>
              </button>
            ))}
          </div>
        </>}

        <h1 style={{ marginTop: boxes.length ? 18 : 0 }}>{boxes.length ? 'Rejoindre une autre salle' : 'Rejoindre ma salle'}</h1>
        <p className="sub">Entre le code donné par ta salle (affiché à l'accueil ou envoyé par ton coach).</p>
        <form onSubmit={search} className="row">
          <input className="codeinput" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setFound(null) }} placeholder="CODE" maxLength={16} required style={{ flex: 1 }} aria-label="Code de la salle" autoCapitalize="characters" autoComplete="off" />
          <button className="btn" disabled={busy || code.length < 4}>Chercher</button>
        </form>
        {found && (
          <div className="found">
            <span className="sub">Salle trouvée</span>
            <b>{found.name}</b>
            <button className="btn" onClick={join} disabled={busy}>Rejoindre {found.name}</button>
          </div>
        )}
        {err && <p className="err">{err}</p>}

        {!showCreate ? (
          <button className="linkbtn" onClick={() => setShowCreate(true)}>Tu es owner ? Créer ta salle</button>
        ) : (
          <>
            <h2 style={{ marginTop: 10 }}>Créer ma salle</h2>
            <form onSubmit={create} className="row">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la box, ex. CrossFit Canet" required style={{ flex: 1 }} aria-label="Nom de la box" />
              <button className="btn" disabled={busy}>Créer</button>
            </form>
          </>
        )}
        {isAdmin && <p className="sub">Tu es administrateur de la plateforme : toutes les salles sont listées.</p>}
        <button className="linkbtn" onClick={onSignOut}>Se déconnecter</button>
      </div>
    </div>
  )
}
