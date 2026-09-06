-- Catégorie de machine (texte libre) : sert à filtrer le planning via des boutons
-- affichés juste au-dessus de la grille. '' = la machine ne relève d'aucune catégorie.
-- À exécuter dans l'éditeur SQL Supabase AVANT de déployer la fonction admin-op mise à jour.

alter table public.machines
  add column if not exists category text not null default '';

-- Les machines existantes restent sans catégorie (chaîne vide).
update public.machines set category = '' where category is null;
