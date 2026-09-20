-- ─────────────────────────────────────────────────────────────────────────
--  Gestion des encadrants — un code d'écriture PROPRE à chaque encadrant
--  (remplace le "code_encadrant" unique commun à tous, jusque-là dans parametres).
--
--  Modèle inspiré de l'appli évaluation SAE (table sae_encadrants) :
--    • un code par encadrant (haché en SHA-256, jamais stocké en clair) ;
--    • l'encadrant choisit lui-même son code à sa 1re connexion ;
--    • l'admin peut seulement RÉINITIALISER un code (il ne le voit jamais).
--
--  À exécuter une fois dans Supabase → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.encadrant_codes (
  nom        text primary key,          -- nom de l'encadrant (identique à etudiants.encadrant1/2/3)
  code_hash  text,                       -- SHA-256 hex du code à 4 chiffres ; NULL = pas encore défini
  updated_at timestamptz default now()
);

-- Accès réservé aux Edge Functions (clé de service, qui contourne la RLS).
-- Aucune policy publique : ni la clé anon, ni un visiteur ne peuvent lire les empreintes.
alter table public.encadrant_codes enable row level security;

-- Le code commun devient inutile après migration. On le conserve d'abord (au cas où),
-- puis vous pourrez le supprimer une fois que tous les encadrants ont défini leur code :
--   delete from public.parametres where cle = 'code_encadrant';
