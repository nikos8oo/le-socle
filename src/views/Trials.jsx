import { useState } from 'react'
import LearnLink from '../components/LearnLink'
import { supabase } from '../lib/supabase'
import { addDays, fmt, num, today } from '../lib/dates'
import { whoName } from '../lib/method'
import { Empty, Pill } from '../components/ui'

export default function Trials({ box, role, data, reload, toast, log, myCoach }) {
  const t = today()
  const [periode, setPeriode] = useState(90)
  const [f, setF] = useState({ day: t, prospect: '', coach_id: '', result: 'att' })
  const from = periode ? addDays(t, -periode) : '0000'
  const list = data.trials.filter((e) => e.day >= from)
  const coaches = role === 'owner' ? data.coaches : data.coaches.filter((c) => c.id === myCoach)

  const per = {}
  coaches.forEach((c) => (per[c.id] = { n: 0, oui: 0, non: 0, att: 0 }))
  const tot = { n: 0, oui: 0, non: 0, att: 0 }
  list.forEach((e) => { const r = per[e.coach_id]; if (r) { r.n++; r[e.result]++ } tot.n++; tot[e.result]++ })
  const rate = (r) => (r.oui + r.non ? r.oui / (r.oui + r.non) : null)
  const cls = (v) => (v >= 0.75 ? 'good' : v >= 0.5 ? 'warn' : 'bad')

  async function add(e) {
    e.preventDefault()
    const coach_id = role === 'owner' ? f.coach_id || (data.coaches[0] && data.coaches[0].id) : myCoach
    if (!coach_id) return toast(role === 'owner' ? 'Ajoute d\'abord un coach dans Équipe' : 'Ton compte n\'est pas relié à une fiche coach')
    const { error } = await supabase.from('trials').insert({ box_id: box.id, day: f.day, prospect: f.prospect.trim(), coach_id, result: f.result })
    if (error) return toast(error.message)
    await log('Essai ajouté : ' + (f.prospect.trim() || 'prospect') + ' avec ' + whoName(coach_id, data.coaches))
    setF({ ...f, prospect: '' })
    toast('Essai ajouté')
    reload()
  }
  async function setResult(id, result) {
    const { error } = await supabase.from('trials').update({ result }).eq('id', id)
    if (error) return toast(error.message)
    reload()
  }
  async function setCoach(id, coach_id) {
    if (!coach_id) return
    const { error } = await supabase.from('trials').update({ coach_id }).eq('id', id)
    if (error) return toast(error.message)
    reload()
  }
  async function del(id) {
    const { error } = await supabase.from('trials').delete().eq('id', id)
    if (error) return toast(error.message)
    reload()
  }
  async function setPath(c, path) {
    const { error } = await supabase.from('coaches').update({ path: c.path === path ? null : path, path_since: today() }).eq('id', c.id)
    if (error) return toast(error.message)
    reload()
  }

  return (
    <div className="stack">
      <div className="card">
        <div><h2>{role === 'owner' ? "Séances d'essai & transformation" : 'Mes séances d\'essai'}</h2><p className="sub">Note chaque essai et le coach qui l'a encadré. Le taux de transformation se calcule tout seul. Cible : 80 %, soit 8 essais sur 10.</p>{role === 'owner' && <LearnLink k="trials" />}</div>
        <form className="form" onSubmit={add}>
          <label>Date<input type="date" value={f.day} max={t} onChange={(e) => setF({ ...f, day: e.target.value })} required /></label>
          <label>Prénom du prospect<input value={f.prospect} onChange={(e) => setF({ ...f, prospect: e.target.value })} placeholder="Ex. : Julien" /></label>
          {role === 'owner' && <label>Coach du cours<select value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}>{data.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label>Résultat<select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="att">En attente</option><option value="oui">Inscrit</option><option value="non">Pas inscrit</option></select></label>
          <div className="row end"><button className="btn">Ajouter l'essai</button></div>
        </form>
      </div>

      <div className="grid g2 top">
        <div className="card">
          <div className="spread"><h3>Transformation{role === 'owner' ? ' par coach' : ''}</h3>
            <div className="seg">{[[30, '30 j'], [90, '90 j'], [0, 'Tout']].map(([v, l]) => <button key={v} className="rper" aria-pressed={periode === v} onClick={() => setPeriode(v)}>{l}</button>)}</div></div>
          <div className="scroll"><table>
            <thead><tr><th>Coach</th><th>Essais</th><th>Inscrits</th><th>Taux</th></tr></thead>
            <tbody>
              {coaches.map((c) => { const r = per[c.id], v = rate(r); return <tr key={c.id}><td><b>{c.name}</b></td><td>{r.n}{r.att ? <span className="sub"> ({r.att} en attente)</span> : null}</td><td>{r.oui}</td><td>{v == null ? '—' : <Pill cls={cls(v)}>{num(v * 100)} %</Pill>}</td></tr> })}
              {role === 'owner' && <tr><td><b>Équipe</b></td><td>{tot.n}</td><td>{tot.oui}</td><td>{rate(tot) == null ? '—' : <b>{num(rate(tot) * 100)} %</b>}</td></tr>}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h3>Derniers essais</h3>
          <div className="list">
            {list.slice(0, 12).map((e) => (
              <div className="prow" key={e.id}>
                <div style={{ minWidth: 120 }}><b>{e.prospect || 'Prospect'}</b> {e.booking_id && <Pill cls="neutral">Réservé dans l'app</Pill>}
                  <div className="sub">{fmt(e.day)} · {role === 'owner' && !e.coach_id ? <select value="" onChange={(ev) => setCoach(e.id, ev.target.value)} aria-label="Coach du cours"><option value="">Quel coach ?</option>{data.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : whoName(e.coach_id, data.coaches)}</div></div>
                <div className="seg right">{[['att', 'En attente'], ['oui', 'Inscrit'], ['non', 'Pas inscrit']].map(([k, l]) => <button key={k} className={'r' + k} aria-pressed={e.result === k} onClick={() => setResult(e.id, k)}>{l}</button>)}</div>
                {role === 'owner' && <button className="btn small ghost" onClick={() => del(e.id)} aria-label="Supprimer">×</button>}
              </div>
            ))}
            {!list.length && <Empty>Aucun essai noté.</Empty>}
          </div>
        </div>
      </div>

      {role === 'owner' && data.coaches.length > 0 && (
        <div className="card">
          <h3>Que faire avec chaque coach ?</h3>
          <p className="sub">Récompenser ceux qui transforment, ou faire progresser ceux qui sont en dessous.</p>
          <div className="grid g3">
            {data.coaches.map((c) => { const v = rate(per[c.id]); return (
              <div className="kpi" key={c.id}>
                <div className="spread"><b className="big">{c.name}</b>{v != null && <Pill cls={cls(v)}>{num(v * 100)} %</Pill>}</div>
                <span>{v == null ? "Pas encore assez d'essais pour juger" : v >= 0.75 ? 'Transforme bien : la prime le reconnaît' : 'Sous la cible : la formation rapportera plus'}</span>
                <div className="seg col">
                  <button className="rper" aria-pressed={c.path === 'prime'} onClick={() => setPath(c, 'prime')}>Prime à la transformation</button>
                  <button className="rper" aria-pressed={c.path === 'formation'} onClick={() => setPath(c, 'formation')}>Plan de formation</button>
                </div>
              </div>
            ) })}
          </div>
        </div>
      )}
    </div>
  )
}
