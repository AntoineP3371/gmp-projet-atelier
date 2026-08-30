// Edge Function : demande-op
// Écritures des demandes d'impression 3D, avec vérification CÔTÉ SERVEUR.
// Auth par action :
//   create  : public (mais la LIMITE par projet est vérifiée côté serveur)
//   valider / enc-commentaire : code encadrant
//   lancer / lancer-lock / lancer-unlock / statut / archive / reorder / op-commentaire : code opérateur (nom + code)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const b = await req.json()
    const action = b.action
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const opOk = async (name?: string, code?: string) => {
      if (!name || !code) return false
      const { data } = await sb.from('operateurs').select('code').eq('name', name).maybeSingle()
      const s = (data?.code ?? '').toString().trim()
      return s.length > 0 && s === code.toString().trim()
    }
    const encOk = async (code?: string) => {
      const { data } = await sb.from('parametres').select('valeur').eq('cle', 'code_encadrant').maybeSingle()
      return ((data?.valeur) || '0000').toString().trim() === (code ?? '').toString().trim()
    }

    if (action === 'create') {
      const d = b.demande || {}
      const projet = (d.projet ?? '').toString()
      if (!projet) return json({ ok: false, error: 'no projet' }, 400)
      // Limite par projet (vérifiée serveur)
      const { data: params } = await sb.from('parametres').select('cle, valeur')
      let limDef = 10
      let limMap: Record<string, any> = {}
      for (const p of (params || []) as any[]) {
        if (p.cle === 'limite_defaut') { const n = parseInt(p.valeur); if (n) limDef = n }
        if (p.cle === 'limites_projets') { try { limMap = JSON.parse(p.valeur) || {} } catch (_) {} }
      }
      const lim = (limMap[projet] != null) ? Number(limMap[projet]) : limDef
      const { count } = await sb.from('demandes').select('id', { count: 'exact', head: true }).eq('projet', projet)
      if ((count || 0) >= lim) return json({ ok: false, error: 'limit', lim })
      const ins = await sb.from('demandes').insert(d).select('id').single()
      if (ins.error) throw ins.error
      // E-mail facultatif : rangé dans la table VERROUILLÉE demande_contacts (aucun accès anon),
      // jamais dans demandes. Sera lu côté serveur puis supprimé après l'envoi du mail « terminée ».
      const email = (b.email ?? '').toString().trim()
      if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && ins.data?.id) {
        await sb.from('demande_contacts').upsert([{ demande_id: ins.data.id, email }])
        // Drapeau PUBLIC (non sensible) : indique au suivi qu'un e-mail est renseigné, sans l'exposer.
        await sb.from('demandes').update({ has_email: true }).eq('id', ins.data.id)
      }
      return json({ ok: true })
    }

    // Ajout/màj de l'e-mail par l'ÉTUDIANT depuis le suivi (public), tant que la demande n'est pas terminée.
    // L'adresse va dans la table verrouillée demande_contacts ; seul le drapeau has_email est public.
    if (action === 'set-email') {
      const email = (b.email ?? '').toString().trim()
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'bad-email' }, 400)
      const { data: dem } = await sb.from('demandes').select('statut').eq('id', b.id).maybeSingle()
      if (!dem) return json({ ok: false, error: 'not-found' }, 404)
      if (dem.statut === 'imprimee' || dem.statut === 'refusee') return json({ ok: false, error: 'closed' }, 409)
      await sb.from('demande_contacts').upsert([{ demande_id: b.id, email }])
      await sb.from('demandes').update({ has_email: true }).eq('id', b.id)
      return json({ ok: true })
    }

    if (action === 'valider') {
      if (!(await encOk(b.encadrantCode))) return json({ ok: false, error: 'auth' }, 401)
      const com = (b.commentaire ?? '').toString()
      const patch = {
        statut: b.ok ? 'validee' : 'refusee',
        encadrant_nom: (b.encadrantNom ?? '').toString(),
        encadrant_valide_at: new Date().toISOString(),
        encadrant_commentaire: com,
        // auteur + horodatage du commentaire (null si commentaire vide)
        encadrant_commentaire_par: com ? (b.encadrantNom ?? '').toString() : null,
        encadrant_commentaire_at: com ? new Date().toISOString() : null,
      }
      const { data, error } = await sb.from('demandes').update(patch).eq('id', b.id).select().single()
      if (error) throw error
      return json({ ok: true, demande: data })
    }

    // Mise à jour du commentaire encadrant SEUL (a posteriori, sans toucher au statut).
    if (action === 'enc-commentaire') {
      if (!(await encOk(b.encadrantCode))) return json({ ok: false, error: 'auth' }, 401)
      const com = (b.commentaire ?? '').toString()
      const { error } = await sb.from('demandes')
        .update({
          encadrant_commentaire: com,
          encadrant_commentaire_par: com ? (b.encadrantNom ?? '').toString() : null,
          encadrant_commentaire_at: com ? new Date().toISOString() : null,
        })
        .eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    // ── Verrou « fenêtre Lancer ouverte » (empêche 2 opérateurs de lancer la même demande) ──
    // Le verrou expire après LOCK_TTL_MS (rafraîchi tant que la fenêtre reste ouverte).
    const LOCK_TTL_MS = 180000 // 3 minutes

    if (action === 'lancer-lock') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const name = (b.operateur ?? '').toString()
      const nowIso = new Date().toISOString()
      const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString()
      // 1) Prise atomique du verrou s'il est libre ou expiré (WHERE ... AND status filter).
      const grab = await sb.from('demandes')
        .update({ lancer_lock_by: name, lancer_lock_at: nowIso })
        .eq('id', b.id)
        .or(`lancer_lock_by.is.null,lancer_lock_at.lt.${cutoff}`)
        .select('id')
      if (grab.error) throw grab.error
      if (grab.data && grab.data.length) return json({ ok: true })
      // 2) Sinon : est-ce déjà moi qui le détiens ? (rafraîchir) ; sinon quelqu'un d'autre.
      const cur = await sb.from('demandes').select('lancer_lock_by').eq('id', b.id).maybeSingle()
      const by = (cur.data?.lancer_lock_by ?? '').toString()
      if (by === name) {
        await sb.from('demandes').update({ lancer_lock_at: nowIso }).eq('id', b.id)
        return json({ ok: true })
      }
      return json({ ok: false, error: 'locked', by })
    }

    if (action === 'lancer-unlock') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const name = (b.operateur ?? '').toString()
      // Ne libère que si c'est bien cet opérateur qui détient le verrou.
      await sb.from('demandes').update({ lancer_lock_by: null, lancer_lock_at: null })
        .eq('id', b.id).eq('lancer_lock_by', name)
      return json({ ok: true })
    }

    if (action === 'lancer') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const name = (b.operateur ?? '').toString()
      // Refuser si un AUTRE opérateur détient le verrou (non expiré) : protection définitive.
      const cur = await sb.from('demandes').select('lancer_lock_by, lancer_lock_at').eq('id', b.id).maybeSingle()
      const by = (cur.data?.lancer_lock_by ?? '').toString()
      const at = cur.data?.lancer_lock_at ? new Date(cur.data.lancer_lock_at).getTime() : 0
      const fresh = at > (Date.now() - LOCK_TTL_MS)
      if (by && by !== name && fresh) return json({ ok: false, error: 'locked', by })
      const patch: any = {
        statut: 'en_cours', duree_reelle_min: b.duree, en_cours_at: new Date().toISOString(),
        imprime_at: null, operateur_nom: name,
        lancer_lock_by: null, lancer_lock_at: null, // le lancement libère le verrou
      }
      // Poids de matière (g) : mis à jour uniquement s'il est fourni (ne pas écraser à zéro).
      if (b.poids != null && b.poids !== '') { const p = Number(b.poids); if (!isNaN(p) && p > 0) patch.poids_matiere = p }
      const { error } = await sb.from('demandes').update(patch).eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'statut') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const patch: any = { statut: b.statut, operateur_nom: (b.operateur ?? '').toString(), statut_at: new Date().toISOString() }
      if (b.statut === 'imprimee') patch.imprime_at = new Date().toISOString()
      if (b.statut === 'validee') { patch.en_cours_at = null; patch.imprime_at = null }
      const { error } = await sb.from('demandes').update(patch).eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'op-commentaire') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const com = (b.commentaire ?? '').toString()
      const { error } = await sb.from('demandes')
        .update({
          operateur_commentaire: com,
          operateur_commentaire_par: com ? (b.operateur ?? '').toString() : null,
          operateur_commentaire_at: com ? new Date().toISOString() : null,
        })
        .eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    // Enregistrement de la photo de la pièce (id + lien Drive), auth opérateur.
    if (action === 'photo') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const { error } = await sb.from('demandes')
        .update({ photo_file_id: (b.photoFileId ?? null), photo_link: (b.photoLink ?? null) })
        .eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'archive') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const { error } = await sb.from('demandes').update({ archive: !!b.archive }).eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'reorder') {
      if (!(await opOk(b.operateur, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const res = await sb.from('demandes').select('*').eq('statut', 'validee')
      if (res.error) throw res.error
      const data = (res.data || []).filter((d: any) => !d.archive)
      data.sort((a: any, c: any) => {
        if ((c.priorite || 0) !== (a.priorite || 0)) return (c.priorite || 0) - (a.priorite || 0)
        return new Date(a.created_at).getTime() - new Date(c.created_at).getTime()
      })
      const i = data.findIndex((d: any) => d.id === b.id)
      const j = i + (b.dir || 0)
      if (i < 0 || j < 0 || j >= data.length) return json({ ok: true })
      const tmp = data[i]; data[i] = data[j]; data[j] = tmp
      for (let k = 0; k < data.length; k++) {
        const up = await sb.from('demandes').update({ priorite: (data.length - k) * 10 }).eq('id', data[k].id)
        if (up.error) throw up.error
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad action' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
