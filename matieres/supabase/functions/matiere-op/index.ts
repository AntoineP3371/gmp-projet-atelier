// Edge Function : matiere-op
// Écritures du module « Utilisation Matières », vérifiées CÔTÉ SERVEUR (le navigateur n'a plus
// que la lecture sur les tables mat_*, voir secure.sql). Même projet Supabase que les autres applis.
//
// Une seule action générique { action:'db', table, op, rows|patch, eq, creds } + { action:'wipe' } :
//   • tables du catalogue (matières, formes, bruts, fournisseurs, familles, associations, dates,
//     budgets, paramètres, gestionnaires) : mot de passe ADMIN (creds.adminPw) ;
//   • mat_demandes — insert : étudiant identifié par le MOT DE PASSE DE PROJET de Carnet SAE (creds.projetPw ;
//     projet inconnu ou sans mot de passe là-bas = ouvert), colonnes filtrées, statut forcé « en_attente », n° recalculé ;
//   • mat_demandes — update : opérateur (creds.opName/opCode) pour le suivi, encadrant du projet
//     (creds.encNom/encCode) pour la décision, ou annulation par l'étudiant tant que non validée ;
//   • wipe : mot de passe SUPER admin.
//
// Déploiement : dashboard Supabase → Edge Functions → Deploy a new function « matiere-op »,
// coller ce fichier. (Secrets déjà en place : SUPERADMIN_PW_HASH, ADMIN_PW_HASH.)
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

const CATALOGUE = [
  'mat_matieres', 'mat_fournisseurs', 'mat_familles', 'mat_formes', 'mat_four_familles',
  'mat_bruts', 'mat_dates', 'mat_budgets', 'mat_parametres', 'mat_gestionnaires',
]
const WIPE_PK: Record<string, string> = {
  mat_demandes: 'id', mat_bruts: 'id', mat_dates: 'id', mat_budgets: 'parcours',
  mat_matieres: 'nom', mat_fournisseurs: 'nom', mat_familles: 'nom', mat_formes: 'nom',
  mat_four_familles: 'id', mat_parametres: 'cle', mat_gestionnaires: 'nom',
}
const DEM_INSERT_COLS = [
  'projet', 'parcours', 'formation', 'etudiant_nom', 'etudiant_prenom', 'matiere', 'famille', 'fournisseur',
  'forme', 'forme_type', 'dims', 'dims_libelle', 'longueur', 'largeur', 'quantite', 'hors_catalogue', 'notes',
  'densite', 'prix_kg', 'masse_lin', 'poids_kg', 'cout_matiere', 'brut_desc', 'brut_longueur', 'brut_qte',
  'part_brut', 'perdu_mm', 'cout_perte', 'reste_mm',
]
const ENC_KEYS = [
  'encadrant_nom', 'encadrant_at', 'encadrant_commentaire', 'encadrant_commentaire_at',
  'statut', 'statut_at', 'decision', 'date_commande', 'historique',
]
const GEST_KEYS = [
  'statut', 'statut_at', 'gest_nom', 'gest_commentaire', 'historique', 'commandee_at', 'recue_at', 'remise_at',
  'decision', 'date_commande', 'cout_matiere',
]
const GEST_STATUTS = ['validee', 'commandee', 'recue', 'remise', 'refusee', 'annulee']
const ENC_STATUTS = ['validee', 'attente_info', 'refusee']
const ENC_LOCKED = ['commandee', 'recue', 'remise', 'annulee']

// Mot de passe de PROJET de Carnet SAE GMP (voir la fonction projet-access) : exigé pour déposer ou annuler
// une demande. Projet inconnu de Carnet SAE ou sans mot de passe défini là-bas = ouvert.
const SAE_URL = 'https://api_evalprojet.gmpbordeaux.fr'
const SAE_NO_PW = /aucun mot de passe/i
const normTxt = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
async function accesProjet(projet: string, pw: string): Promise<'open' | 'ok' | 'bad' | 'down'> {
  try {
    const rl = await fetch(SAE_URL + '/etu/list', { headers: { Accept: 'application/json' } })
    if (!rl.ok) return 'down'
    const list = await rl.json()
    const p = (Array.isArray(list) ? list : []).find((x: any) => normTxt(x.nom) === normTxt(projet))
    if (!p) return 'open'
    const ru = await fetch(SAE_URL + '/etu/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: p.token, password: pw || '-' }),
    })
    if (ru.ok) { try { await ru.body?.cancel() } catch (_) { /* on ne lit pas les notes */ } return pw ? 'ok' : 'bad' }
    const j = await ru.json().catch(() => ({}))
    if (ru.status === 403) return SAE_NO_PW.test(String(j.error ?? '')) ? 'open' : 'bad'
    if (ru.status === 404) return 'open'
    return 'down'
  } catch (_) { return 'down' }
}
// Réponse d'erreur si l'accès au projet est refusé (HTTP 200 + ok:false : le client lit le code), sinon null.
async function refusProjet(projet: string, pw: unknown): Promise<Response | null> {
  const a = await accesProjet(projet, String(pw ?? ''))
  if (a === 'bad') return json({ ok: false, error: 'projet-pw' })
  if (a === 'down') return json({ ok: false, error: 'sae-down' })
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const b = await req.json()
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const c = b.creds || {}

    // Code PERSONNEL unique (table encadrant_codes, haché) — partagé entre rôles opérateur et encadrant.
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
    const codeOk = async (nom?: string, code?: string) => {
      const key = norm(nom); const cd = (code ?? '').toString().trim()
      if (!key || !cd) return false
      const { data } = await sb.from('encadrant_codes').select('code_hash').eq('nom', key).maybeSingle()
      const h = (data?.code_hash ?? '').toString().trim()
      return !!h && h === await sha256hex(cd)
    }
    const opOk = async (name?: string, code?: string) => {
      const key = norm(name)
      const { data: ops } = await sb.from('operateurs').select('name')
      if (!(ops || []).some((r: any) => norm(r.name) === key)) return false
      return codeOk(name, code)
    }
    const adminInfo = async (pw?: string) => {
      const h = await sha256hex((pw ?? '').toString())
      const { data: spw } = await sb.from('parametres').select('valeur').eq('cle', 'superadmin_pw_hash').maybeSingle()
      const superExpected = ((spw?.valeur) || Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
      const isSuper = !!superExpected && h === superExpected
      const { data: apw } = await sb.from('parametres').select('valeur').eq('cle', 'admin_pw_hash').maybeSingle()
      const expected = ((apw?.valeur) || Deno.env.get('ADMIN_PW_HASH') || '').trim()
      return { isAdmin: isSuper || (!!expected && h === expected), isSuper }
    }

    // ───────────── vidage de tables (super admin) ─────────────
    if (b.action === 'wipe') {
      if (!(await adminInfo(c.adminPw ?? b.adminPw)).isSuper) return json({ ok: false, error: 'auth' }, 401)
      const tables: string[] = Array.isArray(b.tables) ? b.tables : (b.table ? [b.table] : [])
      if (!tables.length) return json({ ok: false, error: 'no-table' }, 400)
      for (const t of tables) {
        const pk = WIPE_PK[t]
        if (!pk) return json({ ok: false, error: 'bad-table' }, 400)
        const { error } = await sb.from(t).delete().not(pk, 'is', null)
        if (error) throw error
      }
      return json({ ok: true })
    }

    if (b.action !== 'db') return json({ ok: false, error: 'bad action' }, 400)
    const table = String(b.table ?? ''), op = String(b.op ?? '')
    const eq: Record<string, unknown> = (b.eq && typeof b.eq === 'object') ? b.eq : {}
    const eqKeys = Object.keys(eq)
    const rows: any[] = Array.isArray(b.rows) ? b.rows : []
    const patch: Record<string, any> = (b.patch && typeof b.patch === 'object') ? b.patch : {}

    // ───────────── catalogue : admin ─────────────
    if (CATALOGUE.includes(table)) {
      if (!(await adminInfo(c.adminPw)).isAdmin) return json({ ok: false, error: 'auth' }, 401)
      let q: any
      if (op === 'insert' || op === 'upsert') {
        if (!rows.length || rows.length > 500) return json({ ok: false, error: 'bad-input' }, 400)
        q = op === 'insert' ? sb.from(table).insert(rows) : sb.from(table).upsert(rows)
      } else if (op === 'update' || op === 'delete') {
        if (!eqKeys.length) return json({ ok: false, error: 'bad-input' }, 400)
        q = op === 'update' ? sb.from(table).update(patch) : sb.from(table).delete()
        for (const k of eqKeys) q = q.eq(k, eq[k])
      } else return json({ ok: false, error: 'bad-op' }, 400)
      const { error } = await q
      if (error) throw error
      return json({ ok: true })
    }

    if (table !== 'mat_demandes') return json({ ok: false, error: 'bad-table' }, 400)

    // ───────────── dépôt d'une demande (public) ─────────────
    if (op === 'insert') {
      if (!rows.length || rows.length > 20) return json({ ok: false, error: 'bad-input' }, 400)
      const now = new Date().toISOString()
      const clean: any[] = []
      for (const proj of new Set(rows.map((r) => String(r?.projet ?? '').trim()).filter(Boolean))) {
        const refus = await refusProjet(proj, c.projetPw)
        if (refus) return refus
      }
      for (const r of rows) {
        const o: any = {}
        for (const k of DEM_INSERT_COLS) if (r && k in r) o[k] = r[k]
        if (!String(o.projet ?? '').trim() || !String(o.matiere ?? '').trim()) return json({ ok: false, error: 'bad-input' }, 400)
        o.quantite = 1
        o.statut = 'en_attente'
        o.statut_at = now
        o.historique = [{ t: now, statut: 'en_attente', par: `${o.etudiant_prenom ?? ''} ${o.etudiant_nom ?? ''}`.trim() }]
        clean.push(o)
      }
      // N° incrémental par projet, calculé côté serveur.
      const { data: all } = await sb.from('mat_demandes').select('numero, projet')
      const base: Record<string, number> = {}
      for (const r of (all || []) as any[]) {
        const k = String(r.projet ?? '').toLowerCase()
        base[k] = Math.max(base[k] || 0, Number(r.numero) || 0)
      }
      for (const o of clean) {
        const k = String(o.projet).toLowerCase()
        base[k] = (base[k] || 0) + 1
        o.numero = base[k]
      }
      const { error } = await sb.from('mat_demandes').insert(clean)
      if (error) throw error
      return json({ ok: true, count: clean.length })
    }

    // ───────────── mise à jour d'une demande ─────────────
    if (op === 'update') {
      if (eqKeys.length !== 1 || eqKeys[0] !== 'id') return json({ ok: false, error: 'bad-input' }, 400)
      const { data: cur } = await sb.from('mat_demandes').select('*').eq('id', eq.id).maybeSingle()
      if (!cur) return json({ ok: false, error: 'not-found' }, 404)
      const keys = Object.keys(patch)
      const only = (allowed: string[]) => keys.length > 0 && keys.every((k) => allowed.includes(k))
      let allowed = false

      if (c.opName && c.opCode && only(GEST_KEYS) && await opOk(c.opName, c.opCode)) {
        if (patch.statut && !GEST_STATUTS.includes(patch.statut)) return json({ ok: false, error: 'bad-statut' }, 400)
        allowed = true
      } else if (c.encNom && c.encCode && only(ENC_KEYS) && await codeOk(c.encNom, c.encCode)) {
        if (ENC_LOCKED.includes(cur.statut)) return json({ ok: false, error: 'locked' }, 409)
        if (patch.statut && !ENC_STATUTS.includes(patch.statut)) return json({ ok: false, error: 'bad-statut' }, 400)
        // L'encadrant doit encadrer le projet (s'il a des encadrants renseignés).
        const { data: et } = await sb.from('etudiants').select('encadrant1, encadrant2, encadrant3').eq('projet', cur.projet)
        const encs = new Set<string>()
        for (const r of (et || []) as any[]) for (const x of [r.encadrant1, r.encadrant2, r.encadrant3]) if (x) encs.add(norm(x))
        if (encs.size && !encs.has(norm(c.encNom))) return json({ ok: false, error: 'auth' }, 401)
        allowed = true
      } else if (patch.statut === 'annulee' && only(['statut', 'statut_at', 'historique']) &&
                 ['en_attente', 'attente_info'].includes(cur.statut)) {
        // annulation par l'étudiant tant que la demande n'est pas validée (mot de passe du projet requis)
        const refus = await refusProjet(cur.projet, c.projetPw)
        if (refus) return refus
        allowed = true
      }
      if (!allowed) return json({ ok: false, error: 'auth' }, 401)
      const { error } = await sb.from('mat_demandes').update(patch).eq('id', eq.id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad-op' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
