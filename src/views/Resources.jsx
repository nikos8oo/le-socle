import { ACADEMY_URL } from '../lib/academy'
const DOCS = [
  { f: '/note-book-coach-2-0.pdf', n: 'Note Book Coach 2.0', d: 'Préparer un cours : objectifs, timing, points techniques, échauffement, retour au calme.', who: 'all' },
]
const LIENS = [
  { u: ACADEMY_URL, n: 'Drill\'s & Skills Academy', d: 'La formation en ligne : leçons, quiz et mises en pratique terrain. Connexion avec le code d’accès de ta salle.' },
]

export default function Resources({ role }) {
  return (
    <div className="stack">
      <div className="card">
        <h2>Ressources</h2>
        <p className="sub">Les documents de la méthode, à télécharger et à imprimer.</p>
        <div className="grid g2">
          {DOCS.filter((d) => d.who === 'all' || role === 'owner').map((d) => (
            <div className="kpi" key={d.f}><b className="big">{d.n}</b><span>{d.d}</span><div className="row"><a className="btn small" href={d.f} download>Télécharger le PDF</a></div></div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>Formation</h3>
        {LIENS.map((l) => <div className="prow" key={l.u}><div style={{ flex: 1 }}><b>{l.n}</b><div className="sub">{l.d}</div></div><a className="btn small ghost" href={l.u} target="_blank" rel="noreferrer">Ouvrir</a></div>)}
      </div>
    </div>
  )
}
