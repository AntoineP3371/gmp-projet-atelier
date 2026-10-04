// Edge Function : verify-code
// Vérifie un code CÔTÉ SERVEUR (le code n'est jamais lisible dans le navigateur).
//
// CODE UNIQUE PAR PERSONNE (partagé entre les rôles encadrant et opérateur).
//   • Stocké haché (SHA-256) dans la table `encadrant_codes`, clé = NOM NORMALISÉ
//     (minuscules, sans accents, espaces réduits) → « Céline MARTIN » et « celine martin »
//     partagent le même code.
//   • Code par défaut « 000000 » tant que la personne n'a pas choisi le sien.
//   • 1re connexion (aucun code défini) : verify renvoie mustChange=true si 000000 est saisi ;
//     le client rappelle alors avec setup:true pour enregistrer le code choisi (≥ 4 caractères, ≠ 000000).
//   • Un code déjà défini ne peut être changé que par l'admin (« Réinitialiser » → retour à 000000).
//
// Entrées :
//   { kind:'operateur', name, code }              -> { ok, mustChange?, notAuthorized? }
//   { kind:'operateur', name, code, setup:true }  -> { ok, already?, error? }
//   { kind:'encadrant', name, code }              -> { ok, mustChange?, notAuthorized?, sae?, saeDown?, msg? }
//      (encadrant : mot de passe du compte Carnet SAE GMP s'il en a un, sinon code personnel Atelier)
//   { kind:'encadrant', name, code, setup:true }  -> { ok, already?, error? }
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

const DEFAULT = '000000'   // code par défaut tant que la personne n'a pas défini le sien
const MIN_LEN = 4          // longueur minimale d'un code choisi

// ── Code ENCADRANT = mot de passe du compte « Carnet SAE GMP » (collection sae_users) ──
// Carnet SAE ne stocke aucun code en clair (SHA-256 du code comme mot de passe, haché par PocketBase) : on ne peut donc pas
// le « récupérer », seulement le faire VÉRIFIER par Carnet SAE (auth-with-password). Un encadrant qui n'a pas de compte là-bas
// (ajouté à la main) garde son code personnel Atelier (table encadrant_codes).
//   'ok' | 'bad' (mauvais code) | 'mustchange' (code provisoire : à remplacer d'abord dans Carnet SAE)
//   'noaccount' (pas de compte Carnet SAE) | 'down' (Carnet SAE injoignable → refus, jamais d'ouverture par défaut)
const SAE_URL = 'https://api_evalprojet.gmpbordeaux.fr'
const saeNorm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
const saeLogin = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')   // = normName() de Carnet SAE
async function saeEncadrant(nom: string, code: string): Promise<'ok' | 'bad' | 'mustchange' | 'noaccount' | 'down'> {
  try {
    const rn = await fetch(SAE_URL + '/enc/names', { headers: { Accept: 'application/json' } })
    if (!rn.ok) return 'down'
    const names = await rn.json()
    const n = (Array.isArray(names) ? names : []).find((x: any) => saeNorm(x) === saeNorm(nom))
    if (!n) return 'noaccount'
    if (!code) return 'bad'
    const ra = await fetch(SAE_URL + '/api/collections/sae_users/auth-with-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: saeLogin(n), password: await sha256hex(code) }),
    })
    if (ra.ok) { const j = await ra.json().catch(() => ({})); return j?.record?.must_change ? 'mustchange' : 'ok' }
    return ra.status >= 500 ? 'down' : 'bad'
  } catch (_) { return 'down' }
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { kind, name, code, setup } = await req.json()
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const nom = (name ?? '').toString().trim()
    const key = norm(nom)
    const codeStr = (code ?? '').toString().trim()
    if (!key) return json({ ok: false, error: 'no-name' }, 400)
    if (kind !== 'operateur' && kind !== 'encadrant') return json({ ok: false, error: 'bad-kind' }, 400)

    // ENCADRANT : si la personne a un compte Carnet SAE GMP, c'est SON mot de passe Carnet SAE qui fait foi (vérifié là-bas).
    // Sans compte Carnet SAE, on retombe sur le code personnel Atelier (ci-dessous).
    if (kind === 'encadrant') {
      const r = await saeEncadrant(nom, codeStr)
      if (r === 'ok') return json({ ok: true, sae: true })
      if (r === 'bad') return json({ ok: false, sae: true })
      if (r === 'mustchange') return json({ ok: false, sae: true, msg: 'Votre code Carnet SAE est encore provisoire : connectez-vous une première fois à Carnet SAE pour choisir votre code personnel, puis revenez ici.' })
      if (r === 'down') return json({ ok: false, saeDown: true, msg: 'Carnet SAE est injoignable : impossible de vérifier votre code. Réessayez dans un moment.' })
    }

    // Code personnel (haché) de la personne, par nom normalisé.
    const { data } = await sb.from('encadrant_codes').select('code_hash').eq('nom', key).maybeSingle()
    const storedHash = (data?.code_hash ?? '').toString().trim()

    // AUTORISATION (seul l'admin crée les personnes) — une personne sans code encore défini n'est
    // autorisée à en choisir un que si elle est déjà connue :
    //   • opérateur : présent dans la table operateurs (créé par l'admin) ;
    //   • encadrant : présent dans un projet (table etudiants) ;
    // On compare sur le nom NORMALISÉ. Une personne ayant déjà un code reste autorisée.
    if (!storedHash) {
      let connu = false
      if (kind === 'operateur') {
        const { data: ops } = await sb.from('operateurs').select('name')
        connu = (ops || []).some((r: any) => norm(r.name) === key)
      } else {
        const { data: et } = await sb.from('etudiants').select('encadrant1, encadrant2, encadrant3')
        connu = (et || []).some((r: any) =>
          [r.encadrant1, r.encadrant2, r.encadrant3].some((x) => norm(x) === key))
      }
      if (!connu) return json({ ok: false, notAuthorized: true })
    }

    // Définition d'un nouveau code (1re connexion, ou après réinitialisation admin).
    if (setup) {
      if (storedHash) return json({ ok: false, already: true })           // déjà défini → l'admin réinitialise
      if (codeStr.length < MIN_LEN || codeStr === DEFAULT) return json({ ok: false, error: 'bad-code' }, 400)
      const up = await sb.from('encadrant_codes')
        .upsert([{ nom: key, code_hash: await sha256hex(codeStr), updated_at: new Date().toISOString() }])
      if (up.error) throw up.error
      return json({ ok: true })
    }

    // Vérification. Sans code perso, le code par défaut 000000 est accepté mais impose un changement.
    if (!storedHash) {
      if (codeStr === DEFAULT) return json({ ok: false, mustChange: true })
      return json({ ok: false })
    }
    return json({ ok: storedHash === (await sha256hex(codeStr)) })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 400)
  }
})
