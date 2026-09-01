// Edge Function : admin-operators
// Lecture/écriture COMPLÈTE des opérateurs (nom, téléphone, clé API, code), réservée à l'admin.
// Le mot de passe admin est vérifié par son empreinte SHA-256, stockée en variable
// d'environnement de la fonction (ADMIN_PW_HASH) — jamais dans le code client.
// Entrée POST JSON :
//   { action:'list', adminCode }                -> { ok, operators:[...] }
//   { action:'save', adminCode, operators:[...] } -> { ok }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json()
    const { action, adminCode, operators } = body

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Admin (empreinte du mot de passe) — requis pour la plupart des actions.
    // Empreinte lue dans parametres ('admin_pw_hash', modifiable par le super admin),
    // sinon variable d'env ADMIN_PW_HASH. Le mot de passe super admin est aussi accepté.
    const codeHash = await sha256hex((adminCode ?? '').toString())
    const { data: apw } = await sb.from('parametres').select('valeur').eq('cle', 'admin_pw_hash').maybeSingle()
    const expected = ((apw?.valeur) || Deno.env.get('ADMIN_PW_HASH') || '').trim()
    const superExpected = (Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
    const isAdmin = (!!expected && codeHash === expected) || (!!superExpected && codeHash === superExpected)

    // Renommage de projet : autorisé à l'admin OU à un encadrant (code encadrant valide).
    if (action === 'etudiants-rename') {
      let ok = isAdmin
      if (!ok) {
        const ec = (body.encadrantCode ?? '').toString()
        if (ec) {
          const { data } = await sb.from('parametres').select('valeur').eq('cle', 'code_encadrant').maybeSingle()
          ok = ((data?.valeur) || '0000') === ec
        }
      }
      if (!ok) return json({ ok: false, error: 'unauthorized' }, 401)
      const from = (body.from ?? '').toString(), to = (body.to ?? '').toString()
      if (!from || !to) return json({ ok: false, error: 'bad params' }, 400)
      const e1 = await sb.from('etudiants').update({ projet: to }).eq('projet', from)
      if (e1.error) throw e1.error
      await sb.from('demandes').update({ projet: to }).eq('projet', from)
      return json({ ok: true })
    }

    // Toutes les autres actions exigent l'admin.
    if (!isAdmin) return json({ ok: false, error: 'unauthorized' }, 401)

    if (action === 'list') {
      const { data, error } = await sb
        .from('operateurs')
        .select('name, phone, apikey, code, notif_3d, machines_outils, impression_3d')
        .order('name')
      if (error) throw error
      return json({ ok: true, operators: data || [] })
    }

    if (action === 'save') {
      // Conserver notif_3d et les types de machines quand l'appelant ne les fournit pas
      // (le gestionnaire de l'usinage n'envoie pas ces champs → on garde les valeurs en base).
      const backup = (await sb.from('operateurs').select('*')).data || []
      const notifByName: Record<string, boolean> = {}
      const moByName: Record<string, boolean> = {}
      const i3dByName: Record<string, boolean> = {}
      for (const o of backup as any[]) {
        notifByName[o.name] = o.notif_3d
        moByName[o.name] = o.machines_outils
        i3dByName[o.name] = o.impression_3d
      }
      const rows = ((operators || []) as any[])
        .filter((o) => o && (o.name ?? '').toString().trim())
        .map((o) => {
          const nm = o.name.toString().trim()
          return {
            name: nm,
            phone: (o.phone ?? '').toString().trim(),
            apikey: (o.apikey ?? '').toString().trim(),
            code: (o.code ?? '').toString().trim(),
            notif_3d: notifByName[nm] ?? true,
            // Fourni par l'appelant → appliqué ; sinon valeur en base ; sinon true par défaut.
            machines_outils: o.machines_outils !== undefined ? !!o.machines_outils : (moByName[nm] ?? true),
            impression_3d: o.impression_3d !== undefined ? !!o.impression_3d : (i3dByName[nm] ?? true),
          }
        })
      const del = await sb.from('operateurs').delete().neq('name', '__never__')
      if (del.error) throw del.error
      if (rows.length) {
        const ins = await sb.from('operateurs').insert(rows)
        if (ins.error) {
          if (backup.length) await sb.from('operateurs').insert(backup) // restauration
          throw ins.error
        }
      }
      return json({ ok: true })
    }

    // ── Étudiants (portail) ──
    if (action === 'etudiants-import') {
      const rows = ((body.etudiants || []) as any[])
        .filter((e) => e && (e.nom ?? '').toString().trim() && (e.prenom ?? '').toString().trim() && (e.projet ?? '').toString().trim())
        .map((e) => ({
          nom: e.nom.toString().trim(), prenom: e.prenom.toString().trim(), projet: e.projet.toString().trim(),
          formation: (e.formation ?? '').toString().trim(),
          parcours: (e.parcours ?? '').toString().trim(),
          encadrant1: (e.encadrant1 ?? '').toString().trim(),
          encadrant2: (e.encadrant2 ?? '').toString().trim(),
          encadrant3: (e.encadrant3 ?? '').toString().trim(),
        }))
      const backup = (await sb.from('etudiants').select('*')).data || []
      const del = await sb.from('etudiants').delete().neq('id', 0)
      if (del.error) throw del.error
      if (rows.length) {
        const ins = await sb.from('etudiants').insert(rows)
        if (ins.error) {
          if (backup.length) await sb.from('etudiants').insert((backup as any[]).map(({ id, ...r }) => r))
          throw ins.error
        }
      }
      return json({ ok: true })
    }

    if (action === 'etudiants-clear') {
      const del = await sb.from('etudiants').delete().neq('id', 0)
      if (del.error) throw del.error
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad action' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
