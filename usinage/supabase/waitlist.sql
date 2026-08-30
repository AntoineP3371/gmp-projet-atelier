-- =====================================================================
--  Usinage — liste d'attente sur créneau occupé (à coller dans le SQL Editor Supabase)
--
--  Un étudiant qui clique un créneau déjà réservé peut laisser son e-mail pour être prévenu
--  s'il se libère. UNE seule personne en attente par créneau (clé primaire machine/date/slot).
--  Table VERROUILLÉE (RLS, aucune policy) : l'adresse n'est jamais lisible par le navigateur,
--  seulement par l'Edge Function booking-op (waitlist-add pour écrire, cancel pour notifier+purger).
-- =====================================================================
create table if not exists public.waitlist (
  machine    text not null,
  date       text not null,
  slot       text not null,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (machine, date, slot)
);
alter table public.waitlist enable row level security;
-- (aucune policy volontairement : refus total pour anon)
