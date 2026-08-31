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

## Mise en route (version test — pour toi seul)

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

### 4. En ligne (toi seul)

Le dossier est poussé avec le reste du dépôt, donc accessible à
`https://gmpbordeaux.fr/gmp-projet-atelier/commandes-standards/`
**mais aucune carte ne pointe dessus depuis le portail** : seule cette URL, connue de toi, y donne accès.

### Codes utilisés (déjà en place, rien à déployer)

| Accès | Code | Vérifié par |
|---|---|---|
| Encadrant (créer / annuler une demande) | **code PIN encadrant commun** | Edge Function `verify-code` (kind `encadrant`) |
| Gestionnaire | **code opérateur** (table `operateurs`) | Edge Function `verify-code` (kind `operateur`) |
| Admin | **mot de passe admin** | Edge Function `admin-op` (action `login`) |

La liste des encadrants proposée vient de la table `etudiants` (colonnes `encadrant1/2/3`), déjà utilisée
par l'appli Impression 3D. La liste des noms gestionnaires vient de `operateurs_public`.

---

## Sécurité — état actuel et passage en version publique

**Phase test :** les 3 nouvelles tables sont en **écriture directe** (policy RLS permissive), exactement
comme l'était la table `demandes` avant sa sécurisation. C'est acceptable tant que l'URL n'est pas diffusée,
mais l'advisor Supabase le signalera.

**Check-list « passage en public » :**

1. **Verrouiller les écritures** — créer une Edge Function `commande-op` (sur le modèle de `demande-op`) :
   - `create` (public, vérifie le budget côté serveur), `statut`, `edit`, `commentaire`, `cancel`
     (encadrant), gestion fournisseurs/budgets (admin).
   - Puis sur les 3 tables : supprimer les policies `*_all`, ne garder qu'un `SELECT` anon
     (`create policy ... for select using (true)`), et faire passer toutes les écritures du `index.html`
     par `sb.functions.invoke('commande-op', …)`.
2. **Ajouter la carte sur le portail** — dans `../index.html`, dupliquer une `.card` existante
   (classe `usinage` / `additive`) en `.card.commandes`, couleur d'accent verte, lien
   `href="commandes-standards/"`, texte « Commandes d'éléments standards ».
   Icône assortie (même style que les deux autres, `viewBox 0 0 64 64`, `stroke-width="3"`) — roulement à billes :
   ```html
   <svg class="icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-label="Éléments standards">
     <circle cx="32" cy="32" r="24"/>
     <circle cx="32" cy="32" r="11"/>
     <circle cx="32" cy="14.5" r="3" fill="currentColor" stroke="none"/>
     <circle cx="44.4" cy="19.6" r="3" fill="currentColor" stroke="none"/>
     <circle cx="49.5" cy="32" r="3" fill="currentColor" stroke="none"/>
     <circle cx="44.4" cy="44.4" r="3" fill="currentColor" stroke="none"/>
     <circle cx="32" cy="49.5" r="3" fill="currentColor" stroke="none"/>
     <circle cx="19.6" cy="44.4" r="3" fill="currentColor" stroke="none"/>
     <circle cx="14.5" cy="32" r="3" fill="currentColor" stroke="none"/>
     <circle cx="19.6" cy="19.6" r="3" fill="currentColor" stroke="none"/>
   </svg>
   ```
   (déjà utilisée dans l'en-tête de `index.html` du module).
3. **Notifications e-mail (Resend, déjà configuré)** — option : prévenir l'encadrant quand sa commande
   passe en `recue_complete` / `remise` (adresse dans une table verrouillée façon `demande_contacts`).
4. **Sauvegarde** — l'Edge Function `backup` sauvegarde déjà *toutes* les tables : `commandes`,
   `com_fournisseurs`, `com_budgets` seront incluses automatiquement.
5. **Numéro de version** — passer `v0.1.0 (test)` → `v1.0.0` dans le `<footer>` et retirer le badge
   « Version test » (`#testFlag`).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | l'appli complète (aucun build) |
| `schema.sql` | création des 3 tables + fournisseurs pré-remplis (à lancer une fois) |
| `import.sql` | reprise des 89 lignes du Google Sheet 2025-2026 (à lancer une fois, facultatif) |
| `README.md` | ce fichier |
