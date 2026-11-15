# Le Socle — Drill's & Skills

L'outil de pilotage des salles accompagnées par Drill's & Skills : planning et remplissage, séances d'essai et transformation, événements avec rétro-planning, équipe (observations, invitations) et ressources. Deux accès : **owner** (tout) et **coach** (ses missions, ses essais, les tâches d'événements, les ressources ; aucun chiffre).

Application web installable sur téléphone (PWA), construite avec Vite + React, données dans Supabase (projet `le-socle`, région Paris).

## Lancer en local

```bash
npm install
cp .env.example .env.local   # puis renseigner l'URL et la clé publique Supabase
npm run dev
```

## Mettre en ligne (Vercel, gratuit pour commencer)

1. Sur vercel.com, « Add New… → Project », importer ce dépôt GitHub.
2. Framework : Vite (détecté automatiquement).
3. Variables d'environnement : `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` (valeurs de `.env.example`).
4. Deploy. Chaque push sur `main` redéploie l'app.

## Réglages Supabase avant d'ouvrir aux salles

- **Authentication → URL Configuration** : mettre l'adresse Vercel (ex. `https://le-socle.vercel.app`) dans *Site URL* et dans *Redirect URLs*. Sans ça, les liens d'e-mail (confirmation, mot de passe oublié) pointent vers localhost.
- **Authentication → Emails → SMTP** : brancher un vrai expéditeur (Resend, Brevo…). L'envoi par défaut de Supabase est limité à quelques e-mails par heure.
- **Authentication → Providers → Email** : laisser « Confirm email » activé.

## Deux espaces, une seule connexion

- **Athlète** : chacun crée son compte et rejoint sa salle avec le code de la salle (ou le lien d'inscription).
- **Espace salle** (owner et coachs) : sur invitation uniquement. Seul l'administrateur Drill's & Skills (table `platform_admins`) crée les salles et envoie les invitations owner et coach depuis l'onglet **Équipe**. L'owner crée les fiches de ses coachs et demande leur accès.

Ouvrir une nouvelle salle : se connecter en espace salle avec le compte admin → « Créer une salle » → onglet Équipe → inviter l'owner (accès Owner) avec son e-mail → lui envoyer le lien copié.

## Base de données

Le schéma, les fonctions et les règles d'accès (RLS) sont dans `supabase/migrations/`. Les règles sont appliquées par la base elle-même : un coach ne peut pas lire les finances, la fréquentation, les observations ni les essais des autres, même en contournant l'interface.

## Réservations (étape 1)

- L'owner partage le lien d'inscription de sa salle (onglet **Adhérents**). L'adhérent crée son compte et réserve ses cours depuis son téléphone : places restantes, liste d'attente, annulation.
- Quand une place se libère, le premier de la liste d'attente monte automatiquement.
- L'owner règle l'ouverture des réservations (jours à l'avance) et le délai d'annulation sans pénalité ; une annulation plus tardive est comptée comme « annulé tard ».
- Dans **Aujourd'hui**, chaque cours affiche les inscrits en direct ; l'owner ou le coach fait l'appel (présent / absent, ou venu sans réserver). La fréquentation et la dernière venue de l'adhérent se mettent à jour toutes seules.
- Un adhérent ne voit que le planning, les places et ses propres réservations : jamais les autres adhérents, l'équipe ni les chiffres.

## Paiement en ligne (Stripe Connect)

- Chaque salle relie son propre compte Stripe (onglet **Formules → Activer le paiement en ligne**) ; les paiements arrivent directement chez elle.
- L'athlète paie par carte dans la Boutique : abonnement prélevé automatiquement (mois / trimestre / an) ou paiement unique (carnets). « Gérer mon paiement » ouvre l'espace client Stripe (carte, factures, résiliation en fin de période).
- Fonctions serveur : `supabase/functions/stripe-api` (inscription des salles, paiement, espace client, résiliation) et `supabase/functions/stripe-webhook` (active, renouvelle, suspend, termine les formules).
- La clé Stripe et le secret du webhook sont rangés dans le coffre chiffré Supabase (`vault`), lisibles uniquement par le serveur. En production, préférer les secrets Edge Functions `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` (prioritaires sur le coffre).
- Commission de la plateforme : secret Edge Functions `PLATFORM_FEE_PERCENT` (0 par défaut).

## À savoir pour faire évoluer la base

- La table `boxes` est lue colonne par colonne (les notes privées de l'admin, `admin_notes`, ne sont jamais exposées). **Toute nouvelle colonne de `boxes` doit être ajoutée au `grant select (…)`** (voir `20261114225000_infos_salle.sql`).
- Seul l'admin plateforme peut changer le statut d'une salle ; seules les fonctions serveur peuvent changer les réglages Stripe.
- Les logos sont stockés dans le bucket public `box-logos`, dans un dossier par salle (écriture réservée à l'owner).

## Feuille de route

- Version pilote : Aujourd'hui, Planning, Séances d'essai, Événements, Équipe, Ressources.
- Étape 1 (fait) : réservations des adhérents, liste d'attente, appel en direct.
- Étape 2 (fait) : formules, boutique, paiement par carte avec prélèvement automatique.
- Étape 3 : aide à la migration depuis Deciplus, abonnement Le Socle pour les salles.
- Ensuite : suivi des nouveaux adhérents (60 jours), simulateur LTV, réunion d'équipe, document d'onboarding coach en PDF, rappels par e-mail, abonnement Stripe.

## Module réservations (par salle)
`boxes.booking_module` : inscription des adhérents par code salle, réservation, formules en boutique, paiement en ligne.
- Désactivé par défaut pour toute nouvelle salle (Le Socle se pose à côté du logiciel de réservation de la salle).
- Seul le super admin l'active ou le coupe (console : colonne « Module réservations » ou fiche « Gérer »). Une salle de démo l'a toujours.
- Coupé : pas d'onglets Formules / Paiement en ligne côté owner, pas d'espace réservation côté adhérent. En base, inscription adhérent, réservation et achat sont refusés (triggers `require_booking_module`), sauf pour l'équipe de la salle. Rien n'est supprimé.
