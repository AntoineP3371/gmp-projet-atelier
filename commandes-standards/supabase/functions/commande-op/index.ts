// Edge Function : commande-op
// Écritures du module « Commandes d'éléments standards », vérifiées CÔTÉ SERVEUR.
// Même projet Supabase que reservation-machines / impression 3D.
//
// Auth par action :
//   create / cancel        : code PIN encadrant (parametres.code_encadrant)
//   statut / bulk-order /
//   edit / comment          : code opérateur (nom + code, table operateurs)
//   fourn-* / budget-save   : mot de passe admin  (parametres.admin_pw_hash | env ADMIN_PW_HASH | super)
//   gest-toggle / wipe      : mot de passe SUPER admin (env SUPERADMIN_PW_HASH)
//
// Déploiement : dashboard Supabase → Edge Functions → New function « commande-op »,
// coller ce fichier, Deploy. (Secrets déjà en place : SUPERADMIN_PW_HASH, ADMIN_PW_HASH.)
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
    const b = await req.json()
    const action = b.action
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Code PERSONNEL unique (table encadrant_codes, haché, clé = nom normalisé) — partagé
    // entre les rôles opérateur et encadrant d'une même personne.
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
    const codeOk = async (nom?: string, code?: string) => {
      const key = norm(nom); const c = (code ?? '').toString().trim()
      if (!key || !c) return false
      const { data } = await sb.from('encadrant_codes').select('code_hash').eq('nom', key).maybeSingle()
      const h = (data?.code_hash ?? '').toString().trim()
      return !!h && h === await sha256hex(c)
    }
    const encOk = codeOk
    // Rôle opérateur : le nom doit aussi être un opérateur connu (créé par l'admin).
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
    const histPush = (h: unknown, entry: unknown) => [ ...(Array.isArray(h) ? h : []), entry ]

    // ───────────── création d'une demande (encadrant) ─────────────
    if (action === 'create') {
      const ctx = b.ctx || {}
      if (!(await encOk(ctx.encadrant, b.encCode))) return json({ ok: false, error: 'auth' }, 401)
      const groupe = (ctx.groupe ?? '').toString().trim()
      const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l: any) => (l?.intitule ?? '').toString().trim())
      if (!groupe || !lines.length) return json({ ok: false, error: 'bad-input' }, 400)
      const { data: all } = await sb.from('commandes').select('numero, groupe')
      let base = 0
      for (const r of (all || []) as any[]) {
        if ((r.groupe || '').toLowerCase() === groupe.toLowerCase()) base = Math.max(base, Number(r.numero) || 0)
      }
      const now = new Date().toISOString()
      const par = (ctx.encadrant ?? '').toString()
      const rows = lines.map((l: any, i: number) => {
        const q = Number(l.quantite) || 1
        const cu = (l.cout_unitaire === null || l.cout_unitaire === '' || l.cout_unitaire === undefined) ? null : Number(l.cout_unitaire)
        return {
          numero: base + i + 1,
          formation: (ctx.formation ?? '').toString(),
          parcours: (ctx.parcours ?? '').toString(),
          groupe,
          encadrant: par,
          fournisseur: (l.fournisseur ?? '').toString().trim(),
          intitule: (l.intitule ?? '').toString().trim(),
          reference: (l.reference ?? '').toString().trim(),
          lien: (l.lien ?? '').toString().trim(),
          quantite: q,
          cout_unitaire: cu,
          cout_total: cu != null ? Math.round(cu * q * 100) / 100 : null,
          statut: 'demandee',
          historique: [{ t: now, statut: 'demandee', par }],
        }
      })
      const ins = await sb.from('commandes').insert(rows)
      if (ins.error) throw ins.error

      // Notification WhatsApp (CallMeBot) aux gestionnaires abonnés — ne doit jamais faire échouer la demande.
      try {
        const nbA = rows.length
        const fournSet = new Set(rows.map((r) => r.fournisseur).filter(Boolean))
        const total = rows.reduce((s, r) => s + (Number(r.cout_total) || 0), 0)
        const totalTxt = rows.some((r) => r.cout_total != null)
          ? total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
          : 'non renseigné'
        const liste = rows.slice(0, 3).map((r) => `• ${r.intitule} ×${r.quantite} — ${r.fournisseur || '?'}`).join('\n')
        const reste = nbA - Math.min(nbA, 3)
        // CallMeBot supprime les apostrophes droites (') des messages : on les remplace par
        // l'apostrophe typographique (’), que son filtre laisse passer.
        const msg =
`📦 Nouvelle demande d'achat — Atelier GMP

Par : ${par || '?'}
Projet : ${groupe}${ctx.parcours ? ' · ' + ctx.parcours : ''}${ctx.formation ? ' · ' + ctx.formation : ''}
${nbA} article(s) chez ${fournSet.size} fournisseur(s)
Total estimé : ${totalTxt}

${liste}${reste > 0 ? `\n(+${reste} autre(s))` : ''}

Traiter la demande :
gmpbordeaux.fr/gmp-projet-atelier/commandes-standards/`.replace(/'/g, '’')
        // Destinataires = opérateurs ayant le rôle « Achat » (table com_gestionnaires) et un WhatsApp.
        const { data: gestRows } = await sb.from('com_gestionnaires').select('nom')
        const achat = new Set((gestRows || []).map((g: any) => norm(g.nom)))
        const { data: ops } = await sb.from('operateurs').select('name, phone, apikey')
        for (const o of (ops || []) as any[]) {
          if (achat.has(norm(o.name)) && o.phone && o.apikey) {
            const u = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(o.phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(o.apikey)}`
            try { await fetch(u) } catch (_) { /* ignore un envoi raté */ }
          }
        }
      } catch (_) { /* la notif ne bloque jamais la création */ }

      return json({ ok: true, count: rows.length })
    }

    // ───────────── annulation d'une ligne (encadrant, tant que « demandée ») ─────────────
    if (action === 'cancel') {
      const { data: c } = await sb.from('commandes').select('statut, historique, encadrant').eq('id', b.id).maybeSingle()
      if (!c) return json({ ok: false, error: 'not-found' }, 404)
      // Annulation réservée à l'encadrant qui a créé la demande (son code personnel).
      if (!(await encOk(c.encadrant, b.encCode))) return json({ ok: false, error: 'auth' }, 401)
      if (c.statut !== 'demandee') return json({ ok: false, error: 'too-late' }, 409)
      const now = new Date().toISOString()
      const { error } = await sb.from('commandes')
        .update({ statut: 'annulee', historique: histPush(c.historique, { t: now, statut: 'annulee', par: 'encadrant' }) })
        .eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    // ───────────── changement de statut (gestionnaire) ─────────────
    if (action === 'statut') {
      if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const { data: c } = await sb.from('commandes').select('*').eq('id', b.id).maybeSingle()
      if (!c) return json({ ok: false, error: 'not-found' }, 404)
      const st = (b.statut ?? '').toString()
      const now = new Date().toISOString()
      const patch: any = { statut: st, historique: histPush(c.historique, { t: now, statut: st, par: (b.opName ?? 'gestionnaire').toString() }) }
      if (st === 'demandee') { patch.commandee_at = null; patch.recue_at = null; patch.remise_at = null; patch.recue_note = '' }
      else if (st === 'commandee') { patch.commandee_at = c.commandee_at || now; patch.recue_at = null; patch.remise_at = null; patch.recue_note = '' }
      else if (st === 'recue_complete' || st === 'recue_partielle') {
        patch.commandee_at = c.commandee_at || now; patch.recue_at = c.recue_at || now; patch.remise_at = null
        patch.recue_note = st === 'recue_complete' ? 'complet' : 'partiel'
      }
      else if (st === 'remise') {
        patch.commandee_at = c.commandee_at || now; patch.recue_at = c.recue_at || now; patch.remise_at = now
        if (!c.recue_note) patch.recue_note = 'complet'
      }
      else if (st !== 'refusee' && st !== 'annulee') return json({ ok: false, error: 'bad-statut' }, 400)
      const { error } = await sb.from('commandes').update(patch).eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'bulk-order') {
      if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const ids = Array.isArray(b.ids) ? b.ids : []
      const now = new Date().toISOString()
      for (const id of ids) {
        const { data: c } = await sb.from('commandes').select('commandee_at, historique').eq('id', id).maybeSingle()
        if (!c) continue
        await sb.from('commandes').update({
          statut: 'commandee',
          commandee_at: c.commandee_at || now,
          historique: histPush(c.historique, { t: now, statut: 'commandee', par: (b.opName ?? 'gestionnaire').toString() }),
        }).eq('id', id)
      }
      return json({ ok: true, count: ids.length })
    }

    if (action === 'edit') {
      if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const p = b.patch || {}
      const patch: any = {}
      for (const k of ['fournisseur', 'reference', 'lien', 'intitule', 'commentaire_gestionnaire']) {
        if (k in p) patch[k] = (p[k] ?? '').toString()
      }
      if ('quantite' in p) patch.quantite = Number(p.quantite) || 1
      if ('cout_unitaire' in p) patch.cout_unitaire = (p.cout_unitaire === null || p.cout_unitaire === '') ? null : Number(p.cout_unitaire)
      if ('cout_total' in p) patch.cout_total = (p.cout_total === null || p.cout_total === '') ? null : Number(p.cout_total)
      if (!Object.keys(patch).length) return json({ ok: true })
      const { error } = await sb.from('commandes').update(patch).eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'comment') {
      if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'auth' }, 401)
      const field = b.field === 'demandeur' ? 'commentaire_demandeur' : 'commentaire_gestionnaire'
      const { error } = await sb.from('commandes').update({ [field]: (b.text ?? '').toString() }).eq('id', b.id)
      if (error) throw error
      return json({ ok: true })
    }

    // ───────────── fournisseurs / budgets (admin) ─────────────
    if (action === 'fourn-save') {
      if (!(await adminInfo(b.adminPw)).isAdmin) return json({ ok: false, error: 'auth' }, 401)
      const nom = (b.nom ?? '').toString().trim()
      if (!nom) return json({ ok: false, error: 'no-name' }, 400)
      const oldNom = (b.oldNom ?? nom).toString().trim()
      const up = await sb.from('com_fournisseurs').upsert([{
        nom, site: (b.site ?? '').toString().trim(), notes: (b.notes ?? '').toString().trim(), actif: b.actif !== false,
      }])
      if (up.error) throw up.error
      if (oldNom && oldNom !== nom) await sb.from('com_fournisseurs').delete().eq('nom', oldNom)
      return json({ ok: true })
    }
    if (action === 'fourn-toggle') {
      if (!(await adminInfo(b.adminPw)).isAdmin) return json({ ok: false, error: 'auth' }, 401)
      const { error } = await sb.from('com_fournisseurs').update({ actif: !!b.actif }).eq('nom', (b.nom ?? '').toString())
      if (error) throw error
      return json({ ok: true })
    }
    if (action === 'fourn-delete') {
      if (!(await adminInfo(b.adminPw)).isAdmin) return json({ ok: false, error: 'auth' }, 401)
      const { error } = await sb.from('com_fournisseurs').delete().eq('nom', (b.nom ?? '').toString())
      if (error) throw error
      return json({ ok: true })
    }
    if (action === 'budget-save') {
      if (!(await adminInfo(b.adminPw)).isAdmin) return json({ ok: false, error: 'auth' }, 401)
      const parcours = (b.parcours ?? '').toString().trim()
      if (!parcours) return json({ ok: false, error: 'no-parcours' }, 400)
      const limite = (b.limite === null || b.limite === '' || b.limite === undefined) ? null : Number(b.limite)
      const { error } = await sb.from('com_budgets').upsert([{ parcours, limite, maj_at: new Date().toISOString() }])
      if (error) throw error
      return json({ ok: true })
    }

    // ───────────── gestionnaires / vidage (super admin) ─────────────
    if (action === 'gest-toggle') {
      if (!(await adminInfo(b.adminPw)).isSuper) return json({ ok: false, error: 'auth' }, 401)
      const nom = (b.nom ?? '').toString().trim()
      if (!nom) return json({ ok: false, error: 'no-name' }, 400)
      const q = b.on
        ? await sb.from('com_gestionnaires').upsert([{ nom }])
        : await sb.from('com_gestionnaires').delete().eq('nom', nom)
      if (q.error) throw q.error
      return json({ ok: true })
    }
    // Abonnement d'un opérateur aux notifications WhatsApp de nouvelle demande.
    if (action === 'gest-notif') {
      if (!(await adminInfo(b.adminPw)).isSuper) return json({ ok: false, error: 'auth' }, 401)
      const nom = (b.nom ?? '').toString().trim()
      if (!nom) return json({ ok: false, error: 'no-name' }, 400)
      const { error } = await sb.from('operateurs').update({ notif_achats: !!b.on }).eq('name', nom)
      if (error) throw error
      return json({ ok: true })
    }
    if (action === 'wipe') {
      if (!(await adminInfo(b.adminPw)).isSuper) return json({ ok: false, error: 'auth' }, 401)
      const PK: Record<string, string> = { commandes: 'id', com_fournisseurs: 'nom', com_budgets: 'parcours', com_gestionnaires: 'nom' }
      const tables: string[] = Array.isArray(b.tables) ? b.tables : (b.table ? [b.table] : [])
      if (!tables.length) return json({ ok: false, error: 'no-table' }, 400)
      for (const t of tables) {
        const pk = PK[t]
        if (!pk) return json({ ok: false, error: 'bad-table' }, 400)
        const { error } = await sb.from(t).delete().not(pk, 'is', null)
        if (error) throw error
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad action' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
