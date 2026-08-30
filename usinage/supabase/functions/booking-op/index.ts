// Edge Function : booking-op
// Toutes les ÉCRITURES de réservations (création, annulation, modification, déplacement) avec
// vérification CÔTÉ SERVEUR. Le PIN d'annulation est stocké dans la table verrouillée `booking_pins`
// (jamais exposé au navigateur). Auth : soit le PIN de la réservation (utilisateur), soit le mot de
// passe admin (empreinte ADMIN_PW_HASH). Le code opérateur est vérifié via la table `operateurs`.
//
// Actions :
//   create    { machine,date,slot, nom,prenom,operateur,projet, encadrant1..3, pin, opName, opCode }
//   verifyPin { machine,date,slot, pin } -> { ok }
//   cancel    { machine,date,slot, pin? , adminCode? }
//   update    { machine,date,slot, ...champs, opName, opCode, pin? , adminCode? }   (même créneau)
//   move      { from:{...}, to:{...}, ...champs, opName?, opCode?, pin? , adminCode? }
//   restoreState { dates:[...], bookings:{key:row}, disabled:{key:{reason}}, adminCode }  (undo/redo, admin)
//
// NB (limite connue) : l'undo/redo (restoreState) ne peut pas restaurer le PIN d'une réservation
// supprimée (le pin est effacé avec elle) — une réservation restaurée par undo repart sans pin.
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
    const b = await req.json()
    const action = b.action
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Empreinte admin lue dans parametres ('admin_pw_hash', modifiable par le super admin),
    // sinon variable d'env ADMIN_PW_HASH. Le mot de passe super admin est aussi accepté.
    let isAdmin = false
    if (b.adminCode) {
      const codeHash = await sha256hex(b.adminCode.toString())
      const { data: apw } = await sb.from('parametres').select('valeur').eq('cle', 'admin_pw_hash').maybeSingle()
      const expectedAdmin = ((apw?.valeur) || Deno.env.get('ADMIN_PW_HASH') || '').trim()
      const superExpected = (Deno.env.get('SUPERADMIN_PW_HASH') || '').trim()
      isAdmin = (!!expectedAdmin && codeHash === expectedAdmin) || (!!superExpected && codeHash === superExpected)
    }

    const opOk = async (name?: string, code?: string) => {
      if (!name || !code) return false
      const { data } = await sb.from('operateurs').select('code').eq('name', name).maybeSingle()
      const stored = (data?.code ?? '').toString().trim()
      return stored.length > 0 && stored === code.toString().trim()
    }
    const pinOk = async (m: string, d: string, s: string, pin?: string) => {
      const { data } = await sb.from('booking_pins').select('pin').match({ machine: m, date: d, slot: s }).maybeSingle()
      const stored = (data?.pin ?? '').toString()
      return stored.length > 0 && stored === (pin ?? '').toString().trim()
    }
    const free = async (m: string, d: string, s: string) => {
      const bk = await sb.from('bookings').select('machine').match({ machine: m, date: d, slot: s }).maybeSingle()
      if (bk.data) return false
      const ds = await sb.from('disabled_slots').select('machine').match({ machine: m, date: d, slot: s }).maybeSingle()
      return !ds.data
    }
    const fields = (x: any) => ({
      nom: x.nom || '', prenom: x.prenom || '', operateur: x.operateur || '', projet: x.projet || '',
      encadrant1: x.encadrant1 || '', encadrant2: x.encadrant2 || '', encadrant3: x.encadrant3 || '',
    })
    // Liste d'attente : si une personne attendait ce créneau, la prévenir qu'il s'est libéré,
    // puis retirer l'entrée. L'adresse vient de la table VERROUILLÉE waitlist (jamais exposée).
    const notifyWaitlist = async (m: string, d: string, s: string) => {
      const { data } = await sb.from('waitlist').select('email').match({ machine: m, date: d, slot: s }).maybeSingle()
      const email = (data?.email ?? '').toString().trim()
      if (!email) return
      const apiKey = (Deno.env.get('RESEND_API_KEY') || '').trim()
      const from = (Deno.env.get('RESEND_FROM') || 'Atelier GMP <onboarding@resend.dev>').trim()
      const appUrl = (Deno.env.get('APP_URL') || 'https://gmpbordeaux.fr/gmp-projet-atelier/usinage/').trim()
      if (apiKey) {
        const html =
          `<p>Bonjour,</p>` +
          `<p>Le créneau que vous suiviez s'est <b>libéré</b> :</p>` +
          `<p><b>${m}</b> — ${d} — ${s}</p>` +
          `<p>Réservez-le vite (premier arrivé, premier servi) : <a href="${appUrl}">${appUrl}</a></p>` +
          `<p style="color:#888;font-size:.85rem">Message automatique de l'atelier GMP — merci de ne pas répondre.</p>`
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: [email], subject: 'Un créneau machine s\'est libéré', html }),
          })
        } catch (_) { /* on retire l'entrée quand même */ }
      }
      await sb.from('waitlist').delete().match({ machine: m, date: d, slot: s })
    }
    // Prévient l'opérateur par WhatsApp (CallMeBot) qu'une réservation qu'il supervise a été annulée.
    const notifyOperatorCancel = async (m: string, d: string, s: string, bk: any) => {
      if (!bk || !bk.operateur) return
      const { data: op } = await sb.from('operateurs').select('phone, apikey').eq('name', bk.operateur).maybeSingle()
      const phone = (op?.phone ?? '').toString().trim()
      const apikey = (op?.apikey ?? '').toString().trim()
      if (!phone || !apikey) return
      const msg = `Annulation : le créneau ${s} du ${d} sur ${m} (réservé par ${bk.nom || ''} ${bk.prenom || ''}${bk.projet ? ', ' + bk.projet : ''}) a été annulé.`
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(apikey)}`
      try { await fetch(url) } catch (_) {}
    }

    if (action === 'create') {
      if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'badcode' })
      if (!(await free(b.machine, b.date, b.slot))) return json({ ok: false, error: 'occupied' })
      const ins = await sb.from('bookings').insert({ machine: b.machine, date: b.date, slot: b.slot, ...fields(b) })
      if (ins.error) throw ins.error
      await sb.from('booking_pins').upsert({ machine: b.machine, date: b.date, slot: b.slot, pin: (b.pin ?? '').toString() })
      return json({ ok: true })
    }

    if (action === 'verifyPin') {
      return json({ ok: await pinOk(b.machine, b.date, b.slot, b.pin) })
    }

    if (action === 'cancel') {
      if (!(isAdmin || (await pinOk(b.machine, b.date, b.slot, b.pin)))) return json({ ok: false, error: 'auth' })
      // Lire la réservation AVANT suppression (pour prévenir l'opérateur).
      const { data: bkRow } = await sb.from('bookings').select('operateur, nom, prenom, projet').match({ machine: b.machine, date: b.date, slot: b.slot }).maybeSingle()
      await sb.from('bookings').delete().match({ machine: b.machine, date: b.date, slot: b.slot })
      await sb.from('booking_pins').delete().match({ machine: b.machine, date: b.date, slot: b.slot })
      // Notif WhatsApp opérateur : uniquement pour une annulation ÉTUDIANT (PIN), pas admin.
      if (!isAdmin) { try { await notifyOperatorCancel(b.machine, b.date, b.slot, bkRow) } catch (_) {} }
      try { await notifyWaitlist(b.machine, b.date, b.slot) } catch (_) {}
      return json({ ok: true })
    }

    // Liste d'attente : l'étudiant laisse son e-mail sur un créneau OCCUPÉ pour être prévenu (public).
    if (action === 'waitlist-add') {
      const email = (b.email ?? '').toString().trim()
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'bad-email' }, 400)
      const bk = await sb.from('bookings').select('machine').match({ machine: b.machine, date: b.date, slot: b.slot }).maybeSingle()
      if (!bk.data) return json({ ok: false, error: 'not-occupied' })          // libre => pas besoin d'attendre
      const ex = await sb.from('waitlist').select('email').match({ machine: b.machine, date: b.date, slot: b.slot }).maybeSingle()
      if (ex.data) return json({ ok: false, error: 'already-waiting' })         // une seule personne en attente
      const ins = await sb.from('waitlist').insert({ machine: b.machine, date: b.date, slot: b.slot, email })
      if (ins.error) throw ins.error
      return json({ ok: true })
    }

    if (action === 'update') { // même créneau
      if (!isAdmin) {
        if (!(await pinOk(b.machine, b.date, b.slot, b.pin))) return json({ ok: false, error: 'auth' })
        if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'badcode' })
      }
      const up = await sb.from('bookings').update(fields(b)).match({ machine: b.machine, date: b.date, slot: b.slot })
      if (up.error) throw up.error
      return json({ ok: true })
    }

    if (action === 'move') {
      const from = b.from, to = b.to
      if (!isAdmin) {
        if (!(await pinOk(from.machine, from.date, from.slot, b.pin))) return json({ ok: false, error: 'auth' })
        if (!(await opOk(b.opName, b.opCode))) return json({ ok: false, error: 'badcode' })
      }
      if (!(await free(to.machine, to.date, to.slot))) return json({ ok: false, error: 'occupied' })
      const pr = await sb.from('booking_pins').select('pin').match({ machine: from.machine, date: from.date, slot: from.slot }).maybeSingle()
      const keepPin = (pr.data?.pin ?? '').toString()
      const ins = await sb.from('bookings').insert({ machine: to.machine, date: to.date, slot: to.slot, ...fields(b) })
      if (ins.error) throw ins.error
      await sb.from('booking_pins').upsert({ machine: to.machine, date: to.date, slot: to.slot, pin: keepPin })
      await sb.from('bookings').delete().match({ machine: from.machine, date: from.date, slot: from.slot })
      await sb.from('booking_pins').delete().match({ machine: from.machine, date: from.date, slot: from.slot })
      try { await notifyWaitlist(from.machine, from.date, from.slot) } catch (_) {}
      return json({ ok: true })
    }

    if (action === 'restoreState') {
      if (!isAdmin) return json({ ok: false, error: 'unauthorized' }, 401)
      const dates: string[] = b.dates || []
      const snapB = b.bookings || {}, snapD = b.disabled || {}
      for (const d of dates) {
        await sb.from('bookings').delete().eq('date', d)
        await sb.from('booking_pins').delete().eq('date', d)
        await sb.from('disabled_slots').delete().eq('date', d)
      }
      for (const k of Object.keys(snapB)) {
        const p = k.split('|'); if (dates.indexOf(p[1]) < 0) continue
        const r = snapB[k]
        await sb.from('bookings').insert({ machine: p[0], date: p[1], slot: p[2], ...fields(r) })
        await sb.from('booking_pins').upsert({ machine: p[0], date: p[1], slot: p[2], pin: (r.pin ?? '').toString() })
      }
      for (const k of Object.keys(snapD)) {
        const p = k.split('|'); if (dates.indexOf(p[1]) < 0) continue
        const r = snapD[k]
        await sb.from('disabled_slots').insert({ machine: p[0], date: p[1], slot: p[2], reason: (r && r.reason) || '' })
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'bad action' }, 400)
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
