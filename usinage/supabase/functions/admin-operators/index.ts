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
// Nom normalisé (clé des codes personnels) : minuscules, sans accents, espaces réduits.
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

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
    const { data: spw } = await sb.from('parametres').select('valeur').eq('cle', 'superadmin_pw_hash').maybeSingle()
    const superExpected = ((spw?.valeur) || Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
    const isAdmin = (!!expected && codeHash === expected) || (!!superExpected && codeHash === superExpected)

    // Renommage de projet : autorisé à l'admin OU à un encadrant (son code personnel valide).
    if (action === 'etudiants-rename') {
      let ok = isAdmin
      if (!ok) {
        const nom = (body.encadrantNom ?? '').toString().trim()
        const ec = (body.encadrantCode ?? '').toString().trim()
        if (nom && ec) {
          const { data } = await sb.from('encadrant_codes').select('code_hash').eq('nom', norm(nom)).maybeSingle()
          const h = (data?.code_hash ?? '').toString().trim()
          ok = !!h && h === await sha256hex(ec)
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
            // Le code opérateur n'est plus saisi par l'admin : c'est un code PERSONNEL unique que la
            // personne définit à sa 1re connexion (table encadrant_codes). On garde la colonne vide.
            code: '',
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
    // Import PAR ANNÉE : ne remplace que les lignes de l'année choisie (les autres années
    // sont préservées). Sans année fournie → remplacement total (rétro-compatible).
    if (action === 'etudiants-import') {
      const annee = (body.annee ?? '').toString().trim()
      const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
      const idOf = (r: any) => norm(r.nom) + '|' + norm(r.prenom)
      // Lignes du fichier, dédoublonnées par étudiant (nom+prénom) : la DERNIÈRE occurrence gagne.
      const seen = new Map<string, any>()
      for (const e of (body.etudiants || []) as any[]) {
        if (!e || !(e.nom ?? '').toString().trim() || !(e.prenom ?? '').toString().trim()) continue
        const row = {
          nom: e.nom.toString().trim(), prenom: e.prenom.toString().trim(), projet: (e.projet ?? '').toString().trim(),
          formation: (e.formation ?? '').toString().trim(),
          parcours: (e.parcours ?? '').toString().trim(),
          encadrant1: (e.encadrant1 ?? '').toString().trim(),
          encadrant2: (e.encadrant2 ?? '').toString().trim(),
          encadrant3: (e.encadrant3 ?? '').toString().trim(),
          annee: annee || null,
        }
        seen.set(idOf(row), row)   // remplace toute occurrence précédente du même étudiant
      }
      const rows = [...seen.values()]
      const idset = new Set([...seen.keys()])
      const backup = (await sb.from('etudiants').select('*')).data || []
      // NOUVELLE année (aucune ligne existante avec cette valeur) → on AJOUTE seulement, rien n'est
      // remplacé ni supprimé (même si des étudiants du même nom existent sur d'autres années).
      const yearIsNew = !!annee && !(backup as any[]).some((r) => r.annee === annee)
      // Lignes que l'import supprime : pour une année EXISTANTE, toute cette année + les fiches SANS
      // année du même étudiant (anti-doublon) ; sans année fournie → tout ; nouvelle année → rien.
      const removed = (r: any) => {
        if (!annee) return true
        if (yearIsNew) return false
        return r.annee === annee || (r.annee == null && idset.has(idOf(r)))
      }
      if (annee && !yearIsNew) {
        const d1 = await sb.from('etudiants').delete().eq('annee', annee)
        if (d1.error) throw d1.error
        const strayIds = (backup as any[]).filter((r) => r.annee == null && idset.has(idOf(r))).map((r) => r.id).filter((x) => x != null)
        if (strayIds.length) { const d2 = await sb.from('etudiants').delete().in('id', strayIds); if (d2.error) throw d2.error }
      } else if (!annee) {
        const d0 = await sb.from('etudiants').delete().neq('id', 0)
        if (d0.error) throw d0.error
      }
      // nouvelle année : aucun effacement, on passe directement à l'insertion.
      if (rows.length) {
        const ins = await sb.from('etudiants').insert(rows)
        if (ins.error) {
          // Restauration : ne réinsère que le sous-ensemble supprimé (sans l'id).
          const restore = (backup as any[]).filter(removed).map(({ id, ...r }) => r)
          if (restore.length) await sb.from('etudiants').insert(restore)
          throw ins.error
        }
      }
      return json({ ok: true, count: rows.length })
    }

    // Enregistrement de l'ÉDITION du tableau : remplace toute la table par la liste fournie
    // (les lignes retirées côté client disparaissent, les modifications sont appliquées).
    if (action === 'etudiants-save') {
      const rows = ((body.etudiants || []) as any[])
        .filter((e) => e && (e.nom ?? '').toString().trim() && (e.prenom ?? '').toString().trim())
        .map((e) => ({
          nom: e.nom.toString().trim(), prenom: e.prenom.toString().trim(),
          projet: (e.projet ?? '').toString().trim(),
          formation: (e.formation ?? '').toString().trim(),
          parcours: (e.parcours ?? '').toString().trim(),
          encadrant1: (e.encadrant1 ?? '').toString().trim(),
          encadrant2: (e.encadrant2 ?? '').toString().trim(),
          encadrant3: (e.encadrant3 ?? '').toString().trim(),
          annee: (e.annee ?? '').toString().trim() || null,
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
      return json({ ok: true, count: rows.length })
    }

    // Vide la liste : une année précise, les lignes sans année ('__none__'), ou tout.
    if (action === 'etudiants-clear') {
      const annee = (body.annee ?? '').toString().trim()
      const del = annee === '__none__'
        ? await sb.from('etudiants').delete().is('annee', null)
        : (annee
            ? await sb.from('etudiants').delete().eq('annee', annee)
            : await sb.from('etudiants').delete().neq('id', 0))
      if (del.error) throw del.error
      return json({ ok: true })
    }

    // ── Encadrants (gestion des codes personnels, portail) ──
    // La liste des noms est DÉDUITE de la table etudiants (encadrant1/2/3) :
    // aucune double saisie, elle reste alimentée par l'import Excel des projets.
    if (action === 'encadrants-list') {
      const { data: et } = await sb.from('etudiants').select('encadrant1, encadrant2, encadrant3')
      const noms = new Set<string>()
      for (const r of (et || []) as any[]) {
        for (const k of ['encadrant1', 'encadrant2', 'encadrant3']) {
          const v = (r[k] ?? '').toString().trim()
          if (v) noms.add(v)
        }
      }
      // Codes personnels : clé = nom NORMALISÉ. hasCode se calcule par correspondance normalisée.
      const { data: codes } = await sb.from('encadrant_codes').select('nom, code_hash, updated_at')
      const byKey: Record<string, any> = {}
      for (const c of (codes || []) as any[]) { if ((c.code_hash || '').toString().trim()) byKey[norm(c.nom)] = c }
      const list = [...noms]
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .map((nom) => ({
          nom,
          hasCode: !!byKey[norm(nom)],
          updatedAt: byKey[norm(nom)]?.updated_at || null,
        }))
      return json({ ok: true, encadrants: list })
    }

    // Liste des clés (noms normalisés) ayant un code défini — pour l'affichage du statut par personne.
    if (action === 'person-codes') {
      const { data: codes } = await sb.from('encadrant_codes').select('nom, code_hash')
      const keys = ((codes || []) as any[]).filter((c) => (c.code_hash || '').toString().trim()).map((c) => norm(c.nom))
      return json({ ok: true, keys })
    }

    // Réinitialise le code d'une PERSONNE (par nom normalisé) → retour au code par défaut 000000,
    // pour ses deux rôles à la fois. L'admin ne voit jamais le code.
    if (action === 'person-reset') {
      const key = norm(body.nom ?? '')
      if (!key) return json({ ok: false, error: 'no-name' }, 400)
      const del = await sb.from('encadrant_codes').delete().eq('nom', key)
      if (del.error) throw del.error
      return json({ ok: true })
    }

    // (compat) Réinitialise le code d'un encadrant par nom (normalisé).
    if (action === 'encadrants-reset') {
      const nom = (body.nom ?? '').toString().trim()
      if (!nom) return json({ ok: false, error: 'no-name' }, 400)
      const del = await sb.from('encadrant_codes').delete().eq('nom', norm(nom))
      if (del.error) throw del.error
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad action' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
