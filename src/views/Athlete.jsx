import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { JOURS, addDays, fmt, hhmm, parse, today, wdOf } from '../lib/dates'
import { Empty, Pill, TypeTag } from '../components/ui'

const LBL = { reserve: 'Réservé', attente: "En liste d'attente", present: 'Présent', absent: 'Absent', annule: 'Annulé', annule_tard: 'Annulé tard' }

// L'espace adhérent : réserver ses cours et suivre ses réservations.
export default function Athlete({ box, tab, toast }) {
  const t = today()
  const rules = { open_days: 7, cancel_hours: 2, enabled: true, ...((box.settings || {}).booking || {}) }
  const [rows, setRows] = useState(null)
  const [types, setTypes] = useState([])
  const [day, setDay] = useState(t)
  const [busy, setBusy] = useState(null)
  const [me, setMe] = useState(null)
  const [history, setHistory] = useState([])

  const load = useCallback(async () => {
    const [{ data, error }, { data: ty }, { data: mem }] = await Promise.all([
      supabase.rpc('box_schedule', { p_box: box.id, p_from: t, p_to: addDays(t, rules.open_days) }),
      supabase.from('course_types').select('*').eq('box_id', box.id),
      supabase.from('members').select('*').eq('box_id', box.id).maybeSingle(),
    ])
    if (error) return toast(error.message)
    setRows(data || [])
    setTypes(ty || [])
    setMe(mem || null)
    if (mem) {
      const { data: h } = await supabase.from('bookings').select('id, day, status, course_id').eq('member_id', mem.id).lt('day', t).order('day', { ascending: false }).limit(30)
      setHistory(h || [])
    }
  }, [box.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
    const iv = setInterval(() => document.visibilityState === 'visible' && load(), 30000)
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const days = useMemo(() => Array.from({ length: rules.open_days + 1 }, (_, i) => addDays(t, i)), [t, rules.open_days])
  const now = Date.now()

  async function book(r) {
    setBusy(r.course_id + r.day)
    const { data, error } = await supabase.rpc('book_course', { p_course: r.course_id, p_day: r.day })
    setBusy(null)
    if (error) return toast(error.message)
    toast(data === 'attente' ? "Cours complet : tu es sur la liste d'attente" : 'Place réservée, à tout à l’heure !')
    load()
  }
  async function cancel(r) {
    const late = r.my_status === 'reserve' && new Date(r.starts_at).getTime() - now < rules.cancel_hours * 3600e3
    if (late && !window.confirm('Le cours commence dans moins de ' + rules.cancel_hours + ' h : l\'annulation sera comptée comme tardive. Annuler quand même ?')) return
    setBusy(r.course_id + r.day)
    const { error } = await supabase.rpc('cancel_booking', { p_booking: r.my_booking })
    setBusy(null)
    if (error) return toast(error.message)
    toast('Réservation annulée')
    load()
  }

  if (!rows) return <div className="loading">Chargement du planning…</div>
  const active = me ? me.active : true
  const mine = rows.filter((r) => r.my_status === 'reserve' || r.my_status === 'attente')

  function Slot({ r }) {
    const left = r.capacity - r.booked
    const started = new Date(r.starts_at).getTime() <= now
    const st = r.my_status
    const booked = st === 'reserve' || st === 'attente'
    return (
      <div className={'slot' + (st === 'reserve' ? ' mine' : '')}>
        <div className="slot-time"><b className="num">{hhmm(r.start_time)}</b><TypeTag name={r.type_name} types={types} /></div>
        <div className="slot-info">
          {booked ? <Pill cls={st === 'reserve' ? 'good' : 'warn'}>{st === 'reserve' ? 'Réservé' : 'Liste d\'attente · ' + r.my_rank + (r.my_rank === 1 ? 'er' : 'e')}</Pill>
            : st && LBL[st] && st !== 'annule' ? <Pill>{LBL[st]}</Pill>
            : <span className={'places' + (left <= 0 ? ' full' : left <= 3 ? ' few' : '')}>{left <= 0 ? 'Complet' + (r.waiting ? ' · ' + r.waiting + ' en attente' : '') : left + (left > 1 ? ' places' : ' place')}</span>}
          <div className="track small"><div className="fill" style={{ width: Math.min(100, r.booked / r.capacity * 100) + '%' }} /></div>
        </div>
        <div className="slot-act">
          {started ? <span className="sub">Commencé</span>
            : booked ? <button className="btn small ghost" disabled={busy === r.course_id + r.day} onClick={() => cancel(r)}>Annuler</button>
            : <button className="btn small" disabled={!rules.enabled || !active || busy === r.course_id + r.day} onClick={() => book(r)}>{left <= 0 ? "Liste d'attente" : 'Réserver'}</button>}
        </div>
      </div>
    )
  }

  if (tab === 'mine') {
    return (
      <div className="stack">
        <div className="card">
          <h2>Mes prochains cours</h2>
          <div className="list">
            {mine.map((r) => <div key={r.course_id + r.day}><p className="phase">{JOURS[wdOf(r.day)]} {fmt(r.day)}</p><Slot r={r} /></div>)}
            {!mine.length && <Empty>Aucune réservation à venir.</Empty>}
          </div>
        </div>
        <div className="card">
          <h3>Mon historique</h3>
          <div className="list">
            {history.map((h) => <div className="prow" key={h.id}><span>{fmt(h.day)}</span><Pill cls={h.status === 'present' ? 'good' : h.status === 'absent' || h.status === 'annule_tard' ? 'bad' : 'neutral'}>{LBL[h.status]}</Pill></div>)}
            {!history.length && <Empty>Pas encore de cours passés.</Empty>}
          </div>
        </div>
        <p className="sub">Annulation sans pénalité jusqu'à {rules.cancel_hours} h avant le cours. Les réservations ouvrent {rules.open_days} jours à l'avance.</p>
      </div>
    )
  }

  const list = rows.filter((r) => r.day === day)
  return (
    <div className="stack">
      {!active && <p className="notice">Ton compte est suspendu : contacte la salle pour réserver.</p>}
      {!rules.enabled && <p className="notice">Les réservations en ligne sont fermées pour le moment.</p>}
      <div className="daystrip" role="tablist" aria-label="Jour">
        {days.map((d) => { const n = rows.filter((r) => r.day === d && r.my_status === 'reserve').length; return (
          <button key={d} role="tab" aria-selected={d === day} className={'daybtn' + (d === day ? ' on' : '')} onClick={() => setDay(d)}>
            <small>{d === t ? "Auj." : JOURS[wdOf(d)].slice(0, 3)}</small><b>{parse(d).getDate()}</b>{n > 0 && <i className="dot" />}
          </button>
        ) })}
      </div>
      <div className="card">
        <h2>{d2(day, t)}</h2>
        <div className="list">
          {list.map((r) => <Slot key={r.course_id} r={r} />)}
          {!list.length && <Empty>Pas de cours ce jour-là.</Empty>}
        </div>
      </div>
    </div>
  )
}

function d2(d, t) {
  if (d === t) return "Aujourd'hui"
  if (d === addDays(t, 1)) return 'Demain'
  return JOURS[wdOf(d)] + ' ' + fmt(d)
}
