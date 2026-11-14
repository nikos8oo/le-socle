import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hhmm } from '../lib/dates'
import { Pill, TypeTag } from './ui'

// Les inscrits de chaque cours du jour, en direct, avec l'appel.
export function useDayBookings(boxId, day) {
  const [rows, setRows] = useState([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('bookings').select('id, course_id, member_id, status, created_at, is_trial').eq('box_id', boxId).eq('day', day).order('created_at')
    setRows(data || [])
  }, [boxId, day])
  useEffect(() => {
    load()
    const ch = supabase.channel('bk-' + boxId + '-' + day)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'box_id=eq.' + boxId }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [boxId, day, load])
  return [rows, load]
}

// Les réservations des 7 prochains jours, en direct
export function useWeekSchedule(boxId, from) {
  const [rows, setRows] = useState([])
  const load = useCallback(async () => {
    const to = new Date(from); to.setDate(to.getDate() + 6)
    const { data } = await supabase.rpc('box_schedule', { p_box: boxId, p_from: from, p_to: to.toISOString().slice(0, 10) })
    setRows(data || [])
  }, [boxId, from])
  useEffect(() => {
    load()
    const ch = supabase.channel('wk-' + boxId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'box_id=eq.' + boxId }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [boxId, load])
  return rows
}

export default function Roll({ course, day, rows, members, types, canRoll, onChange, toast }) {
  const [walk, setWalk] = useState('')
  const name = (id) => (members.find((m) => m.id === id) || {}).name || 'Adhérent'
  const inC = rows.filter((r) => r.course_id === course.id)
  const booked = inC.filter((r) => ['reserve', 'present', 'absent'].includes(r.status))
  const waiting = inC.filter((r) => r.status === 'attente')
  const late = inC.filter((r) => r.status === 'annule_tard')
  const present = booked.filter((r) => r.status === 'present').length
  const fill = booked.length / course.capacity

  async function mark(r, status) {
    const { error } = await supabase.rpc('mark_presence', { p_booking: r.id, p_status: r.status === status ? 'reserve' : status })
    if (error) return toast(error.message)
    onChange()
  }
  async function addWalk(e) {
    e.preventDefault()
    if (!walk) return
    const { error } = await supabase.rpc('add_walkin', { p_course: course.id, p_day: day, p_member: walk })
    if (error) return toast(error.message)
    setWalk('')
    onChange()
  }

  return (
    <details className="roll" open={booked.length > 0 && canRoll}>
      <summary>
        <TypeTag name={course.type_name} types={types} /><b className="num">{hhmm(course.start_time)}</b>{course.label && <span className="sub">{course.label}</span>}
        <span className="sub">{booked.length}/{course.capacity} inscrits{waiting.length ? ' · ' + waiting.length + ' en attente' : ''}</span>
        <span className="right"><Pill cls={fill >= 0.9 ? 'warn' : fill >= 0.6 ? 'good' : 'bad'}>{Math.round(fill * 100)} %</Pill>{present > 0 && <> <Pill cls="good">{present} présent{present > 1 ? 's' : ''}</Pill></>}</span>
      </summary>
      <div className="list">
        {booked.map((r) => (
          <div className="prow" key={r.id}>
            <span style={{ flex: 1 }}>{name(r.member_id)} {r.is_trial && <Pill cls="warn">Essai</Pill>}</span>
            {canRoll ? (
              <div className="seg">
                <button className="roui" aria-pressed={r.status === 'present'} onClick={() => mark(r, 'present')}>Présent</button>
                <button className="rnon" aria-pressed={r.status === 'absent'} onClick={() => mark(r, 'absent')}>Absent</button>
              </div>
            ) : <Pill>{r.status === 'present' ? 'Présent' : r.status === 'absent' ? 'Absent' : 'Réservé'}</Pill>}
          </div>
        ))}
        {!booked.length && <p className="empty">Personne n'a encore réservé.</p>}
        {waiting.length > 0 && <p className="sub">Liste d'attente : {waiting.map((r) => name(r.member_id)).join(', ')}</p>}
        {late.length > 0 && <p className="sub">Annulé tard : {late.map((r) => name(r.member_id)).join(', ')}</p>}
        {canRoll && (
          <form className="row sep" onSubmit={addWalk}>
            <select value={walk} onChange={(e) => setWalk(e.target.value)} aria-label="Venu sans réserver" style={{ flex: 1 }}>
              <option value="">Venu sans réserver…</option>
              {members.filter((m) => m.active !== false && !inC.some((r) => r.member_id === m.id && ['reserve', 'present', 'absent'].includes(r.status))).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn small" disabled={!walk}>Ajouter présent</button>
          </form>
        )}
      </div>
    </details>
  )
}
