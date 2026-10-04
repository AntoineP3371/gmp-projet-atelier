-- =====================================================================
--  Utilisation Matières — verrouillage des écritures (base DÉJÀ créée en phase test)
--  À coller UNE FOIS dans le SQL Editor, APRÈS avoir déployé l'Edge Function « matiere-op ».
--  (Pour une installation neuve, schema.sql contient déjà ces policies : inutile de lancer ce fichier.)
-- =====================================================================

drop policy if exists mat_matieres_all on public.mat_matieres;
drop policy if exists mat_matieres_sel on public.mat_matieres;
create policy mat_matieres_sel on public.mat_matieres for select using (true);
drop policy if exists mat_fournisseurs_all on public.mat_fournisseurs;
drop policy if exists mat_fournisseurs_sel on public.mat_fournisseurs;
create policy mat_fournisseurs_sel on public.mat_fournisseurs for select using (true);
drop policy if exists mat_familles_all on public.mat_familles;
drop policy if exists mat_familles_sel on public.mat_familles;
create policy mat_familles_sel on public.mat_familles for select using (true);
drop policy if exists mat_formes_all on public.mat_formes;
drop policy if exists mat_formes_sel on public.mat_formes;
create policy mat_formes_sel on public.mat_formes for select using (true);
drop policy if exists mat_four_familles_all on public.mat_four_familles;
drop policy if exists mat_four_familles_sel on public.mat_four_familles;
create policy mat_four_familles_sel on public.mat_four_familles for select using (true);
drop policy if exists mat_bruts_all on public.mat_bruts;
drop policy if exists mat_bruts_sel on public.mat_bruts;
create policy mat_bruts_sel on public.mat_bruts for select using (true);
drop policy if exists mat_dates_all on public.mat_dates;
drop policy if exists mat_dates_sel on public.mat_dates;
create policy mat_dates_sel on public.mat_dates for select using (true);
drop policy if exists mat_budgets_all on public.mat_budgets;
drop policy if exists mat_budgets_sel on public.mat_budgets;
create policy mat_budgets_sel on public.mat_budgets for select using (true);
drop policy if exists mat_parametres_all on public.mat_parametres;
drop policy if exists mat_parametres_sel on public.mat_parametres;
create policy mat_parametres_sel on public.mat_parametres for select using (true);
drop policy if exists mat_demandes_all on public.mat_demandes;
drop policy if exists mat_demandes_sel on public.mat_demandes;
create policy mat_demandes_sel on public.mat_demandes for select using (true);

-- Gestionnaires des achats matière (rôle « Achat matières »)
alter table public.mat_gestionnaires enable row level security;
drop policy if exists mat_gestionnaires_all on public.mat_gestionnaires;
drop policy if exists mat_gestionnaires_sel on public.mat_gestionnaires;
create policy mat_gestionnaires_sel on public.mat_gestionnaires for select using (true);

-- Vérification :
--   select tablename, policyname, cmd from pg_policies where tablename like 'mat_%';
