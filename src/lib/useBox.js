import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { addDays, today } from './dates'

// Charge toutes les données d'une salle. Les règles de la base filtrent
// automatiquement ce qu'un coach a le droit de voir : les tables réservées
// à l'owner reviennent simplement vides pour lui.
const TABLES = {
  coaches: (q) => q.order('created_at'),
  members: (q) => q.order('name'),
  plans: (q) => q.order('sort').order('created_at'),
  course_types: (q) => q,
  courses: (q) => q.order('weekday').order('start_time'),
  trials: (q) => q.order('day', { ascending: false }).limit(500),
  observations: (q) => q.order('day', { ascending: false }),
  events: (q) => q.order('day'),
  event_finance: (q) => q,
  event_tasks: (q) => q.order('due'),
  actions: (q) => q.order('due'),
  reminders: (q) => q.order('due'),
  onboarding: (q) => q.order('start_day', { ascending: false }),
  invitations: (q) => q.order('created_at', { ascending: false }),
}

export function useBox(boxId) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!boxId) return
    setError(null)
    const since = addDays(today(), -100)
    const jobs = Object.entries(TABLES)
      .filter(([, f]) => f)
      .map(async ([t, f]) => {
        const { data: rows, error: err } = await f(supabase.from(t).select('*').eq('box_id', boxId))
        if (err) throw err
        return [t, rows || []]
      })
    jobs.push((async () => {
      const { data: rows, error: err } = await supabase.from('attendance').select('*').eq('box_id', boxId).gte('day', since)
      if (err) throw err
      return ['attendance', rows || []]
    })())
    jobs.push((async () => {
      const { data: rows, error: err } = await supabase.from('box_members').select('user_id, role, coach_id, created_at').eq('box_id', boxId)
      if (err) throw err
      return ['box_members', rows || []]
    })())
    jobs.push((async () => {
      const { data: rows, error: err } = await supabase.from('course_coach_overrides').select('*').eq('box_id', boxId).gte('day', addDays(today(), -100))
      if (err) throw err
      return ['overrides', rows || []]
    })())
    jobs.push((async () => {
      const { data: rows, error: err } = await supabase.from('journal').select('*').eq('box_id', boxId).gte('day', since).order('created_at', { ascending: false })
      if (err) throw err
      return ['journal', rows || []]
    })())
    try {
      const res = await Promise.all(jobs)
      setData(Object.fromEntries(res))
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [boxId])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  const log = useCallback(async (text) => {
    await supabase.from('journal').insert({ box_id: boxId, text })
  }, [boxId])

  return { data, error, reload: load, log }
}
