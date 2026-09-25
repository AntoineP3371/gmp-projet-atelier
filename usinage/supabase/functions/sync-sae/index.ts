// Edge Function : sync-sae
// Synchronise la liste ÉTUDIANTS/PROJETS depuis « Carnet SAE GMP » (PocketBase) vers la table
// `etudiants` de Supabase. Source unique des projets ; les lignes saisies à la main dans Atelier GMP
// (source='manuel') sont conservées comme secours et ne sont jamais touchées ici.
//
// Robustesse : si PocketBase est injoignable, on NE supprime rien (la dernière copie reste en place).
//
// Déclenchement :
//   - manuel (bouton admin)  : { adminCode } = mot de passe SUPER admin
//   - planifié (cron pg_cron): { secret }    = variable d'env SYNC_SAE_SECRET
//
// Aucune donnée sensible n'est stockée (ni notes, ni évaluations) : seulement nom/prénom/projet/
// formation/parcours/année/encadrants.
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

// Base PocketBase (lecture publique) : projets non archivés et visibles élèves.
const PB_URL = 'https://api_evalprojet.gmpbordeaux.fr/api/collections/sae_projects/records'
    + '?filter=' + encodeURIComponent('archived=false && visible_eleves=true')

// « NOM Prénom » → { nom, prenom }. Le NOM est en MAJUSCULES (éventuellement composé : BEN HENNI),
// le prénom suit. On coupe au premier mot qui n'est pas entièrement en majuscules.
function splitName(full: string): { nom: string; prenom: string } {
  const parts = (full ?? '').toString().trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { nom: '', prenom: '' }
  const isUpper = (t: string) => t === t.toLocaleUpperCase('fr') && t !== t.toLocaleLowerCase('fr')
  let i = 0
  while (i < parts.length - 1 && isUpper(parts[i])) i++
  // Au moins un mot pour le nom ; le reste = prénom.
  if (i === 0) i = 1
  return { nom: parts.slice(0, i).join(' '), prenom: parts.slice(i).join(' ') }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── Autorisation : secret de cron OU mot de passe super admin ──
    const cronSecret = (Deno.env.get('SYNC_SAE_SECRET') || '').trim()
    let authorized = !!cronSecret && (body.secret ?? '').toString() === cronSecret
    if (!authorized && body.adminCode != null) {
      const h = await sha256hex((body.adminCode ?? '').toString())
      const { data: spw } = await sb.from('parametres').select('valeur').eq('cle', 'superadmin_pw_hash').maybeSingle()
      const superExpected = ((spw?.valeur) || Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
      authorized = !!superExpected && h === superExpected
    }
    if (!authorized) return json({ ok: false, error: 'unauthorized' }, 401)

    // ── Récupération PocketBase (paginée) ──
    const items: any[] = []
    let page = 1, totalPages = 1
    do {
      const url = PB_URL + `&perPage=200&page=${page}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error('PocketBase HTTP ' + res.status)
      const data = await res.json()
      for (const it of (data.items || [])) items.push(it)
      totalPages = Number(data.totalPages) || 1
      page++
    } while (page <= totalPages && page <= 50)

    // ── Transformation : une ligne par étudiant ──
    const rows: any[] = []
    for (const p of items) {
      const projet = (p.nom ?? '').toString().trim()
      const formation = (p.formation ?? '').toString().trim()
      const parcours = (p.parcours ?? '').toString().trim()
      const annee = (p.annee ?? '').toString().trim()
      const encs = Array.isArray(p.encadrants) ? p.encadrants.map((e: any) => (e ?? '').toString().trim()).filter(Boolean) : []
      const [e1, e2, e3] = [encs[0] || '', encs[1] || '', encs[2] || '']   // 3 emplacements max
      const etus = Array.isArray(p.etudiants) ? p.etudiants : []
      for (const e of etus) {
        const { nom, prenom } = splitName((e ?? '').toString())
        if (!nom && !prenom) continue
        rows.push({
          nom, prenom, projet, formation, parcours, annee,
          encadrant1: e1, encadrant2: e2, encadrant3: e3, source: 'sae',
        })
      }
    }

    // Sécurité : ne pas écraser la liste si PocketBase n'a renvoyé aucun projet (anomalie probable).
    if (!items.length) return json({ ok: false, error: 'aucun projet reçu de PocketBase (rien effacé)' }, 502)

    // ── Remplacement des seules lignes 'sae' (les 'manuel' sont préservées) ──
    const del = await sb.from('etudiants').delete().eq('source', 'sae')
    if (del.error) throw del.error
    if (rows.length) {
      const ins = await sb.from('etudiants').insert(rows)
      if (ins.error) throw ins.error
    }

    // Horodatage de la dernière synchro (pour l'affichage admin).
    await sb.from('parametres').upsert([{ cle: 'sae_sync_at', valeur: new Date().toISOString() }])

    return json({ ok: true, projets: items.length, etudiants: rows.length, at: new Date().toISOString() })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
