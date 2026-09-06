// Edge Function : admin-op
// Écritures réservées à l'ADMIN sur le planning (machines, blocages, actions admin sur réservations).
// Le mot de passe admin est vérifié par son empreinte SHA-256 :
//   1) ligne 'admin_pw_hash' de la table parametres (prioritaire — modifiable par le super admin)
//   2) sinon variable d'env ADMIN_PW_HASH (valeur d'origine, secours)
// Le mot de passe SUPER ADMIN est vérifié par la variable d'env SUPERADMIN_PW_HASH (jamais en table).
// Entrée POST JSON : { action, adminCode, ...params }
//
// Actions admin :
//   login         {} -> { ok, role:'super'|'admin'|null }   (vérifie le mot de passe, public)
//   saveMachines  { machines:[{name,color,position,slot_hours}], renames:[{from,to}] }   slot_hours ∈ {1,2,4} (défaut 4)
//   machineStatus { machine, status, status_reason, status_date }
//   block / unblock / blockHalfDay, params-list / params-save, limits-save
// Actions SUPER ADMIN (adminCode = mot de passe super admin) :
//   super-setAdminCode  { newCode }        change le mot de passe admin (empreinte en table parametres)
//   super-clearBookings { clearBookings, clearBlocks }  vide bookings+booking_pins et/ou disabled_slots
//   super-clearDemandes {}                 vide la table demandes (impression 3D)
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
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json()
    const { action, adminCode } = body

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Empreinte du mot de passe fourni.
    const codeHash = await sha256hex((adminCode ?? '').toString())

    // Super admin : empreinte dans la variable d'env SUPERADMIN_PW_HASH uniquement.
    const superExpected = (Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
    const isSuper = !!superExpected && codeHash === superExpected

    // Admin : empreinte dans parametres ('admin_pw_hash'), sinon variable d'env ADMIN_PW_HASH.
    // Le mot de passe super admin est aussi accepté partout où l'admin l'est.
    const { data: apw } = await sb.from('parametres').select('valeur').eq('cle', 'admin_pw_hash').maybeSingle()
    const expected = ((apw?.valeur) || Deno.env.get('ADMIN_PW_HASH') || '').trim()
    const isAdmin = isSuper || (!!expected && codeHash === expected)

    // Vérification du mot de passe (connexion admin / super admin des pages web).
    if (action === 'login') {
      return json({ ok: isAdmin, role: isSuper ? 'super' : (isAdmin ? 'admin' : null) })
    }

    // ── Actions SUPER ADMIN ──
    if (action === 'super-setAdminCode') {
      if (!isSuper) return json({ ok: false, error: 'unauthorized' }, 401)
      const newCode = (body.newCode ?? '').toString()
      if (newCode.length < 4) return json({ ok: false, error: 'trop court (4 caractères minimum)' }, 400)
      const { error } = await sb.from('parametres').upsert([{ cle: 'admin_pw_hash', valeur: await sha256hex(newCode) }])
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'super-clearBookings') {
      if (!isSuper) return json({ ok: false, error: 'unauthorized' }, 401)
      // Choix indépendant : réservations et/ou créneaux bloqués (au moins l'un des deux).
      const wantBookings = body.clearBookings !== false   // true par défaut (rétro-compatible)
      const wantBlocks = !!body.clearBlocks
      if (!wantBookings && !wantBlocks) return json({ ok: false, error: 'rien à effacer' }, 400)
      let bookings = 0, blocked = 0
      if (wantBookings) {
        const delB = await sb.from('bookings').delete({ count: 'exact' }).not('machine', 'is', null)
        if (delB.error) throw delB.error
        const delP = await sb.from('booking_pins').delete().not('machine', 'is', null)
        if (delP.error) throw delP.error
        bookings = delB.count || 0
      }
      if (wantBlocks) {
        const delD = await sb.from('disabled_slots').delete({ count: 'exact' }).not('machine', 'is', null)
        if (delD.error) throw delD.error
        blocked = delD.count || 0
      }
      return json({ ok: true, bookings, blocked })
    }

    if (action === 'super-clearDemandes') {
      if (!isSuper) return json({ ok: false, error: 'unauthorized' }, 401)
      const del = await sb.from('demandes').delete({ count: 'exact' }).not('id', 'is', null)
      if (del.error) throw del.error
      return json({ ok: true, demandes: del.count || 0 })
    }

    // Limites par projet : modifiable par un OPÉRATEUR (code valide) ou l'admin. N'écrit QUE limites_projets.
    if (action === 'limits-save') {
      let ok = isAdmin
      if (!ok && body.operateur && body.opCode) {
        const { data } = await sb.from('operateurs').select('code').eq('name', body.operateur).maybeSingle()
        const s = (data?.code ?? '').toString().trim()
        ok = s.length > 0 && s === (body.opCode ?? '').toString().trim()
      }
      if (!ok) return json({ ok: false, error: 'unauthorized' }, 401)
      const { error } = await sb.from('parametres').upsert([{ cle: 'limites_projets', valeur: (body.valeur ?? '').toString() }])
      if (error) throw error
      return json({ ok: true })
    }

    // Toutes les autres actions exigent l'admin.
    if (!isAdmin) return json({ ok: false, error: 'unauthorized' }, 401)

    if (action === 'saveMachines') {
      const machines = (body.machines || []) as any[]
      const renames = (body.renames || []) as any[]
      // conserver les statuts (panne) par nom
      const backup = (await sb.from('machines').select('*')).data || []
      const st: Record<string, any> = {}
      for (const m of backup as any[]) st[m.name] = { status: m.status || 'ok', status_reason: m.status_reason || '', status_date: m.status_date || null }
      const del = await sb.from('machines').delete().neq('name', '__never__')
      if (del.error) throw del.error
      const rows = machines
        .filter((m) => (m?.name ?? '').toString().trim())
        .map((m, i) => ({
          name: m.name.toString().trim(),
          color: (m.color || '#3b82f6').toString(),
          position: Number.isFinite(m.position) ? m.position : i,
          slot_hours: [1, 2, 4].includes(Number(m.slot_hours)) ? Number(m.slot_hours) : 4,
          status: st[m.name]?.status || 'ok',
          status_reason: st[m.name]?.status_reason || '',
          status_date: st[m.name]?.status_date || null,
        }))
      if (rows.length) {
        const ins = await sb.from('machines').insert(rows)
        if (ins.error) { if (backup.length) await sb.from('machines').insert(backup); throw ins.error }
      }
      // propager les renommages aux réservations et créneaux bloqués
      for (const r of renames) {
        if (r?.from && r?.to && r.from !== r.to) {
          await sb.from('bookings').update({ machine: r.to }).eq('machine', r.from)
          await sb.from('disabled_slots').update({ machine: r.to }).eq('machine', r.from)
        }
      }
      return json({ ok: true })
    }

    if (action === 'machineStatus') {
      const { machine, status, status_reason, status_date } = body
      const { error } = await sb.from('machines')
        .update({ status, status_reason: status_reason || '', status_date: status_date || null })
        .eq('name', machine)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'block') {
      const { machine, date, slot, reason } = body
      const { error } = await sb.from('disabled_slots').insert({ machine, date, slot, reason: reason || '' })
      if (error && error.code !== '23505') throw error   // ignore doublon
      return json({ ok: true })
    }

    if (action === 'unblock') {
      const { machine, date, slot } = body
      const { error } = await sb.from('disabled_slots').delete().match({ machine, date, slot })
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'blockHalfDay') {
      const { machine, date, slots, reason } = body
      // ne bloque pas un créneau déjà réservé
      const booked = (await sb.from('bookings').select('slot').eq('machine', machine).eq('date', date)).data || []
      const bookedSet = new Set((booked as any[]).map((x) => x.slot))
      let count = 0
      for (const slot of (slots || [])) {
        if (bookedSet.has(slot)) continue
        const { error } = await sb.from('disabled_slots').insert({ machine, date, slot, reason: reason || '' })
        if (!error || error.code === '23505') count++
      }
      return json({ ok: true, count })
    }

    // ── Paramètres (Impression 3D) ──
    if (action === 'params-list') {
      const { data, error } = await sb.from('parametres').select('cle, valeur')
      if (error) throw error
      const map: Record<string, string> = {}
      for (const p of (data || []) as any[]) { if (p.cle !== 'admin_pw_hash') map[p.cle] = p.valeur }
      return json({ ok: true, params: map })
    }

    if (action === 'params-save') {
      const rows = ((body.params || []) as any[])
        .filter((r) => r && (r.cle ?? '').toString())
        .map((r) => ({ cle: r.cle.toString(), valeur: (r.valeur ?? '').toString() }))
      if (rows.length) {
        const { error } = await sb.from('parametres').upsert(rows)
        if (error) throw error
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad action' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
