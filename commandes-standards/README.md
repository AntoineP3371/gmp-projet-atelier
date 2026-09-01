# Commandes d'éléments standards — module Atelier GMP

Appli web (fichier unique `index.html`) pour gérer les **demandes d'achat de composants standards**
(visserie, roulements, paliers, coussinets, ressorts, poulies…) des groupes projet GMP.

Même base Supabase et même charte que les applis *Usinage* et *Impression 3D* du dépôt.

- **Écran 1 — Nouvelle demande** : l'encadrant s'**identifie d'abord** (son nom — pris **uniquement** dans
  la liste des encadrants de la table `etudiants`, gérée depuis la page principale — + code PIN encadrant).
  Ensuite les **projets, parcours et formations proposés sont limités à ceux qu'il encadre** (d'après
  `etudiants`) ; le parcours et la formation s'auto-remplissent au choix du projet. Puis il ajoute un ou
  plusieurs **blocs fournisseur** (nom du fournisseur une fois) contenant chacun un ou plusieurs
  **articles** (intitulé, référence, quantité, prix unitaire estimé, lien). Total estimé calculé
  automatiquement, barre de budget du parcours mise à jour en direct.
- **Écran 2 — Suivi** (public, sans code) : filtres projet / encadrant / statut / parcours, panneau
  d'**aide décrivant chaque statut**, demandes regroupées par projet, pastille de statut, étapes
  horodatées, total par projet, barres de budget par parcours.
- **Écran 3 — Espace gestionnaire** (code opérateur) : compteurs, filtres (dont projet et encadrant),
  tableau avec **colonne Contexte** et **colonne Article & fournisseur** séparées, 5 vues au choix
  (**Par date**, **Par statut** — ordre demandée → commandée → reçue partielle → reçue → remise →
  refusée → annulée —, **Par fournisseur**, **Par projet**, **Par encadrant** ; chaque groupe avec
  sous-total et « tout marquer commandé »), actions par ligne (Commandé / Reçu / Récupéré / Éditer /
  Commenter), export CSV et Excel.
- **Écran 4 — Admin** : un seul bouton, deux niveaux selon le mot de passe saisi (vérifié par l'Edge
  Function `admin-op`) :
  - **mot de passe admin** → fournisseurs (**nom, site et commentaire modifiables**, ajout, actif/inactif,
    suppression) et budgets en € par parcours. Bouton **Se déconnecter** en haut du panneau.
  - **mot de passe super admin** (`super1234`, **commun aux applis Atelier GMP**) → en plus : choix des
    **gestionnaires** (cocher, parmi les opérateurs de l'atelier, ceux qui peuvent gérer les commandes —
    eux seuls sont proposés à l'entrée de l'espace gestionnaire ; aucun coché = tous proposés) et
    **vidage des tables** de ce module (`commandes`, `com_fournisseurs`, `com_budgets`,
    `com_gestionnaires`), une par une ou toutes, avec confirmation à taper. Ne touche jamais les tables
    des autres applis.

Statuts : `demandee` → `commandee` → `recue_partielle` / `recue_complete` → `remise`, plus `refusee` / `annulee`.

---

## Mise en route

### 1. Créer les tables dans Supabase

1. Ouvre le **dashboard Supabase** du projet `ggmlfbxppgeivfvlxxrj` → menu **SQL Editor** → **New query**.
2. Copie **tout** le contenu de `schema.sql`, colle, clique **Run**.
   → crée 4 tables (`commandes`, `com_fournisseurs`, `com_budgets`, `com_gestionnaires`), pré-remplit la
   liste des fournisseurs, active le temps réel. **N'altère aucune table existante**, relançable sans risque
   (à relancer si tu avais déjà lancé une version antérieure sans `com_gestionnaires`).

### 2. (Facultatif) Importer l'historique du Google Sheet

1. Toujours dans le **SQL Editor**, nouvelle requête.
2. Copie tout le contenu de `import.sql`, colle, **Run**.
   → insère les 89 lignes 2025-2026 nettoyées (dates corrigées, coûts « ? » vidés, décalages rattrapés).
3. Pour repartir de zéro plus tard : `TRUNCATE public.commandes RESTART IDENTITY;`

### 3. Lancer l'appli en local

Depuis la racine du dépôt `reservation-machines` :

```bash
python -m http.server 8765
```

Puis ouvre <http://localhost:8765/commandes-standards/>

(ou via la config `.claude/launch.json` déjà présente, entrée « reservation-machines »).

### 3 bis. VERSION PUBLIQUE — verrouiller les écritures (2 opérations Supabase)

En version publique, la clé anon (visible dans le HTML) ne doit plus pouvoir écrire directement.
Toutes les écritures passent par l'Edge Function **`commande-op`**.

1. **Déployer l'Edge Function** — dashboard Supabase → **Edge Functions** → **Deploy a new function** →
   nom exact **`commande-op`** → coller tout `supabase/functions/commande-op/index.ts` → **Deploy**.
   (Les secrets `SUPERADMIN_PW_HASH` et `ADMIN_PW_HASH` sont déjà en place, partagés avec les autres applis.)
2. **Fermer les écritures directes** — SQL Editor → coller tout **`secure.sql`** → **Run**.
   → supprime les policies permissives, ne laisse qu'une lecture (`SELECT`) pour la clé anon.
   (Le fichier `schema.sql` est déjà à jour pour un futur déploiement neuf.)

Tant que ces 2 opérations ne sont pas faites, l'appli **charge** mais toute écriture affiche
« Refusé : … » (l'Edge Function n'existe pas encore).

### 4. En ligne

Poussé avec le dépôt → `https://gmpbordeaux.fr/gmp-projet-atelier/commandes-standards/`,
**avec une carte sur le portail** (`../index.html`, carte verte « Éléments standards »).

### Codes utilisés (déjà en place, rien à déployer)

| Accès | Code | Vérifié par |
|---|---|---|
| Encadrant (créer / annuler une demande) | **code PIN encadrant commun** | Edge Function `verify-code` puis re-vérifié par `commande-op` |
| Gestionnaire | **code opérateur** (table `operateurs`) | idem |
| Admin / Super admin | **mot de passe admin** / `super1234` | Edge Function `admin-op` (`login`) puis re-vérifié par `commande-op` |

La liste des encadrants proposée vient de la table `etudiants` (colonnes `encadrant1/2/3`), déjà utilisée
par l'appli Impression 3D. La liste des noms gestionnaires vient de `operateurs_public`, filtrée par
`com_gestionnaires` (choix du super admin).

---

## Notification WhatsApp au(x) gestionnaire(s) — à chaque nouvelle demande

À l'envoi d'une demande, l'Edge Function `commande-op` envoie un message WhatsApp (CallMeBot) aux
opérateurs **abonnés**. Pour l'activer :

1. **SQL** — coller tout `notif-achats.sql` dans le SQL Editor (ajoute `operateurs.notif_achats` +
   l'expose dans la vue `operateurs_public`).
2. **Redéployer l'Edge Function `commande-op`** (elle contient l'envoi + l'action `gest-notif`).
3. Dans l'écran **Admin → super admin → Gestionnaires**, cocher **🔔 WhatsApp** en face des opérateurs à
   prévenir (visible seulement s'ils ont un numéro renseigné côté « opérateurs » du portail).

Message envoyé : « Nouvelle demande d'achat — Atelier GMP / Par : … / Projet : … / N article(s) chez M
fournisseur(s) / Total estimé : … » + les 3 premiers articles + lien vers l'appli.

## Reste optionnel (non fait)

- **Notifications e-mail (Resend, déjà configuré ailleurs)** — prévenir l'encadrant quand sa commande
  passe en `recue_complete` / `remise` (adresse dans une table verrouillée façon `demande_contacts`).
- **Sauvegarde** — l'Edge Function `backup` sauvegarde déjà *toutes* les tables : `commandes`,
  `com_fournisseurs`, `com_budgets`, `com_gestionnaires` sont incluses automatiquement.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | l'appli complète (aucun build) |
| `schema.sql` | création des 4 tables + fournisseurs pré-remplis + RLS version publique (à lancer une fois) |
| `secure.sql` | ferme les écritures directes sur une base déjà en phase test (à lancer une fois au passage public) |
| `notif-achats.sql` | colonne `operateurs.notif_achats` + vue, pour la notif WhatsApp (à lancer une fois) |
| `supabase/functions/commande-op/index.ts` | Edge Function qui porte toutes les écritures + la notif WhatsApp (à déployer) |
| `import.sql` | reprise des 89 lignes du Google Sheet 2025-2026 (à lancer une fois, facultatif) |
| `logo-gmp.png` | logo affiché en haut de page |
| `README.md` | ce fichier |
