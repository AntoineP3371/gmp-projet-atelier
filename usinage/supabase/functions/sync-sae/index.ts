// Edge Function : sync-sae
// Synchronise la liste ÉTUDIANTS/PROJETS depuis « Carnet SAE GMP » (PocketBase) vers Supabase.
// Source via la route PROTÉGÉE `GET /etu/sync` (en-tête X-Sync-Secret, server-to-server).
//   → table `etudiants` : une ligne par étudiant, source='sae' (les lignes 'manuel' sont préservées).
// (La vérification du mot de passe projet à la réservation passe par la fonction `projet-access`.)
//
// Robustesse : si SAE est injoignable ou ne renvoie aucun projet, on NE supprime rien (dernière copie).
// Aucune donnée sensible (ni notes, ni évaluations) : seulement identité/projet/formation/parcours/année.
//
// Déclenchement : { adminCode } (mot de passe super admin) ou { secret } (= env SYNC_SAE_SECRET, cron).
// Secret SORTANT vers SAE : env SAE_SYNC_SECRET (jamais en clair dans le code / un log).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
const SAE_SYNC_URL = 'https://api_evalprojet.gmpbordeaux.fr/etu/sync'

// « NOM Prénom » → { nom, prenom }. Le NOM est en MAJUSCULES (éventuellement composé : BEN HENNI),
// le prénom suit. On coupe au premier mot qui n'est pas entièrement en majuscules.
function splitName(full: string): { nom: string; prenom: string } {
  const parts = (full ?? '').toString().trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { nom: '', prenom: '' }
  const isUpper = (t: string) => t === t.toLocaleUpperCase('fr') && t !== t.toLocaleLowerCase('fr')
  let i = 0
  while (i < parts.length - 1 && isUpper(parts[i])) i++
  if (i === 0) i = 1
  return { nom: parts.slice(0, i).join(' '), prenom: parts.slice(i).join(' ') }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── Autorisation d'appel (entrant) : secret de cron OU mot de passe super admin ──
    const cronSecret = (Deno.env.get('SYNC_SAE_SECRET') || '').trim()
    let authorized = !!cronSecret && (body.secret ?? '').toString() === cronSecret
    if (!authorized && body.adminCode != null) {
      const h = await sha256hex((body.adminCode ?? '').toString())
      const { data: spw } = await sb.from('parametres').select('valeur').eq('cle', 'superadmin_pw_hash').maybeSingle()
      const superExpected = ((spw?.valeur) || Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
      authorized = !!superExpected && h === superExpected
    }
    if (!authorized) return json({ ok: false, error: 'unauthorized' }, 401)

    // ── Récupération depuis SAE (route protégée) ──
    const saeSecret = (Deno.env.get('SAE_SYNC_SECRET') || '').trim()
    if (!saeSecret) return json({ ok: false, error: 'SAE_SYNC_SECRET manquant côté Supabase' }, 500)
    const res = await fetch(SAE_SYNC_URL, { headers: { 'Accept': 'application/json', 'X-Sync-Secret': saeSecret } })
    if (res.status === 403) return json({ ok: false, error: 'SAE a refusé le secret (403) — vérifier SAE_SYNC_SECRET' }, 502)
    if (!res.ok) return json({ ok: false, error: 'SAE /etu/sync HTTP ' + res.status + ' (rien effacé)' }, 502)
    const data = await res.json()
    const projects: any[] = Array.isArray(data.projects) ? data.projects : []

    // Sécurité : ne rien écraser si aucune donnée reçue (anomalie probable).
    if (!projects.length) return json({ ok: false, error: 'aucun projet reçu de SAE (rien effacé)' }, 502)

    // ── Transformation : une ligne par étudiant ──
    const rows: any[] = []
    for (const p of projects) {
      const projet = (p.nom ?? '').toString().trim()
      const formation = (p.formation ?? '').toString().trim()
      const parcours = (p.parcours ?? '').toString().trim()
      const annee = (p.annee ?? '').toString().trim()
      const encs = Array.isArray(p.encadrants) ? p.encadrants.map((e: any) => (e ?? '').toString().trim()).filter(Boolean) : []
      const [e1, e2, e3] = [encs[0] || '', encs[1] || '', encs[2] || '']   // 3 emplacements max
      for (const e of (Array.isArray(p.etudiants) ? p.etudiants : [])) {
        const { nom, prenom } = splitName((e ?? '').toString())
        if (!nom && !prenom) continue
        rows.push({ nom, prenom, projet, formation, parcours, annee, encadrant1: e1, encadrant2: e2, encadrant3: e3, source: 'sae' })
      }
    }

    // ── Étudiants : remplacement des seules lignes 'sae' (les 'manuel' sont préservées) ──
    const del = await sb.from('etudiants').delete().eq('source', 'sae')
    if (del.error) throw del.error
    if (rows.length) { const ins = await sb.from('etudiants').insert(rows); if (ins.error) throw ins.error }

    // Anti-doublon : SAE prioritaire → retirer les fiches MANUELLES qui correspondent à un étudiant SAE.
    const saeIds = new Set(rows.map((r: any) => norm(r.nom) + '|' + norm(r.prenom)))
    const { data: man } = await sb.from('etudiants').select('id, nom, prenom').eq('source', 'manuel')
    const dupIds = (man || []).filter((m: any) => saeIds.has(norm(m.nom) + '|' + norm(m.prenom))).map((m: any) => m.id).filter((x: any) => x != null)
    if (dupIds.length) { const dd = await sb.from('etudiants').delete().in('id', dupIds); if (dd.error) throw dd.error }

    await sb.from('parametres').upsert([{ cle: 'sae_sync_at', valeur: new Date().toISOString() }])
    return json({ ok: true, projets: projects.length, etudiants: rows.length, doublonsManuelsRetires: dupIds.length, at: new Date().toISOString() })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
