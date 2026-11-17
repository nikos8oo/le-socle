// Lien avec la formation Drill's & Skills Academy : chaque module renvoie vers la leçon qui l'explique
export const ACADEMY_URL = 'https://drills-skills-two.vercel.app/'

const lesson = (course, id) => `${ACADEMY_URL}#/cours/${course}/lecon/${id}`
const M1 = '232bed86-2a6a-49ae-b416-a80487086289'
const M2 = '93b4aa24-2810-4105-9da4-9353dae45c62'
const M3 = 'ea6fa5c1-e776-48ec-91d2-3c9775d1fcf9'

export const LEARN = {
  planning: { url: lesson(M1, '3b39790c-d006-4f3a-a9c7-0a8abb99a760'), label: 'Mois 1 · Inventaire du planning et taux de remplissage' },
  trials: { url: lesson(M3, '2bdfe531-0c0d-4ddb-b0a8-accdddf63af5'), label: 'Mois 3 · Le suivi adhérents : la transformation' },
  members: { url: lesson(M3, 'c935e75a-dc82-4337-a092-e4165cc3bc08'), label: 'Mois 3 · La rétention et la LTV' },
  team: { url: lesson(M2, 'f6498229-a8c7-4a98-a7fb-0e9bc3618a97'), label: 'Mois 2 · Le recrutement d’un coach et la gestion de l’équipe' },
  finance: { url: lesson(M3, 'cd4ba035-3e15-4689-ad01-9e51fa4d3566'), label: 'Mois 3 · Bilan business et plan de croissance' },
}
