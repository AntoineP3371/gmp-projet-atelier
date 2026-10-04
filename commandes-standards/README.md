# Commandes d'éléments standards — module Atelier GMP

Appli web (fichier unique `index.html`) pour gérer les **demandes d'achat de composants standards**
(visserie, roulements, paliers, coussinets, ressorts, poulies…) des groupes projet GMP.

Même base Supabase et même charte que les applis *Usinage* et *Impression 3D* du dépôt.

- **Écran 1 — Nouvelle demande** : deux façons de s'identifier.
  - **Étudiant** : il choisit son **projet** (cartes groupées par parcours, comme dans Carnet SAE) et saisit le
    **mot de passe du projet** de Carnet SAE GMP (celui qui sert à consulter les notes), vérifié côté serveur.
    Il choisit son nom dans la liste du projet (ou saisit nom/prénom). Parcours et formation viennent de la
    fiche projet. Sa demande est enregistrée « **en attente de l'encadrant** » : elle n'est **pas visible du
    gestionnaire** tant que l'encadrant ne l'a pas validée.
  - **Encadrant** (bouton « Je suis encadrant… ») : nom (liste de la table `etudiants`) + **mot de passe de son
    compte Carnet SAE** (sans compte : code personnel Atelier). Les projets proposés sont ceux qu'il encadre.
    Sa demande est **validée d'office** et part directement chez le gestionnaire.
  Dans les deux cas : un ou plusieurs **blocs fournisseur** contenant chacun un ou plusieurs **articles**
  (intitulé, référence, quantité, prix unitaire estimé, lien), total estimé et barre de budget en direct.
- **Écran 2 — Suivi** (protégé par le **mot de passe du projet**) : on choisit son projet, on saisit son mot de
  passe, puis on voit les demandes de ce projet (filtre texte / statut, aide sur les statuts, étapes
  horodatées avec la décision de l'encadrant et son commentaire, barres de budget). Un étudiant peut
  **annuler** une ligne tant que l'encadrant ne l'a pas validée.
- **Écran 2 bis — Espace encadrant** (mot de passe Carnet SAE) : liste des demandes des étudiants de ses projets,
  regroupées par dépôt. **Chaque ligne a sa propre décision** : **Valider** (transmise au gestionnaire, WhatsApp envoyé alors), **Mettre en attente — manque d'information** (commentaire de ligne obligatoire, visible par l'étudiant) ou **Refuser** ; un bouton « Tout valider » sert de raccourci. Une décision reste modifiable tant que le gestionnaire n'a pas commandé la ligne. Il y voit aussi les lignes qu'il a déposées directement (et peut les annuler tant qu'elles sont
  « validées »).
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

Statuts : `en_attente` (étudiant, à valider) / `attente_info` → `demandee` (validée, à commander) → `commandee` → `recue_partielle` / `recue_complete` → `remise`, plus `refusee` / `annulee`.
Le gestionnaire ne voit (et ne peut traiter) que les lignes déjà validées ; son compteur « Chez les encadrants » indique ce qui est en attente.

---

## Mise en route

### 0. Mise à jour « demande par les étudiants + validation par l'encadrant »

Si les tables existent déjà : relancer **`schema.sql`** (il ajoute les colonnes `etudiant_nom`, `etudiant_prenom`, `lot_id`, `encadrant_at`, `encadrant_commentaire`…) puis **redéployer l'Edge Function `commande-op`** (nouvelles actions `create-etu` et `enc-decide`). La fonction `projet-access` est déjà déployée (appli Impression 3D). Les demandes existantes restent « validées » (statut `demandee`).

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
| Étudiant (déposer / annuler / suivre) | **mot de passe du projet** (Carnet SAE) | Edge Function `projet-access` (suivi) et `commande-op` (dépôt, annulation) |
| Encadrant (déposer, valider, annuler) | **mot de passe du compte Carnet SAE** (sinon code personnel Atelier) | Edge Function `verify-code` puis re-vérifié par `commande-op` |
| Gestionnaire | **code opérateur** (table `operateurs`) | idem |
| Admin / Super admin | **mot de passe admin** / `super1234` | Edge Function `admin-op` (`login`) puis re-vérifié par `commande-op` |

La liste des encadrants proposée vient de la table `etudiants` (colonnes `encadrant1/2/3`), déjà utilisée
par l'appli Impression 3D. La liste des noms gestionnaires vient de `operateurs_public`, filtrée par
`com_gestionnaires` (choix du super admin).

---

## Notification WhatsApp au(x) gestionnaire(s) — à chaque nouvelle demande

À la **validation** d'une demande d'étudiant par l'encadrant (ou au dépôt direct d'un encadrant), l'Edge Function `commande-op` envoie un message WhatsApp (CallMeBot) aux
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
