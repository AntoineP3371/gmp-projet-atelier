// Edge Function : notify-print-email
// Envoie à l'étudiant un e-mail « votre pièce est imprimée » AVEC la photo en pièce jointe.
// - L'adresse est lue dans la table VERROUILLÉE demande_contacts (aucun accès anon).
// - Elle est SUPPRIMÉE après un envoi réussi (minimisation RGPD).
// - Auth : code opérateur (comme les autres écritures).
// Secrets attendus : RESEND_API_KEY (clé Resend), RESEND_FROM (ex. "Atelier GMP <atelier@gmpbordeaux.fr>").
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function esc(s: string) {
  return (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const b = await req.json()
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Auth opérateur (nom + code vérifiés côté serveur).
    const opOk = async (name?: string, code?: string) => {
      if (!name || !code) return false
      const { data } = await sb.from('operateurs').select('code').eq('name', name).maybeSingle()
      const s = (data?.code ?? '').toString().trim()
      return s.length > 0 && s === code.toString().trim()
    }
    if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)

    const id = b.id
    if (!id) return json({ ok: false, error: 'no id' }, 400)

    // 1) Adresse dans la table verrouillée. Pas d'adresse => rien à faire (cas normal).
    const { data: contact } = await sb.from('demande_contacts').select('email').eq('demande_id', id).maybeSingle()
    const email = (contact?.email ?? '').toString().trim()
    if (!email) return json({ ok: true, sent: false, reason: 'no-email' })

    // 2) Infos de la demande pour personnaliser le message.
    const { data: d } = await sb.from('demandes')
      .select('etudiant_prenom, etudiant_nom, projet, fichier_nom, numero, operateur_nom')
      .eq('id', id).maybeSingle()
    const prenom = (d?.etudiant_prenom ?? '').toString()
    const projet = (d?.projet ?? '').toString()
    const fichier = (d?.fichier_nom ?? '').toString()
    const op = (d?.operateur_nom ?? b.operateur ?? '').toString()

    // 3) Config Resend.
    const apiKey = (Deno.env.get('RESEND_API_KEY') || '').trim()
    const from = (Deno.env.get('RESEND_FROM') || 'Atelier GMP <onboarding@resend.dev>').trim()
    if (!apiKey) return json({ ok: false, error: 'no-resend-key' }, 500)

    const html =
      `<p>Bonjour ${esc(prenom) || ''},</p>` +
      `<p>Votre impression 3D pour le projet <b>${esc(projet)}</b>` +
      (fichier ? ` (fichier <b>${esc(fichier)}</b>)` : '') +
      ` est <b>terminée</b> ✅</p>` +
      `<p>Vous pouvez venir la récupérer auprès de ${esc(op) || 'l\'opérateur'}. La photo de la pièce est en pièce jointe.</p>` +
      `<p style="color:#888;font-size:.85rem">Message automatique de l'atelier GMP — merci de ne pas répondre.</p>`

    const payload: any = {
      from,
      to: [email],
      subject: 'Votre pièce imprimée en 3D est prête' + (projet ? ' — ' + projet : ''),
      html,
    }
    // Photo en pièce jointe (base64 fournie par le client, déjà compressée).
    if (b.photoB64) {
      payload.attachments = [{ filename: (fichier ? fichier.replace(/\.[^.]+$/, '') : 'piece') + '.jpg', content: b.photoB64 }]
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) {
      const t = await resp.text()
      return json({ ok: false, error: 'send-failed', detail: t.slice(0, 300) }, 502)
    }

    // 4) Minimisation : on efface l'adresse après l'envoi réussi.
    await sb.from('demande_contacts').delete().eq('demande_id', id)
    return json({ ok: true, sent: true })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
