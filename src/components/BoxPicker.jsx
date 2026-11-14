import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function BoxPicker({ boxes, onPick, onCreated, onSignOut, isAdmin }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

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
          <h1>Choisir une salle</h1>
          <div className="list">
            {boxes.map((b) => (
              <button key={b.id} className="boxrow" onClick={() => onPick(b.id)}>
                <b>{b.name}</b><span className="sub">{b.myRole === 'owner' ? 'Owner' : b.myRole === 'coach' ? 'Coach' : b.myRole === 'adherent' ? 'Adhérent' : 'Admin plateforme'}</span>
              </button>
            ))}
          </div>
        </>}
        <h1 style={{ marginTop: boxes.length ? 18 : 0 }}>{boxes.length ? 'Ou créer une nouvelle salle' : 'Créer ta salle'}</h1>
        {!boxes.length && <p className="sub">Tu es adhérent ou coach ? Ouvre le lien envoyé par ta salle. Tu es owner ? Crée ta salle ci-dessous.</p>}
        <form onSubmit={create} className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la box, ex. CrossFit Canet" required style={{ flex: 1 }} aria-label="Nom de la box" />
          <button className="btn" disabled={busy}>Créer</button>
        </form>
        {err && <p className="err">{err}</p>}
        {isAdmin && <p className="sub">Tu es administrateur de la plateforme : toutes les salles sont listées.</p>}
        <button className="linkbtn" onClick={onSignOut}>Se déconnecter</button>
      </div>
    </div>
  )
}
