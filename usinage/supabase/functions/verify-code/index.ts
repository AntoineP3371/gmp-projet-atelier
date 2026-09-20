// Edge Function : verify-code
// Vérifie un code CÔTÉ SERVEUR (le code n'est jamais lisible dans le navigateur).
//
// Opérateur : { kind:'operateur', name, code }                 -> { ok }
// Encadrant : { kind:'encadrant', name, code }                 -> { ok, needsSetup }
//             { kind:'encadrant', name, code, setup:true }      -> { ok, already }
//   • Chaque encadrant a SON code (table encadrant_codes, haché en SHA-256).
//   • 1re connexion (aucun code encore défini) : verify renvoie needsSetup=true ;
//     le client rappelle alors avec setup:true pour enregistrer le code choisi.
//   • Un code déjà défini ne peut être changé que par l'admin (« Réinitialiser »).
//
// Utilise la clé de service (contourne la RLS). Créée/déployée depuis le dashboard Supabase.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { kind, name, code, setup } = await req.json()
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const codeStr = (code ?? '').toString().trim()

    if (kind === 'operateur') {
      const { data } = await sb.from('operateurs').select('code').eq('name', name).maybeSingle()
      const stored = (data?.code ?? '').toString().trim()
      return json({ ok: stored.length > 0 && stored === codeStr })
    }

    if (kind === 'encadrant') {
      const nom = (name ?? '').toString().trim()
      if (!nom) return json({ ok: false, error: 'no-name' }, 400)
      const { data } = await sb.from('encadrant_codes').select('code_hash').eq('nom', nom).maybeSingle()
      const storedHash = (data?.code_hash ?? '').toString().trim()

      // AUTORISATION : seul l'admin crée les encadrants. Un encadrant n'est autorisé que
      // s'il figure déjà dans un projet (table etudiants, alimentée par l'admin) — ou s'il
      // a déjà un code défini (pour ne pas verrouiller un encadrant retiré des projets ensuite).
      if (!storedHash) {
        const { data: et } = await sb.from('etudiants').select('encadrant1, encadrant2, encadrant3')
        const connu = (et || []).some((r: any) =>
          [r.encadrant1, r.encadrant2, r.encadrant3].map((x) => (x ?? '').toString().trim()).includes(nom))
        if (!connu) return json({ ok: false, notAuthorized: true })
      }

      // Définition du code (1re connexion) : autorisée seulement s'il n'existe pas encore.
      if (setup) {
        if (storedHash) return json({ ok: false, already: true })      // déjà défini → passer par l'admin
        if (!/^\d{4}$/.test(codeStr)) return json({ ok: false, error: 'bad-code' }, 400)
        const up = await sb.from('encadrant_codes')
          .upsert([{ nom, code_hash: await sha256hex(codeStr), updated_at: new Date().toISOString() }])
        if (up.error) throw up.error
        return json({ ok: true })
      }

      // Vérification classique.
      if (!storedHash) return json({ ok: false, needsSetup: true })    // aucun code défini pour ce nom
      return json({ ok: storedHash === (await sha256hex(codeStr)) })
    }

    return json({ ok: false, error: 'bad-kind' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 400)
  }
})
