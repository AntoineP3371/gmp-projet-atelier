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
//   { kind:'encadrant', name, code }              -> { ok, mustChange?, notAuthorized? }
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
