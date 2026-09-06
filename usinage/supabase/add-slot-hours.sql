-- Taille de créneau réservable par machine : 1 h, 2 h ou 4 h (4 h = valeur par défaut,
-- soit le découpage historique 08h-12h / 14h-18h).
-- À exécuter dans l'éditeur SQL Supabase AVANT de déployer la nouvelle version de l'appli.

alter table public.machines
  add column if not exists slot_hours smallint not null default 4;

alter table public.machines
  drop constraint if exists machines_slot_hours_chk;

alter table public.machines
  add constraint machines_slot_hours_chk check (slot_hours in (1, 2, 4));

-- Les machines existantes restent en 4 h (aucune réservation impactée).
update public.machines set slot_hours = 4 where slot_hours is null;
