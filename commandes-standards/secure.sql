-- =====================================================================
--  Passage en VERSION PUBLIQUE — verrouillage des écritures
--  À coller UNE FOIS dans le SQL Editor de Supabase (projet ggmlfbxppgeivfvlxxrj),
--  APRÈS avoir déployé l'Edge Function « commande-op ».
--
--  Effet : le public garde la LECTURE des 4 tables du module ; toutes les
--  ÉCRITURES ne passent plus que par l'Edge Function commande-op (clé service,
--  qui contourne la RLS). Les autres applis (usinage / impression 3D) ne sont
--  pas touchées.
-- =====================================================================

-- Supprime les policies permissives « écriture ouverte à tous » de la phase test…
drop policy if exists commandes_all         on public.commandes;
drop policy if exists com_fournisseurs_all  on public.com_fournisseurs;
drop policy if exists com_budgets_all       on public.com_budgets;
drop policy if exists com_gestionnaires_all on public.com_gestionnaires;

-- … et ne garde qu'une lecture (SELECT) pour la clé anon.
drop policy if exists commandes_sel         on public.commandes;
create policy commandes_sel         on public.commandes         for select using (true);

drop policy if exists com_fournisseurs_sel  on public.com_fournisseurs;
create policy com_fournisseurs_sel  on public.com_fournisseurs  for select using (true);

drop policy if exists com_budgets_sel       on public.com_budgets;
create policy com_budgets_sel       on public.com_budgets       for select using (true);

drop policy if exists com_gestionnaires_sel on public.com_gestionnaires;
create policy com_gestionnaires_sel on public.com_gestionnaires for select using (true);

-- (RLS déjà activée par schema.sql ; aucune policy INSERT/UPDATE/DELETE = refus total pour anon.)

-- Vérification :
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and tablename like 'com%' or tablename='commandes';
