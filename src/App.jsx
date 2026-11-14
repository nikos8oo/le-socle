import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useBox } from './lib/useBox'
import Auth from './components/Auth'
import BoxPicker from './components/BoxPicker'
import { useToast } from './components/ui'
import Today from './views/Today'
import Planning from './views/Planning'
import Trials from './views/Trials'
import Events from './views/Events'
import Team from './views/Team'
import Resources from './views/Resources'
import Athlete from './views/Athlete'
import Members from './views/Members'
import Plans from './views/Plans'
import AdminConsole from './views/AdminConsole'

const OWNER_TABS = [['today', "Aujourd'hui"], ['planning', 'Planning'], ['members', 'Adhérents'], ['plans', 'Formules'], ['trials', "Séances d'essai"], ['events', 'Événements'], ['team', 'Équipe'], ['resources', 'Ressources']]
const ATH_TABS = [['book', 'Réserver'], ['mine', 'Mes réservations'], ['shop', 'Boutique']]
const COACH_TABS = [['today', "Aujourd'hui"], ['planning', 'Planning'], ['trials', 'Mes essais'], ['events', 'Événements'], ['resources', 'Ressources']]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [recovery, setRecovery] = useState(false)
  const [boxes, setBoxes] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [boxId, setBoxId] = useState(() => localStorage.getItem('socle-box') || null)
  const [tab, setTab] = useState('today')
  const [menu, setMenu] = useState(false)
  const [joinClash, setJoinClash] = useState(null)
  const [space, setSpaceRaw] = useState(() => localStorage.getItem('socle-space') || '')
  const setSpace = (v) => { setSpaceRaw(v); if (v) localStorage.setItem('socle-space', v); else localStorage.removeItem('socle-space') }
  const [theme, setTheme] = useState(() => localStorage.getItem('socle-theme') || '')
  const [toast, toastNode] = useToast()

  // invitation passée dans l'URL : on la garde jusqu'à la connexion
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const inv = p.get('invite')
    const join = p.get('rejoindre')
    if (inv) { localStorage.setItem('socle-invite', inv); localStorage.setItem('socle-space', 'salle'); setSpaceRaw('salle') }
    if (join) { localStorage.setItem('socle-join', join); localStorage.setItem('socle-space', 'athlete'); setSpaceRaw('athlete') }
    if (inv || join) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (evt === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
    else document.documentElement.removeAttribute('data-theme')
  }, [theme])

  const loadBoxes = useCallback(async () => {
    if (!session) return
    const uid = session.user.id
    const inv = localStorage.getItem('socle-invite')
    if (inv) {
      const { data, error } = await supabase.rpc('accept_invitation', { invite_token: inv })
      localStorage.removeItem('socle-invite')
      if (error) toast(error.message)
      else { toast('Invitation acceptée, bienvenue !'); setBoxId(data); localStorage.setItem('socle-box', data) }
    }
    // lien d'inscription adhérent : gardé en mémoire locale, ou dans le compte s'il a été créé ailleurs
    const jc = localStorage.getItem('socle-join') || session.user.user_metadata?.join_code
    if (jc) {
      localStorage.removeItem('socle-join')
      const { data: already } = await supabase.from('box_members').select('role, boxes!inner(join_code, name)').eq('user_id', uid).eq('boxes.join_code', jc).maybeSingle()
      if (already && already.role !== 'adherent') {
        setJoinClash({ code: jc, name: already.boxes.name, role: already.role })
      } else if (!already) {
        const { data, error } = await supabase.rpc('join_box', { code: jc, full_name: session.user.user_metadata?.full_name || null })
        if (error) toast(error.message)
        else { toast('Bienvenue ! Tu peux réserver tes cours.'); setBoxId(data); localStorage.setItem('socle-box', data) }
      }
      if (session.user.user_metadata?.join_code) supabase.auth.updateUser({ data: { join_code: null } })
    }
    const [{ data: bx }, { data: mem }, { data: adm }] = await Promise.all([
      supabase.from('boxes').select('id, name, settings, join_code').order('created_at'),
      supabase.from('box_members').select('box_id, role, coach_id').eq('user_id', uid),
      supabase.from('platform_admins').select('user_id').eq('user_id', uid),
    ])
    setIsAdmin(!!(adm && adm.length))
    const list = (bx || []).map((b) => {
      const m = (mem || []).find((x) => x.box_id === b.id)
      return { ...b, myRole: m ? m.role : 'admin', myCoach: m ? m.coach_id : null }
    })
    setBoxes(list)
    let sp = localStorage.getItem('socle-space') || ''
    if (!sp) { sp = list.some((b) => b.myRole !== 'adherent') || (adm && adm.length) ? 'salle' : 'athlete'; setSpace(sp) }
    const inSpace = list.filter((b) => (sp === 'athlete' ? b.myRole === 'adherent' : b.myRole !== 'adherent'))
    if (inSpace.length === 1 && !inSpace.some((b) => b.id === boxId) && !(sp === 'salle' && adm && adm.length)) setBoxId(inSpace[0].id)
  }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadBoxes() }, [loadBoxes])

  const spaceBoxes = useMemo(() => (boxes || []).filter((b) => (space === 'athlete' ? b.myRole === 'adherent' : b.myRole !== 'adherent')), [boxes, space])
  const box = useMemo(() => spaceBoxes.find((b) => b.id === boxId) || null, [spaceBoxes, boxId])
  const otherSpace = space === 'athlete' ? 'salle' : 'athlete'
  const hasOther = (boxes || []).some((b) => (otherSpace === 'athlete' ? b.myRole === 'adherent' : b.myRole !== 'adherent')) || (otherSpace === 'salle' && isAdmin)
  function switchSpace() { setSpace(otherSpace); setBoxId(null); localStorage.removeItem('socle-box'); setMenu(false); setTab('') }
  const role = box ? (box.myRole === 'coach' ? 'coach' : box.myRole === 'adherent' ? 'adherent' : 'owner') : null
  const { data, error, reload, log } = useBox(box && role !== 'adherent' ? box.id : null)

  if (session === undefined) return <div className="loading">Chargement…</div>
  if (!session || recovery) return <Auth recovery={recovery} space={space} setSpace={setSpace} onRecovered={() => { setRecovery(false); toast('Mot de passe mis à jour') }} />
  if (!space) return <div className="loading">Chargement…</div>
  if (!boxes) return <div className="loading">Chargement de tes salles…</div>
  if (joinClash) {
    return (
      <div className="authwrap">
        <div className="authcard">
          <div className="brand dark"><small>Drill's &amp; Skills</small><b>Le Socle</b></div>
          <h1>Lien d'inscription adhérent</h1>
          <p>Tu as ouvert le lien d'inscription de <b>{joinClash.name}</b>, mais tu es connecté avec ton compte <b>{joinClash.role === 'owner' ? 'owner' : 'coach'}</b> de cette salle.</p>
          <p className="sub">Ce lien sert à tes adhérents. Pour voir l'app comme eux, crée un compte adhérent avec une autre adresse e-mail (idéalement dans une fenêtre de navigation privée).</p>
          <button className="btn" onClick={async () => { localStorage.setItem('socle-join', joinClash.code); localStorage.removeItem('socle-box'); setJoinClash(null); await supabase.auth.signOut() }}>Me déconnecter et créer un compte adhérent</button>
          <button className="linkbtn" onClick={() => setJoinClash(null)}>Rester dans mon espace {joinClash.role === 'owner' ? 'owner' : 'coach'}</button>
        </div>
      </div>
    )
  }
  const effDark0 = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  if (!box && space === 'salle' && isAdmin) {
    return (
      <>
        <header className="topbar">
          <div className="tb">
            <div className="brand"><small>Drill's &amp; Skills</small><b>Le Socle</b></div>
            <nav className="tabs" aria-label="Navigation"><button className="on" aria-current="page">Console admin</button></nav>
            <div className="tb-right">
              <button className="iconbtn" title={effDark0 ? 'Version claire' : 'Version sombre'} onClick={() => { const t = effDark0 ? 'light' : 'dark'; setTheme(t); localStorage.setItem('socle-theme', t) }}>{effDark0 ? '☀' : '☾'}</button>
              <div className="menu">
                <button className="menubtn" onClick={() => setMenu(!menu)} aria-expanded={menu}><span className="pill neutral">Admin</span> ▾</button>
                {menu && (
                  <div className="menupanel" onMouseLeave={() => setMenu(false)}>
                    <div className="sub" style={{ padding: '4px 8px' }}>{session.user.email}</div>
                  {hasOther && <button onClick={switchSpace}>Passer à mon espace athlète</button>}
                    <button onClick={() => { localStorage.removeItem('socle-box'); supabase.auth.signOut() }}>Se déconnecter</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <AdminConsole toast={toast} onOpen={async (id) => { await loadBoxes(); setBoxId(id); localStorage.setItem('socle-box', id); setTab('today') }} />
        {toastNode}
      </>
    )
  }
  if (!box) {
    return <BoxPicker boxes={spaceBoxes} space={space} isAdmin={isAdmin} hasOther={hasOther} onSwitch={switchSpace} onPick={(id) => { setBoxId(id); localStorage.setItem('socle-box', id) }}
      onCreated={async (id) => { setBoxId(id); localStorage.setItem('socle-box', id); await loadBoxes() }}
      onSignOut={() => supabase.auth.signOut()} />
  }

  const tabs = role === 'owner' ? OWNER_TABS : role === 'adherent' ? ATH_TABS : COACH_TABS
  const current = tabs.some((t) => t[0] === tab) ? tab : tabs[0][0]
  const me = data ? data.coaches.find((c) => c.id === box.myCoach) : null
  const ctx = { box, role, data, reload, log, toast, session, myCoach: box.myCoach, me, isAdmin }
  const effDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches

  return (
    <>
      <header className="topbar">
        <div className="tb">
          <div className="brand"><small>Drill's &amp; Skills</small><b>Le Socle</b></div>
          <nav className="tabs" aria-label="Navigation">
            {tabs.map(([k, l]) => <button key={k} aria-current={current === k ? 'page' : undefined} className={current === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </nav>
          <div className="tb-right">
            <button className="iconbtn" title={effDark ? 'Version claire' : 'Version sombre'} onClick={() => { const t = effDark ? 'light' : 'dark'; setTheme(t); localStorage.setItem('socle-theme', t) }}>{effDark ? '☀' : '☾'}</button>
            <div className="menu">
              <button className="menubtn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
                <span className="pill neutral">{role === 'owner' ? 'Owner' : role === 'adherent' ? 'Adhérent' : 'Coach'}</span> <span className="hide-s">{box.name}</span> ▾
              </button>
              {menu && (
                <div className="menupanel" onMouseLeave={() => setMenu(false)}>
                  <div className="sub" style={{ padding: '4px 8px' }}>{session.user.email}</div>
                  {spaceBoxes.length > 1 && spaceBoxes.map((b) => <button key={b.id} onClick={() => { setBoxId(b.id); localStorage.setItem('socle-box', b.id); setMenu(false) }}>{b.id === box.id ? '✓ ' : ''}{b.name}</button>)}
                  <button onClick={() => { setBoxId(null); localStorage.removeItem('socle-box'); setMenu(false) }}>{space === 'athlete' ? 'Rejoindre ou changer de salle' : 'Changer de salle'}</button>
                  {isAdmin && space === 'salle' && <button onClick={() => { setBoxId(null); localStorage.removeItem('socle-box'); setMenu(false) }}>← Console admin</button>}
                  {hasOther && <button onClick={switchSpace}>{otherSpace === 'athlete' ? 'Passer à mon espace athlète' : 'Passer à l’espace salle'}</button>}
                  <button onClick={() => { localStorage.removeItem('socle-box'); supabase.auth.signOut() }}>Se déconnecter</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main>
        <div className="head"><h1 className="boxname">{box.name}</h1></div>
        {error && <p className="notice">Erreur de chargement : {error} <button className="btn small ghost" onClick={reload}>Réessayer</button></p>}
        {role === 'adherent' ? <Athlete box={box} tab={current} toast={toast} /> : !data ? <div className="loading">Chargement…</div> : (
          <>
            {current === 'today' && <Today {...ctx} goTo={setTab} />}
            {current === 'planning' && <Planning {...ctx} />}
            {current === 'members' && <Members {...ctx} onBoxChange={loadBoxes} />}
            {current === 'plans' && <Plans {...ctx} />}
            {current === 'trials' && <Trials {...ctx} />}
            {current === 'events' && <Events {...ctx} />}
            {current === 'team' && <Team {...ctx} />}
            {current === 'resources' && <Resources {...ctx} />}
          </>
        )}
      </main>
      {toastNode}
    </>
  )
}
