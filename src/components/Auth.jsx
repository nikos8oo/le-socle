import { useState } from 'react'
import { supabase } from '../lib/supabase'

const MSG = {
  'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
  'Email not confirmed': "Confirme d'abord ton adresse : clique sur le lien reçu par e-mail.",
  'User already registered': 'Un compte existe déjà avec cette adresse. Connecte-toi.',
}
const tr = (m) => MSG[m] || m

export default function Auth({ recovery, onRecovered }) {
  const [mode, setMode] = useState(recovery ? 'newpass' : localStorage.getItem('socle-join') ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const invited = !!localStorage.getItem('socle-invite')
  const joining = !!localStorage.getItem('socle-join')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr(''); setInfo('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
        if (error) throw error
      } else if (mode === 'signup') {
        if (pass.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.')
        const { data, error } = await supabase.auth.signUp({ email, password: pass, options: { data: { full_name: name }, emailRedirectTo: window.location.origin } })
        if (error) throw error
        if (!data.session) setInfo('Compte créé. Clique sur le lien reçu par e-mail pour confirmer ton adresse, puis reviens ici.')
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } })
        if (error) throw error
        setInfo('Lien de connexion envoyé. Ouvre ta boîte mail sur cet appareil.')
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setInfo('E-mail envoyé : clique sur le lien pour choisir un nouveau mot de passe.')
      } else if (mode === 'newpass') {
        if (pass.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.')
        const { error } = await supabase.auth.updateUser({ password: pass })
        if (error) throw error
        onRecovered && onRecovered()
      }
    } catch (e2) {
      setErr(tr(e2.message || String(e2)))
    }
    setBusy(false)
  }

  const titles = { login: 'Connexion', signup: 'Créer un compte', magic: 'Recevoir un lien de connexion', reset: 'Mot de passe oublié', newpass: 'Nouveau mot de passe' }
  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="brand dark"><small>Drill's &amp; Skills</small><b>Le Socle</b></div>
        <h1>{titles[mode]}</h1>
        {joining && mode !== 'newpass' && <p className="notice">Bienvenue ! Crée ton compte pour réserver tes cours, ou connecte-toi si tu en as déjà un.</p>}
        {invited && mode !== 'newpass' && <p className="notice">Tu as été invité dans une salle. Crée ton compte avec l'adresse e-mail qui a reçu l'invitation, ou connecte-toi.</p>}
        <form onSubmit={submit} className="stack">
          {mode === 'signup' && <label>Prénom et nom<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
          {mode !== 'newpass' && <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>}
          {['login', 'signup', 'newpass'].includes(mode) && <label>Mot de passe<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 8} /></label>}
          {err && <p className="err">{err}</p>}
          {info && <p className="ok">{info}</p>}
          <button className="btn" disabled={busy}>{busy ? '…' : { login: 'Se connecter', signup: 'Créer mon compte', magic: 'Envoyer le lien', reset: "Envoyer l'e-mail", newpass: 'Enregistrer' }[mode]}</button>
        </form>
        {mode !== 'newpass' && (
          <div className="authlinks">
            {mode !== 'login' && <button className="linkbtn" onClick={() => setMode('login')}>J'ai déjà un compte</button>}
            {mode !== 'signup' && <button className="linkbtn" onClick={() => setMode('signup')}>Créer un compte</button>}
            {mode === 'login' && <button className="linkbtn" onClick={() => setMode('magic')}>Connexion sans mot de passe</button>}
            {mode === 'login' && <button className="linkbtn" onClick={() => setMode('reset')}>Mot de passe oublié</button>}
          </div>
        )}
      </div>
    </div>
  )
}
