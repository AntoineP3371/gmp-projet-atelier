-- =====================================================================
--  Notification WhatsApp au(x) gestionnaire(s) à chaque nouvelle demande d'achat
--  À coller UNE FOIS dans le SQL Editor de Supabase (projet ggmlfbxppgeivfvlxxrj).
--
--  Ajoute une colonne d'abonnement sur la table 'operateurs' (verrouillée) et
--  l'expose dans la vue publique 'operateurs_public' (booléen non sensible,
--  comme 'notif_3d'). L'envoi se fait dans l'Edge Function commande-op (CallMeBot),
--  aux opérateurs qui ont notif_achats = true ET un numéro + une clé API renseignés.
-- =====================================================================

alter table public.operateurs
  add column if not exists notif_achats boolean not null default false;

-- Recréation de la vue publique AVEC la nouvelle colonne (mêmes colonnes qu'avant + notif_achats).
-- ⚠️ Ne jamais exposer phone / apikey / code : 'has_whatsapp' reste un booléen calculé.
create or replace view public.operateurs_public as
select name,
       notif_3d,
       coalesce(phone, '') <> '' and coalesce(apikey, '') <> '' as has_whatsapp,
       machines_outils,
       impression_3d,
       notif_achats
from public.operateurs;

grant select on public.operateurs_public to anon, authenticated;
