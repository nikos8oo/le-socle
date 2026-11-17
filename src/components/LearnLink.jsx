import { LEARN } from '../lib/academy'

/** « Apprends-le dans la formation » : renvoie vers la leçon de la Drill's & Skills Academy qui explique ce module */
export default function LearnLink({ k }) {
  const l = LEARN[k]
  if (!l) return null
  return (
    <a className="learnlink" href={l.url} target="_blank" rel="noreferrer" title="Ouvrir la leçon dans Drill's & Skills Academy">
      <span aria-hidden="true">🎓</span> Apprends-le dans DS Academy : <b>{l.label}</b> ↗
    </a>
  )
}
