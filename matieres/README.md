# Utilisation Matières — module Atelier GMP (4ᵉ appli du portail)

Appli web (fichier unique `index.html`) pour gérer les **demandes de matière brute** de l'atelier :
l'étudiant définit sa demande et voit une **estimation de prix**, l'encadrant la **valide**, puis elle
est **transmise au gestionnaire** dans un tableau de suivi (même principe que « Commandes d'éléments
standards »).

Même base Supabase et même charte que les autres applis du portail. **Liée depuis le portail** (carte « Utilisation de
  matières ») ; écritures sécurisées par l'Edge Function `matiere-op` (voir plus bas).

## Essayer tout de suite, sans rien installer côté Supabase

Ouvrir `matieres/index.html` avec le serveur local (voir plus bas) en ajoutant **`?demo=1`** :
`http://localhost:8765/matieres/?demo=1`

C'est un **mode démo** : catalogue et demandes fictifs, en mémoire, rien n'est lu ni écrit dans la vraie base
(tout est perdu au rechargement). Codes de la démo : encadrant / gestionnaire **1234**, admin **admin**,
super admin **super**.

## Les 5 écrans

1. **Nouvelle demande** (étudiant, sans code) — **identification par projet d'abord** : cartes de projets
   groupées par parcours (comme Carnet SAE), puis étudiant (liste du projet ou saisie libre). Le formulaire
   matière n'apparaît qu'une fois identifié. Ensuite : **matière puis famille** (Tôles / Barres / Profilés,
   filtrées selon l'organigramme de l'atelier — voir ci-dessous), forme, section (liste des bruts proposés
   **ou « Autre dimension »**), longueur (et largeur pour une tôle) du morceau — **une pièce par demande**
   (plusieurs pièces = plusieurs demandes). Chaque champ reste grisé tant que le précédent n'est pas choisi.
   Le **fournisseur n'est jamais demandé à l'étudiant** : déduit automatiquement de (matière, famille) et
   affiché à titre indicatif. L'estimation apparaît en direct :
   - **poids** = section × longueur × densité ;
   - **prix de la matière utilisée** = poids × prix au kilo **TTC** → **c'est ce montant qui est débité du
     budget** (le prix peut être saisi HT ou TTC par l'admin, voir plus bas) ;
   - **portion du brut utilisée** (barre colorée) et **prix de la matière perdue** (information seulement) ;
   - **barre de budget matière** du parcours ; **prochaine date de commande**.
2. **Suivi** (public) — demandes groupées par projet, statut, étapes horodatées, commentaires, aide sur les
   statuts. L'étudiant peut **annuler** tant que non validée.
3. **Espace encadrant** (nom + code personnel, vérifiés par `verify-code`) — voit les demandes **de ses projets**
   et coche : *Matière disponible et réservée à l'atelier* · *Matière à commander* (rattachée à la prochaine date
   de commande) · *Mettre en attente — manque d'information* (commentaire obligatoire) · *Refuser*.
4. **Espace gestionnaire** (opérateurs, code personnel) — ne voit que les demandes **validées**. Filtres : statut,
   origine, projet, matière, **forme**, **brut**. Vues : **Par date de commande** (avec la liste des bruts à
   commander pour chaque date, et un bouton **📋 Copier pour le devis** qui met dans le presse-papier un texte
   prêt à coller dans un e-mail, groupé par fournisseur), par statut, par matière, par projet. Actions :
   Commandée / Matière prête / Remise / Éditer (origine, date de commande, **coût final**, commentaire) ;
   export CSV et Excel. Liste des gestionnaires = table `mat_gestionnaires` (rôle **« Achat matières »**, à cocher
   dans l'administration globale → Personnes ; distinct du rôle « Achat éléments standards » des commandes de visserie),
   à défaut tous les opérateurs tant que personne n'est coché.
5. **Admin** (mot de passe admin, `admin-op`) — sept outils, chaque donnée porte sa **date de mise à jour**,
   chaque fenêtre a un bouton fermer (✕) en haut :
   🧱 **Matières & prix au kilo** (densité, prix **HT ou TTC au choix**, actif) · 🏭 **Fournisseurs & familles**
   (voir ci-dessous) · 🔷 **Formes** (nom + famille + type géométrique) ·
   📏 **Bruts proposés** (section + longueur standard par matière ; saisie en série : « 10 ; 12 ; 16 ») ·
   📅 **Dates de commande** · 💶 **Budgets matière** par parcours (distincts des composants standards) ·
   🔧 **Paramètres** (trait de scie, taux de TVA, format standard d'une tôle).

Statuts : `en_attente` → (`attente_info`) → `validee` (origine **stock** ou **commande**) → `commandee` →
`recue` (« matière prête ») → `remise`, plus `refusee` / `annulee`.

## Organigramme matière → fournisseur → famille → forme

Reproduit l'organigramme de l'atelier (`matiere SAE.pdf`) :

- **Matière → Fournisseur → Famille** : chaque matière est livrée par un ou plusieurs fournisseurs, chacun
  proposant certaines familles (table `mat_four_familles`, gérée dans Admin → Fournisseurs & familles). Ex. :
  Acier S235 → Letoile (Tôles, Barres, Profilés) ; Aluminium → Almet (Tôles, Profilés) + EMSO (Barres) ;
  Inox → Almet (Barres, Profilés) + EMSO (Tôles). **L'étudiant choisit matière puis famille ; le fournisseur
  est déduit automatiquement** (jamais une étape de choix — il n'y en a d'ailleurs jamais qu'un seul par
  combinaison dans l'organigramme fourni). Une matière sans association (ex. Laiton, « Autre → Ça dépend »)
  propose toutes les formes actives, sans fournisseur déduit : à confirmer par l'atelier.
- **Famille → Forme (Type) → Dimensions** : chaque forme (`mat_formes`) appartient à une famille et à un type
  géométrique. Formes préremplies : **Tôles** → Tôle (épaisseur) ; **Barres** → Ronde, Carré, Méplat ;
  **Profilés** → Tubes rond, Tubes carrés, Tubes rectangulaires, Cornière, Plat. Les types T/U/I (non présents
  dans l'organigramme fourni) restent disponibles dans le code et peuvent être ajoutés comme formes depuis
  Admin → Formes si besoin.

## Règles de calcul (à valider / ajuster)

- Formes gérées : tôle (plaque), pavé (plat), cylindre plein, carré plein, tube rond, tube carré simple ou
  rectangulaire, cornière L, profilé T, U, I/H. Les profilés sont calculés avec des sections **simplifiées**
  (sans rayons de congé) : pour un profilé commercial exact, renseigner la **masse linéique (kg/m)** du brut
  dans Admin → Bruts.
- **Barres/profilés** : le morceau est débité dans le **plus petit brut assez long** ; s'il n'y en a pas, on
  utilise le plus long et plusieurs barres. **Matière perdue** = traits de scie (`trait_scie` × une coupe) +
  reste du brut s'il est plus court que **100 mm** (seuil fixe, non réglable depuis l'admin — simplifié ; sinon
  le reste retourne en stock, réutilisable).
- **Tôles** : estimation **volontairement simplifiée** — la pièce (longueur × largeur) est découpée dans une
  plaque de format standard (réglable en Admin → Paramètres, 1000×2000 mm par défaut). La « portion utilisée »
  et la « matière perdue » sont calculées **par rapport à la surface** de la ou des plaque(s) nécessaires, sans
  plan de découpe (nesting) réel : si plusieurs étudiants demandent de petites pièces dans la même plaque, le
  calcul ne les regroupe pas.
- **Prix HT ou TTC** : l'admin saisit le prix au kilo d'une matière en choisissant HT ou TTC (Admin → Matières) ;
  le taux de TVA se règle dans Admin → Paramètres (20 % par défaut). Le prix est **toujours affiché et utilisé
  en TTC** pour l'étudiant, le budget et le gestionnaire, quel que soit le mode de saisie.
- Les **prix au kilo** ne sont pas préremplis (à saisir par l'admin) ; les densités le sont (acier 7,85 ; inox 7,90 ;
  alu 2,70 ; laiton 8,50).
- Une demande garde un **instantané** de l'estimation (prix TTC, densité, famille, fournisseur…) : changer un
  prix ou une association plus tard ne modifie pas les demandes existantes.

## Mise en route (vraie base) — 3 étapes, dans cet ordre

1. **Déployer l'Edge Function** — dashboard Supabase du projet `ggmlfbxppgeivfvlxxrj` → **Edge Functions** → **Deploy a new
   function** → nom exact **`matiere-op`** → coller tout `supabase/functions/matiere-op/index.ts` → **Deploy**.
   (Les secrets `SUPERADMIN_PW_HASH` / `ADMIN_PW_HASH` sont déjà en place, partagés avec les autres applis.)
2. **Créer les tables** — **SQL Editor** → nouvelle requête → coller tout `schema.sql` → **Run**. Crée 10 tables
   (`mat_matieres`, `mat_fournisseurs`, `mat_familles`, `mat_formes`, `mat_four_familles`, `mat_bruts`, `mat_dates`,
   `mat_budgets`, `mat_parametres`, `mat_demandes`), pré-remplit matières (sans prix), fournisseurs/familles/associations et
   formes (selon l'organigramme fourni) et paramètres, et ne laisse à la clé publique que la **lecture**. N'altère aucune table
   existante ; relançable sans risque. *(Si une version test des tables existe déjà : lancer plutôt `secure.sql`.)*
3. **Remplir le catalogue** — se connecter en Admin (`admin1234` par défaut) et renseigner les prix au kilo, les bruts
   proposés, les dates de commande et les budgets. Fournisseurs, familles et associations sont déjà pré-remplis.

Test local : `python -m http.server 8765` à la racine du dépôt → <http://localhost:8765/matieres/> (config
`.claude/launch.json` « reservation-machines »). Sans base, **`?demo=1`** ouvre le mode démo (données fictives).

## Sécurité (`matiere-op`)

Toutes les écritures passent par l'Edge Function (clé service) ; la clé publique ne peut que lire. Droits vérifiés **côté serveur** :

| Écriture | Qui |
|---|---|
| Catalogue (matières, formes, bruts, fournisseurs, familles, associations, dates, budgets, paramètres) | mot de passe **admin** |
| Dépôt d'une demande | étudiant identifié par le **mot de passe de son projet** (voir ci-dessous) — colonnes filtrées, statut forcé « en attente », n° de demande recalculé |
| Décision sur une demande | **encadrant du projet** (nom + code personnel) ; impossible une fois commandée/remise |
| Suivi (commandée, prête, remise, coût final…) | **opérateur** (nom + code personnel) |
| Annulation | l'étudiant (mot de passe du projet), tant que la demande n'est pas validée |
| Vidage de tables (Admin globale → Maintenance) | mot de passe **super admin** |

Limite connue : le **prix et le poids estimés** sont calculés dans le navigateur de l'étudiant et envoyés tels quels (comme pour
les autres applis) ; l'encadrant et le gestionnaire les voient et le gestionnaire peut corriger le « coût final ».

## Identification par le mot de passe de projet (Carnet SAE)

L'étudiant s'identifie en cliquant sur son projet, puis saisit le **mot de passe du projet** : c'est celui que Carnet SAE GMP
utilise déjà pour consulter les notes (défini par l'encadrant là-bas). Il est exigé pour **déposer** une demande, **l'annuler** et
**ouvrir le Suivi** (qui n'affiche plus que les demandes d'un seul projet). Il est vérifié par la fonction `projet-access`
(dossier `usinage/supabase/functions/`), qui interroge Carnet SAE ; `matiere-op` le revérifie à chaque dépôt/annulation.

- Projet **inconnu de Carnet SAE** ou **sans mot de passe défini** là-bas (dont « Autre projet… ») : accès libre, comme avant.
- Carnet SAE injoignable : accès refusé (message « Carnet SAE injoignable »), pour ne pas ouvrir la porte par défaut.
- Le mot de passe saisi est gardé le temps de l'onglet (sessionStorage), jamais stocké côté Atelier.
- **Limite** : le mot de passe protège l'*interface* du Suivi, pas l'API : les demandes restent lisibles avec la clé publique (comme
  toutes les applis Atelier). Il n'y a pas de limite de tentatives côté Carnet SAE (la fonction ajoute seulement 0,6 s par échec).
- Dépendance au message d'erreur de Carnet SAE (« Aucun mot de passe défini… », `pb_hooks/etu-access.pb.js`) pour reconnaître un
  projet sans mot de passe ; s'il change, adapter `NO_PW` dans `projet-access`, `demande-op` et `matiere-op`.

**Ordre de déploiement** : `projet-access` (nouvelle) d'abord, puis `demande-op` et `matiere-op` (à redéployer), puis seulement la
mise en ligne du site — sinon l'identification par projet échoue (« Carnet SAE injoignable ») tant que `projet-access` n'existe pas.
En démo (`?demo=1`) : le projet « Porte A380 » est protégé, mot de passe `secret`.

## Fichiers

`index.html` (appli) · `schema.sql` · `secure.sql` · `supabase/functions/matiere-op/index.ts` · `demo.js` (mode démo `?demo=1`, chargé seulement à la demande) · `logo-gmp.png` · `README.md`
