// Formules : modèles, libellés et calculs partagés.

// Prix indicatifs : l'owner les adapte avant d'enregistrer.
export const TEMPLATES = [
  { name: '2 séances / semaine', kind: 'hebdo', per_week: 2, price_cents: 5900, period: 'mois', commitment_months: 0 },
  { name: '3 séances / semaine', kind: 'hebdo', per_week: 3, price_cents: 6900, period: 'mois', commitment_months: 0 },
  { name: '4 séances / semaine', kind: 'hebdo', per_week: 4, price_cents: 7900, period: 'mois', commitment_months: 0 },
  { name: 'Illimité', kind: 'illimite', price_cents: 8900, period: 'mois', commitment_months: 0 },
  { name: 'Carnet 5 séances', kind: 'carnet', sessions: 5, validity_days: 90, price_cents: 6000, period: 'unique', commitment_months: 0 },
  { name: 'Carnet 10 séances', kind: 'carnet', sessions: 10, validity_days: 180, price_cents: 11000, period: 'unique', commitment_months: 0 },
  { name: 'Carnet 20 séances', kind: 'carnet', sessions: 20, validity_days: 365, price_cents: 20000, period: 'unique', commitment_months: 0 },
]

export const PERIOD = { mois: '/ mois', trimestre: '/ trimestre', annee: '/ an', unique: '' }
export const PERIOD_LBL = { mois: 'Chaque mois', trimestre: 'Chaque trimestre', annee: 'Chaque année', unique: 'Paiement unique' }
export const KIND_LBL = { hebdo: 'Séances par semaine', illimite: 'Illimité', carnet: 'Carnet de séances' }
export const METHODS = [['sur_place', 'Sur place'], ['cb', 'Carte bancaire'], ['especes', 'Espèces'], ['virement', 'Virement'], ['cheque', 'Chèque']]
export const STATUS = { attente_paiement: ['warn', 'Paiement à valider'], active: ['good', 'Active'], suspendue: ['neutral', 'Suspendue'], terminee: ['neutral', 'Terminée'] }

const s = (n) => (n > 1 ? 's' : '')

export function money(cents) {
  const v = (cents || 0) / 100
  return v.toLocaleString('fr-FR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €'
}

export function validityText(days) {
  if (!days) return 'sans limite de durée'
  if (days % 365 === 0) return 'valable ' + days / 365 + ' an' + s(days / 365)
  if (days % 30 === 0) return 'valable ' + days / 30 + ' mois'
  return 'valable ' + days + ' jours'
}

export function ruleText(p) {
  if (p.kind === 'illimite') return 'Accès illimité'
  if (p.kind === 'hebdo') return p.per_week + ' séance' + s(p.per_week) + ' par semaine'
  return p.sessions + ' séance' + s(p.sessions) + ', ' + validityText(p.validity_days)
}

export function priceText(p) {
  return money(p.price_cents) + (PERIOD[p.period] ? ' ' + PERIOD[p.period] : '')
}

// Où en est l'abonnement (résultat de subscription_usage)
export function usageText(u) {
  if (u.status === 'attente_paiement') return 'En attente du paiement'
  if (u.kind === 'illimite') return 'Accès illimité'
  if (u.kind === 'hebdo') { const left = Math.max(0, u.per_week - u.used_week); return left + ' séance' + s(left) + ' restante' + s(left) + ' cette semaine' }
  const left = Math.max(0, u.sessions - u.used_total)
  return left + ' séance' + s(left) + ' restante' + s(left) + ' sur ' + u.sessions
}

// Revenu mensuel récurrent estimé d'un abonnement actif
export function monthly(u) {
  if (u.status !== 'active' || u.kind === 'carnet' || u.period === 'unique') return 0
  return u.period === 'trimestre' ? u.price_cents / 3 : u.period === 'annee' ? u.price_cents / 12 : u.price_cents
}
