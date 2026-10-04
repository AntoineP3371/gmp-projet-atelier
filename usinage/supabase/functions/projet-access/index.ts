// Edge Function : projet-access
// Vérifie le MOT DE PASSE DE PROJET de « Carnet SAE GMP » (PocketBase) pour identifier un étudiant
// par son projet dans les applis Atelier (Impression 3D, Utilisation de matières).
// Ce mot de passe est celui que les étudiants utilisent pour consulter les notes de leur projet ;
// il n'est ni stocké ni renvoyé ici : on interroge seulement Carnet SAE (/etu/list puis /etu/unlock).
//
// Règle : un projet inconnu de Carnet SAE, ou sans mot de passe défini là-bas, reste OUVERT
// (pas de blocage des projets saisis à la main / « Autre projet »).
//
// Actions (toujours HTTP 200, le résultat est dans le JSON) :
//   { action:'status', projet }              -> { ok:true, protected:boolean }
//   { action:'verify', projet, password }    -> { ok:true, protected } | { ok:false, error:'bad' }
//   en cas d'indisponibilité de Carnet SAE   -> { ok:false, error:'sae-down' }  (échec fermé)
//
// ⚠️ La détection « aucun mot de passe défini » repose sur le message d'erreur de Carnet SAE
// (« Aucun mot de passe défini pour ce projet… », pb_hooks/etu-access.pb.js). S'il change, adapter NO_PW ci-dessous.
//
// Déploiement : dashboard Supabase → Edge Functions → Deploy a new function « projet-access ».
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const SAE_URL = 'https://api_evalprojet.gmpbordeaux.fr'
const NO_PW = /aucun mot de passe/i
const normTxt = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

type Acces = 'open' | 'ok' | 'bad' | 'down'
async function accesProjet(projet: string, pw: string): Promise<Acces> {
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
    if (ru.ok) { try { await ru.body?.cancel() } catch (_) { /* inutile : on ne lit pas les notes */ } return pw ? 'ok' : 'bad' }
    const j = await ru.json().catch(() => ({}))
    if (ru.status === 403) return NO_PW.test(String(j.error ?? '')) ? 'open' : 'bad'
    if (ru.status === 404) return 'open'   // projet archivé / masqué côté Carnet SAE
    return 'down'
  } catch (_) { return 'down' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const b = await req.json().catch(() => ({}))
    const projet = String(b.projet ?? '').trim()
    if (!projet) return json({ ok: false, error: 'bad-input' })

    if (b.action === 'status') {
      const a = await accesProjet(projet, '')
      if (a === 'down') return json({ ok: false, error: 'sae-down' })
      return json({ ok: true, protected: a !== 'open' })
    }
    if (b.action === 'verify') {
      const a = await accesProjet(projet, String(b.password ?? ''))
      if (a === 'down') return json({ ok: false, error: 'sae-down' })
      if (a === 'bad') { await new Promise((r) => setTimeout(r, 600)); return json({ ok: false, error: 'bad' }) }
      return json({ ok: true, protected: a === 'ok' })
    }
    return json({ ok: false, error: 'bad action' })
  } catch (e) {
    return json({ ok: false, error: String(e) })
  }
})
