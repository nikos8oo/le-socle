import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { JOURS, addDays, diffDays, fmt, hhmm, num, today, wdOf } from '../lib/dates'
import { DEFAULT_TYPES, PALETTE } from '../lib/method'
import { Empty, Modal, Pill, TypeTag } from '../components/ui'

function chip(name, types) {
  const t = types.find((x) => x.name === name)
  const p = PALETTE[(t ? t.color_index : 7) % PALETTE.length]
  return { background: p[0], color: p[1] }
}

export default function Planning({ box, role, data, reload, toast, log }) {
  const [mode, setMode] = useState(role === 'owner' ? 'lecture' : 'grille')
  const [edit, setEdit] = useState(null)
  const [extraHours, setExtraHours] = useState([])
  const types = data.course_types.length ? data.course_types : DEFAULT_TYPES.map((n, i) => ({ name: n, color_index: i === 4 ? 5 : i }))
  const hours = [...new Set(data.courses.map((c) => hhmm(c.start_time)).concat(extraHours))].sort()
  const days = mode === 'grille' && role === 'owner' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6].filter((d) => data.courses.some((c) => c.weekday === d))
  const settings = box.settings || {}
  const suiviDebut = settings.suivi_debut || data.courses.reduce((m, c) => m, null)

  const stats = useMemo(() => {
    const t = today()
    const from = settings.suivi_debut && settings.suivi_debut > addDays(t, -91) ? settings.suivi_debut : addDays(t, -91)
    const per = {}
    data.courses.forEach((c) => (per[c.id] = { n: 0, sum: 0 }))
    const days = new Set()
    data.attendance.forEach((a) => {
      if (a.day < from || a.day > t || !per[a.course_id]) return
      per[a.course_id].n++; per[a.course_id].sum += a.present; days.add(a.day)
    })
    let N = 0, P = 0
    data.courses.forEach((c) => {
      const r = per[c.id]; r.avg = r.n ? r.sum / r.n : 0; r.rate = r.n ? r.avg / c.capacity : 0
      if (!c.test_since && r.n) { N += r.avg; P += c.capacity }
    })
    return { per, from, days: days.size, overall: P ? N / P : null }
  }, [data, settings.suivi_debut])

  const status = (c, r) => {
    if (!r || !r.n) return { cls: 'neutral', txt: 'Pas de données', reco: 'Saisir la fréquentation chaque jour' }
    if (c.test_since) {
      const age = diffDays(today(), c.test_since)
      if (age < 91) return { cls: 'neutral', txt: 'Test · ' + (91 - age) + ' j restants', reco: r.avg >= 5 ? 'Au-dessus du seuil de 5 adhérents' : 'Sous le seuil de 5 : le développer par le bouche-à-oreille ciblé' }
      return r.avg > 5 ? { cls: 'good', txt: 'Test réussi', reco: 'Le garder et le développer' } : { cls: 'bad', txt: 'Test non concluant', reco: 'Le supprimer et rediriger vers les créneaux existants' }
    }
    if (r.rate < 0.6) return { cls: 'bad', txt: 'Sous-rempli', reco: "Remplir avant d'ouvrir" }
    if (r.rate < 0.9) return { cls: 'good', txt: 'Bonne santé', reco: 'Continuer à le développer' }
    return { cls: 'warn', txt: 'Plein', reco: 'Envisager un créneau test de 3 mois à côté' }
  }
  const heat = (r) => (r >= 0.9 ? 'hwarn' : r >= 0.6 ? 'hgood' : 'hbad')

  async function startSuivi() {
    const { error } = await supabase.from('boxes').update({ settings: { ...settings, suivi_debut: today() } }).eq('id', box.id)
    if (error) return toast(error.message)
    toast('Suivi de 3 mois lancé aujourd\'hui')
    window.location.reload()
  }

  const jourSuivi = settings.suivi_debut ? diffDays(today(), settings.suivi_debut) + 1 : null

  return (
    <div className="stack">
      <div className="card">
        <div className="spread">
          <div><h2>Planning &amp; remplissage</h2><p className="sub">Le planning une fois, la fréquentation chaque jour (page Aujourd'hui), et après 3 mois une lecture claire de chaque créneau.</p></div>
          {role === 'owner' && <div className="seg">{[['grille', '1. Mon planning'], ['lecture', '2. Lecture du remplissage']].map(([k, l]) => <button key={k} className="rper" aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}</div>}
        </div>

        {mode === 'lecture' && role === 'owner' && (
          <div className="suivi">
            <div className="spread">
              <b>{jourSuivi == null ? 'Aucun suivi lancé' : jourSuivi > 91 ? 'Suivi de 3 mois terminé : tu peux ajuster le planning' : 'Suivi en cours : jour ' + jourSuivi + ' sur 91'}</b>
              <span className="sub">{stats.days} jours saisis · remplissage global {stats.overall == null ? '—' : num(stats.overall * 100) + ' %'}</span>
            </div>
            {jourSuivi != null && <div className="track"><div className="fill" style={{ width: Math.min(jourSuivi / 91, 1) * 100 + '%' }} /></div>}
            <div className="row"><span className="sub">Conseil : saisis chaque jour pendant 3 mois avant de toucher au planning.</span><button className="btn small ghost" onClick={startSuivi}>{jourSuivi == null ? 'Lancer le suivi de 3 mois' : 'Relancer un suivi'}</button></div>
          </div>
        )}

        <div className="scroll">
          <table className="pgrid">
            <thead><tr><th />{days.map((d) => <th key={d}>{JOURS[d]}</th>)}</tr></thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <th className="hour"><span>{h}</span></th>
                  {days.map((d) => {
                    const cs = data.courses.filter((x) => x.weekday === d && hhmm(x.start_time) === h).sort((a, b) => a.type_name.localeCompare(b.type_name))
                    if (mode === 'grille') {
                      return (
                        <td key={d}>
                          <div className={'pslot' + (cs.length > 1 ? ' multi' : '')}>
                            {cs.map((c) => <button key={c.id} className="pchip" style={chip(c.type_name, types)} disabled={role !== 'owner'} onClick={() => setEdit(c)}><b>{c.type_name}</b><small>{c.label ? c.label + ' · ' : ''}{c.capacity} pl.{c.test_since ? ' · test' : ''}</small></button>)}
                            {role === 'owner' && cs.length < 3 && <button className={'pchip empty' + (cs.length ? ' mini' : '')} onClick={() => setEdit({ weekday: d, start_time: h, type_name: types[0].name, capacity: 15, siblings: cs.length })} aria-label={(cs.length ? 'Ajouter un cours en même temps ' : 'Ajouter un cours ') + JOURS[d] + ' ' + h} title={cs.length ? 'Ajouter un cours en même temps' : 'Ajouter un cours'}>+</button>}
                          </div>
                        </td>
                      )
                    }
                    if (!cs.length) return <td key={d} />
                    return (
                      <td key={d}><div className={'pslot' + (cs.length > 1 ? ' multi' : '')}>{cs.map((c) => {
                        const r = stats.per[c.id]
                        if (!r || !r.n) return <div key={c.id} className="hcell nodata"><span className="tag" style={chip(c.type_name, types)}>{c.type_name}</span><b>—</b><small>{c.label ? c.label + ' · ' : ''}pas de saisie</small></div>
                        return <div key={c.id} className={'hcell ' + heat(r.rate)} title={status(c, r).reco}><span className="tag" style={chip(c.type_name, types)}>{c.type_name}{c.test_since ? ' · test' : ''}</span><b>{num(r.rate * 100)} %</b><small>{num(r.avg, 1)} / {c.capacity} · {r.n} séances</small></div>
                      })}</div></td>
                    )
                  })}
                </tr>
              ))}
              {!hours.length && <tr><td colSpan={8}><Empty>{role === 'owner' ? 'Ajoute un premier horaire ci-dessous.' : 'Le planning n\'est pas encore renseigné.'}</Empty></td></tr>}
            </tbody>
          </table>
        </div>
        {mode === 'grille' && role === 'owner' && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); const v = e.target.h.value; if (v && !hours.includes(v)) setExtraHours([...extraHours, v]); e.target.reset() }}>
            <label className="inline">Ajouter un horaire <input type="time" name="h" required /></label><button className="btn small ghost">Ajouter la ligne</button>
          </form>
        )}
        {mode === 'lecture' && <div className="legend"><span><i className="lb" />Moins de 60 % · sous-rempli</span><span><i className="lg" />60 à 90 % · bonne santé</span><span><i className="lw" />90 % et plus · plein</span></div>}
      </div>

      {mode === 'lecture' && role === 'owner' && (
        <div className="card">
          <h3>Créneau par créneau</h3>
          <div className="scroll"><table>
            <thead><tr><th>Créneau</th><th>Cours</th><th>Moyenne</th><th>Taux</th><th>Statut</th><th>Conseil</th></tr></thead>
            <tbody>{data.courses.map((c) => { const r = stats.per[c.id], s = status(c, r); return <tr key={c.id}><td>{JOURS[c.weekday]} {hhmm(c.start_time)}{c.label ? ' · ' + c.label : ''}</td><td><TypeTag name={c.type_name} types={types} /></td><td>{r.n ? num(r.avg, 1) + ' / ' + c.capacity : '—'}</td><td>{r.n ? num(r.rate * 100) + ' %' : '—'}</td><td><Pill cls={s.cls}>{s.txt}</Pill></td><td className="sub">{s.reco}</td></tr> })}</tbody>
          </table></div>
        </div>
      )}

      {edit && <CourseModal course={edit} types={types} box={box} data={data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} toast={toast} log={log} />}
    </div>
  )
}

function CourseModal({ course, types, box, data, onClose, onSaved, toast }) {
  const isNew = !course.id
  const room = 3 - (course.siblings || 0)
  const [f, setF] = useState({ weekday: course.weekday, start_time: hhmm(course.start_time), test: !!course.test_since })
  const blank = (i) => ({ type_name: i === 0 ? course.type_name : (types[i] || types[0]).name, capacity: course.capacity || 15, label: course.label || '', newType: '' })
  const [rows, setRows] = useState([blank(0)])
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  function setCount(n) {
    const next = rows.slice(0, n)
    while (next.length < n) next.push({ ...blank(next.length), label: 'Zone ' + (next.length + 1) })
    if (n > 1 && !next[0].label) next[0] = { ...next[0], label: 'Zone 1' }
    setRows(next)
  }

  async function save(e) {
    e.preventDefault()
    const out = []
    for (const r of rows) {
      let type = r.type_name
      if (type === '__new') { type = r.newType.trim(); if (!type) return toast('Donne un nom au nouveau type de cours') }
      if (!data.course_types.some((t) => t.name === type) && !out.some((o) => o.type_name === type)) {
        const { error } = await supabase.from('course_types').insert({ box_id: box.id, name: type, color_index: (data.course_types.length + out.length) % PALETTE.length })
        if (error && !/duplicate/i.test(error.message)) return toast(error.message)
      }
      out.push({ box_id: box.id, weekday: Number(f.weekday), start_time: f.start_time, type_name: type, capacity: Math.max(1, Number(r.capacity) || 1), label: r.label.trim() || null, test_since: f.test ? course.test_since || today() : null })
    }
    const { error } = isNew ? await supabase.from('courses').insert(out) : await supabase.from('courses').update(out[0]).eq('id', course.id)
    if (error) return toast(/maximum 3/i.test(error.message) ? 'Maximum 3 cours sur le même créneau' : error.message)
    onSaved()
  }
  async function del() {
    if (!window.confirm('Supprimer ce cours ? Les réservations et la fréquentation de ce cours seront supprimées.')) return
    const { error } = await supabase.from('courses').delete().eq('id', course.id)
    if (error) return toast(error.message)
    onSaved()
  }
  return (
    <Modal title={isNew ? (course.siblings ? 'Ajouter un cours en même temps' : 'Ajouter un cours') : 'Modifier le cours'} onClose={onClose} wide={rows.length > 1}>
      <form className="stack" onSubmit={save}>
        <div className="form">
          <label>Jour<select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>{JOURS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></label>
          <label>Heure<input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} required /></label>
          {isNew && room > 1 && <label className="full">{course.siblings ? 'Il y a déjà ' + course.siblings + ' cours à cette heure : combien en ajouter ?' : 'Cours en même temps'}
            <div className="seg">{[1, 2, 3].filter((n) => n <= room).map((n) => <button type="button" key={n} className="rper" aria-pressed={rows.length === n} onClick={() => setCount(n)}>{course.siblings ? 'Ajouter ' + n + ' cours' : n === 1 ? '1 cours' : n + ' cours en parallèle'}</button>)}</div>
          </label>}
        </div>
        {rows.map((r, i) => (
          <div key={i} className={rows.length > 1 ? 'courserow' : ''}>
            {rows.length > 1 && <p className="phase" style={{ marginTop: 0 }}>Cours {i + 1}</p>}
            <div className="form">
              <label>Type de cours<select value={r.type_name} onChange={(e) => setRow(i, { type_name: e.target.value })}>{types.map((t) => <option key={t.name}>{t.name}</option>)}<option value="__new">Nouveau type…</option></select></label>
              {r.type_name === '__new' && <label>Nom du nouveau type<input value={r.newType} onChange={(e) => setRow(i, { newType: e.target.value })} placeholder="Ex. : Spé gym" /></label>}
              <label>Places<input type="number" min="1" value={r.capacity} onChange={(e) => setRow(i, { capacity: e.target.value })} required /></label>
              <label>Zone ou salle{rows.length > 1 || course.siblings ? '' : ' (facultatif)'}<input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="Ex. : Salle 1, Zone haltéro" /></label>
            </div>
          </div>
        ))}
        <label className="inline"><input type="checkbox" checked={f.test} onChange={(e) => setF({ ...f, test: e.target.checked })} /> Créneau test (3 mois, seuil de 5 adhérents)</label>
        <div className="row spread">{!isNew ? <button type="button" className="btn ghost" onClick={del}>Supprimer ce cours</button> : <span />}<button className="btn">{rows.length > 1 ? 'Créer les ' + rows.length + ' cours' : 'Enregistrer'}</button></div>
      </form>
    </Modal>
  )
}
