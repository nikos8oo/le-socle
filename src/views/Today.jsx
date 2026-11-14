import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { JOURS, MOIS, addDays, diffDays, fmt, hhmm, parse, today, wdOf } from '../lib/dates'
import { ONB_STEPS, whoName } from '../lib/method'
import { Empty, Pill, TypeTag, statusOf } from '../components/ui'
import Roll, { useDayBookings, useWeekSchedule } from '../components/Roll'
import { useUsage } from './Plans'

export default function Today({ box, role, data, reload, log, toast, myCoach, me, goTo }) {
  const t = today()
  const [D, setD] = useState(t)
  const past = D < t
  const wd = wdOf(D)
  const isMine = (who) => role === 'owner' || who === myCoach || who === 'equipe'

  const items = useMemo(() => {
    const out = []
    const evName = Object.fromEntries(data.events.map((e) => [e.id, e.name]))
    data.event_tasks.filter((k) => !k.done && isMine(k.assignee)).forEach((k) => out.push({ kind: 'task', id: k.id, due: k.due, title: k.title, detail: (evName[k.event_id] || 'Événement') + ' · ' + whoName(k.assignee, data.coaches) }))
    data.actions.filter((a) => !a.done && isMine(a.assignee)).forEach((a) => out.push({ kind: 'action', id: a.id, due: a.due, title: a.title, detail: 'Action de réunion · ' + whoName(a.assignee, data.coaches) }))
    data.reminders.filter((r) => !r.done).forEach((r) => out.push({ kind: 'reminder', id: r.id, due: r.due, title: r.title, detail: 'Rappel' }))
    data.onboarding.forEach((o) => ONB_STEPS.forEach(([k, off, ti, de]) => {
      if (o.steps && o.steps[k]) return
      const due = addDays(o.start_day, off)
      if (diffDays(t, o.start_day) <= 75) out.push({ kind: 'onb', id: o.id, step: k, due, title: o.member_name + ' · ' + ti, detail: 'Suivi 60 jours · ' + de })
    }))
    data.trials.filter((e) => e.result === 'att').forEach((e) => out.push({ kind: 'trial', id: e.id, due: addDays(e.day, 3), title: 'Relancer ' + (e.prospect || 'le prospect') + ' après son essai', detail: 'Essai du ' + fmt(e.day) + ' · ' + whoName(e.coach_id, data.coaches) }))
    return out.sort((a, b) => a.due.localeCompare(b.due))
  }, [data, role, myCoach]) // eslint-disable-line react-hooks/exhaustive-deps

  const todo = past ? items.filter((i) => i.due === D) : items.filter((i) => i.due <= D)
  const done = data.journal.filter((j) => j.day === D)
  const courses = data.courses.filter((c) => c.weekday === wd)
  const att = Object.fromEntries(data.attendance.filter((a) => a.day === D).map((a) => [a.course_id, a.present]))
  const [pres, setPres] = useState({})
  const [bk, reloadBk] = useDayBookings(box.id, D)
  const hasBk = bk.length > 0
  const week = useWeekSchedule(box.id, t)
  const [usage] = useUsage(role === 'owner' ? box.id : null)
  const pendingBuy = usage.filter((u) => u.status === 'attente_paiement' && u.payment_method !== 'en_ligne').length
  const payIssues = usage.filter((u) => u.status !== 'terminee' && u.payment_issue).length
  // un nouvel adhérent vient de réserver : on recharge la liste pour afficher son nom
  useEffect(() => { if (bk.some((r) => !data.members.some((m) => m.id === r.member_id))) reload() }, [bk]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPres({}), [D])
  const trialsDay = data.trials.filter((e) => e.day === D)
  const evs = data.events.filter((e) => e.day >= D && e.day <= addDays(D, 45))

  async function finish(i) {
    let error
    if (i.kind === 'task') ({ error } = await supabase.from('event_tasks').update({ done: true, done_at: new Date().toISOString() }).eq('id', i.id))
    if (i.kind === 'action') ({ error } = await supabase.from('actions').update({ done: true, done_at: new Date().toISOString() }).eq('id', i.id))
    if (i.kind === 'reminder') ({ error } = await supabase.from('reminders').update({ done: true }).eq('id', i.id))
    if (i.kind === 'trial') ({ error } = await supabase.from('trials').update({ result: 'oui' }).eq('id', i.id))
    if (i.kind === 'onb') {
      const o = data.onboarding.find((x) => x.id === i.id)
      ;({ error } = await supabase.from('onboarding').update({ steps: { ...(o.steps || {}), [i.step]: t } }).eq('id', i.id))
    }
    if (error) return toast(error.message)
    await log('Fait : ' + i.title)
    toast('C\'est noté')
    reload()
  }

  async function saveAttendance(e) {
    e.preventDefault()
    const rows = courses.filter((c) => pres[c.id] !== undefined && pres[c.id] !== '').map((c) => ({ course_id: c.id, box_id: box.id, day: D, present: Math.max(0, Number(pres[c.id]) || 0) }))
    if (!rows.length) return toast('Saisis au moins un cours')
    const { error } = await supabase.from('attendance').upsert(rows)
    if (error) return toast(error.message)
    await log('Fréquentation saisie du ' + fmt(D) + ' (' + rows.length + ' cours)')
    setPres({})
    toast('Fréquentation enregistrée')
    reload()
  }

  const [prospect, setProspect] = useState('')
  const [tCoach, setTCoach] = useState('')
  async function addTrial(e) {
    e.preventDefault()
    const coach_id = role === 'owner' ? (tCoach || (data.coaches[0] && data.coaches[0].id)) : myCoach
    if (!coach_id) return toast('Ajoute d\'abord un coach dans Équipe')
    const { error } = await supabase.from('trials').insert({ box_id: box.id, day: D, prospect: prospect.trim(), coach_id, result: 'att' })
    if (error) return toast(error.message)
    await log('Essai ajouté : ' + (prospect.trim() || 'prospect') + ' avec ' + whoName(coach_id, data.coaches))
    setProspect('')
    reload()
  }
  async function setResult(id, result) {
    const { error } = await supabase.from('trials').update({ result }).eq('id', id)
    if (error) return toast(error.message)
    reload()
  }

  const [rTitle, setRTitle] = useState('')
  async function addReminder(e) {
    e.preventDefault()
    const { error } = await supabase.from('reminders').insert({ box_id: box.id, title: rTitle.trim(), due: D > t ? D : addDays(t, 1) })
    if (error) return toast(error.message)
    setRTitle('')
    reload()
  }

  const dayLbl = JOURS[wd] + ' ' + parse(D).getDate() + ' ' + MOIS[parse(D).getMonth()] + ' ' + parse(D).getFullYear()
  return (
    <div className="stack">
      <div className="card daynav">
        <div className="spread">
          <div className="row">
            <button className="btn small ghost" onClick={() => setD(addDays(D, -1))}>← Veille</button>
            <input type="date" value={D} onChange={(e) => e.target.value && setD(e.target.value)} aria-label="Jour" />
            <button className={'btn small' + (D === t ? '' : ' ghost')} onClick={() => setD(t)}>Aujourd'hui</button>
            <button className="btn small ghost" onClick={() => setD(addDays(D, 1))}>Lendemain →</button>
          </div>
          <h2 className="dayttl">{dayLbl} {D === t ? <Pill>Aujourd'hui</Pill> : past ? <Pill cls="warn">Jour passé</Pill> : <Pill cls="good">À venir</Pill>}</h2>
        </div>
      </div>
      {role === 'coach' && !me && <p className="notice">Ton compte n'est pas encore relié à une fiche coach. Demande à l'owner de t'inviter depuis sa fiche.</p>}

      {role === 'owner' && (pendingBuy > 0 || payIssues > 0) && (
        <div className="notice">
          <span style={{ flex: 1 }}>{pendingBuy > 0 && <><b>{pendingBuy}</b> demande{pendingBuy > 1 ? 's' : ''} de formule à valider (paiement à la salle). </>}{payIssues > 0 && <><b>{payIssues}</b> paiement{payIssues > 1 ? 's' : ''} par carte à surveiller.</>}</span>
          <button className="btn small" onClick={() => goTo('plans')}>Voir dans Formules</button>
        </div>
      )}

      {week.length > 0 && (
        <div className="card">
          <div className="spread"><h2>Réservations des 7 prochains jours</h2><span className="sub">{week.reduce((a, r) => a + r.booked, 0)} places réservées · mis à jour en direct</span></div>
          <div className="weekgrid">
            {Array.from({ length: 7 }, (_, i) => addDays(t, i)).map((d) => { const rs = week.filter((r) => r.day === d); return (
              <button key={d} className={'weekday' + (d === D ? ' on' : '')} onClick={() => setD(d)}>
                <span className="wd">{d === t ? "Auj." : JOURS[wdOf(d)].slice(0, 3)} {parse(d).getDate()}</span>
                {rs.map((r) => { const f = r.booked / r.capacity; return (
                  <span key={r.course_id} className="wslot" title={r.type_name + (r.label ? ' · ' + r.label : '')}><b className="num">{hhmm(r.start_time)}{rs.filter((x) => x.start_time === r.start_time).length > 1 && <small className="wtype"> {r.type_name}</small>}</b><span className={'wfill ' + (f >= 0.9 ? 'warn' : f >= 0.6 ? 'good' : r.booked ? 'low' : 'none')}>{r.booked}/{r.capacity}{r.waiting ? ' +' + r.waiting : ''}</span></span>
                ) })}
                {!rs.length && <span className="sub">—</span>}
              </button>
            ) })}
          </div>
        </div>
      )}

      <div className="grid g2 top">
        <div className="card">
          <div className="spread"><h2>{past ? 'Resté à faire ce jour-là' : 'À faire'}</h2><Pill cls={todo.some((i) => i.due < t) ? 'bad' : 'neutral'}>{todo.length}</Pill></div>
          <div className="list">
            {todo.map((i) => {
              const st = statusOf(i.due, t)
              return (
                <div className="item" key={i.kind + i.id + (i.step || '')}>
                  <span className={'stripe ' + st.cls} />
                  <div>
                    <div className="t">{i.title}</div>
                    <div className="m">{i.detail} · échéance {fmt(i.due)}</div>
                    <div className="acts"><Pill cls={st.cls}>{st.txt}</Pill><button className="btn small" onClick={() => finish(i)}>{i.kind === 'trial' ? 'Inscrit' : 'Fait'}</button></div>
                  </div>
                </div>
              )
            })}
            {!todo.length && <Empty>{past ? "Rien n'était en attente ce jour-là." : 'Rien à faire. Bonne séance !'}</Empty>}
          </div>
          {role === 'owner' && !past && (
            <form className="row sep" onSubmit={addReminder}>
              <input value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="Ajouter un rappel" required style={{ flex: 1 }} aria-label="Nouveau rappel" />
              <button className="btn small">Ajouter</button>
            </form>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="spread"><h2>Cours du jour</h2><span className="sub">{courses.length} cours</span></div>
            {!courses.length && <Empty>Pas de cours ce jour-là.</Empty>}
            <div className="list">
              {courses.map((c) => <Roll key={c.id} course={c} day={D} rows={bk} members={data.members} types={data.course_types} canRoll={D <= t} toast={toast} onChange={() => { reloadBk(); reload() }} coaches={data.coaches} overrides={data.overrides} role={role} myCoach={myCoach} boxId={box.id} />)}
            </div>
            {role === 'owner' && courses.length > 0 && !hasBk && (
              <details className="manual">
                <summary className="sub">Pas de réservations ce jour-là : saisir la fréquentation à la main</summary>
                <form onSubmit={saveAttendance}>
                  <div className="list">
                    {courses.map((c) => (
                      <div className="prow" key={c.id}>
                        <TypeTag name={c.type_name} types={data.course_types} /><b className="num">{hhmm(c.start_time)}</b>
                        {att[c.id] !== undefined && <Pill cls={att[c.id] / c.capacity >= 0.9 ? 'warn' : att[c.id] / c.capacity >= 0.6 ? 'good' : 'bad'}>{Math.round(att[c.id] / c.capacity * 100)} %</Pill>}
                        <label className="inline right">Présents <input type="number" min="0" style={{ width: 70 }} value={pres[c.id] ?? att[c.id] ?? ''} onChange={(e) => setPres({ ...pres, [c.id]: e.target.value })} /> / {c.capacity}</label>
                      </div>
                    ))}
                  </div>
                  {D <= t ? <div className="row end"><button className="btn small">Enregistrer la fréquentation</button></div> : <p className="sub">La fréquentation se saisit le jour même ou après.</p>}
                </form>
              </details>
            )}
          </div>

          <div className="card">
            <div className="spread"><h2>Séances d'essai</h2><span className="sub">{trialsDay.length} ce jour-là</span></div>
            <div className="list">
              {trialsDay.map((e) => (
                <div className="prow" key={e.id}>
                  <div><b>{e.prospect || 'Prospect'}</b><div className="sub">avec {whoName(e.coach_id, data.coaches)}</div></div>
                  <div className="seg right">
                    {[['att', 'En attente'], ['oui', 'Inscrit'], ['non', 'Pas inscrit']].map(([k, l]) => <button key={k} className={'r' + k} aria-pressed={e.result === k} onClick={() => setResult(e.id, k)}>{l}</button>)}
                  </div>
                </div>
              ))}
              {!trialsDay.length && <Empty>Aucun essai noté.</Empty>}
            </div>
            {D <= t && (
              <form className="row" onSubmit={addTrial}>
                <input value={prospect} onChange={(e) => setProspect(e.target.value)} placeholder="Prénom du prospect" style={{ flex: 1, minWidth: 140 }} aria-label="Prénom du prospect" />
                {role === 'owner' && <select value={tCoach} onChange={(e) => setTCoach(e.target.value)} aria-label="Coach">{data.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
                <button className="btn small">Ajouter</button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="grid g2 top">
        <div className="card">
          <h2>Fait ce jour-là</h2>
          <div className="list">
            {done.map((j) => <div className="item" key={j.id}><span className="stripe good" /><div><div className="t">{j.text}</div></div></div>)}
            {!done.length && <Empty>Rien d'enregistré ce jour-là.</Empty>}
          </div>
        </div>
        <div className="card">
          <div className="spread"><h2>Événements à venir</h2><button className="btn small ghost" onClick={() => goTo('events')}>Tous les événements</button></div>
          <div className="list">
            {evs.map((e) => {
              const ks = data.event_tasks.filter((k) => k.event_id === e.id && !k.done)
              const late = ks.filter((k) => k.due < t).length
              return <div className="item" key={e.id}><span className={'stripe ' + (late ? 'bad' : 'good')} /><div><div className="t">{e.name}</div><div className="m">{fmt(e.day)} · J-{diffDays(e.day, D)} · {ks.length} tâche(s) ouverte(s){late ? ' dont ' + late + ' en retard' : ''}</div></div></div>
            })}
            {!evs.length && <Empty>Aucun événement dans les 45 jours.</Empty>}
          </div>
        </div>
      </div>
    </div>
  )
}
