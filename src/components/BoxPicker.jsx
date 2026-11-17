import { useState } from 'react'
import { supabase } from '../lib/supabase'

const ROLE = { owner: 'Owner', coach: 'Coach', adherent: 'Adhérent', admin: 'Admin plateforme' }

export default function BoxPicker({ boxes, space, onPick, onCreated, onSignOut, isAdmin, hasOther, onSwitch }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

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

  const athlete = space === 'athlete'
  return (
    <div className="authwrap">
      <div className="authcard" style={{ maxWidth: 520 }}>
        <div className="brand dark"><span className="logo">DS</span><span className="name"><b>Drill's &amp; Skills</b><small>Box</small></span></div>

        {boxes.length > 0 && <>
          <h1>{athlete ? 'Mes salles' : 'Mes salles accompagnées'}</h1>
          <div className="list">
            {boxes.map((b) => (
              <button key={b.id} className="boxrow" onClick={() => onPick(b.id)}>
                <span className="row" style={{ gap: 10 }}>{b.logo_url && <img className="picklogo" src={b.logo_url} alt="" />}<b>{b.name}</b></span><span className="sub">{ROLE[b.myRole] || 'Admin plateforme'}</span>
              </button>
            ))}
          </div>
        </>}

        {athlete && <>
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
        </>}

        {!athlete && !boxes.length && !isAdmin && <>
          <h1>Pas encore d'accès salle</h1>
          <p className="sub">L'espace salle (owner et coachs) est ouvert par Drill's &amp; Skills. Si ta salle est accompagnée, demande ton invitation : tu la recevras par e-mail.</p>
        </>}

        {!athlete && isAdmin && <>
          <h2 style={{ marginTop: 10 }}>Créer une salle</h2>
          <p className="sub">Tu es administrateur Drill's &amp; Skills. Crée la salle, puis invite son owner depuis l'onglet Équipe.</p>
          <form onSubmit={create} className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la box, ex. CrossFit Canet" required style={{ flex: 1 }} aria-label="Nom de la box" />
            <button className="btn" disabled={busy}>Créer</button>
          </form>
        </>}

        {err && <p className="err">{err}</p>}
        {hasOther && <button className="linkbtn" onClick={onSwitch}>{athlete ? 'Aller à l’espace salle' : 'Aller à mon espace athlète'}</button>}
        {!hasOther && !athlete && !boxes.length && <button className="linkbtn" onClick={onSwitch}>Je suis athlète</button>}
        <button className="linkbtn" onClick={onSignOut}>Se déconnecter</button>
      </div>
    </div>
  )
}
