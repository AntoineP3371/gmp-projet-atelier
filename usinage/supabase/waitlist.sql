-- =====================================================================
--  Usinage — liste d'attente sur créneau occupé (à coller dans le SQL Editor Supabase)
--
--  Un étudiant qui clique un créneau déjà réservé peut laisser son e-mail pour être prévenu
--  s'il se libère. Jusqu'à 3 personnes en attente par créneau (clé primaire machine/date/slot/email
--  => plusieurs e-mails possibles, mais jamais deux fois le même ; le plafond de 3 est vérifié
--  côté serveur dans booking-op). À la libération, TOUTES sont notifiées puis les entrées purgées.
--  Table VERROUILLÉE (RLS, aucune policy) : l'adresse n'est jamais lisible par le navigateur,
--  seulement par l'Edge Function booking-op (waitlist-add pour écrire, cancel pour notifier+purger).
-- =====================================================================
create table if not exists public.waitlist (
  machine    text not null,
  date       text not null,
  slot       text not null,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (machine, date, slot, email)
);
alter table public.waitlist enable row level security;
-- (aucune policy volontairement : refus total pour anon)

-- ---- MIGRATION si la table existait déjà avec l'ancienne clé (machine,date,slot) ----
-- (à lancer une fois ; sans effet si la clé est déjà la bonne)
do $$
begin
  begin alter table public.waitlist drop constraint waitlist_pkey; exception when others then null; end;
  begin alter table public.waitlist add primary key (machine, date, slot, email); exception when others then null; end;
end $$;
