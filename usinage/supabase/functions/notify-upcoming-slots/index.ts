import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Heure de début d'un créneau (minutes depuis minuit) déduite de son libellé.
// Gère "08h-12h", "08h-09h", "14h-16h", "08h30-09h30"… (les tailles 1 h / 2 h / 4 h sont toutes couvertes).
function slotStartMin(slot: string): number {
  const m = String(slot).match(/^(\d{1,2})h(\d{2})?/)
  if (!m) return -1
  return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0)
}

Deno.serve(async () => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Heure actuelle en heure de Paris (gère UTC+1 hiver / UTC+2 été automatiquement)
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]))
  const today = `${parts.year}-${parts.month}-${parts.day}`
  const nowMin = parseInt(parts.hour) * 60 + parseInt(parts.minute)

  // Charger les opérateurs avec leur numéro et clé API CallMeBot
  const { data: ops, error: opsErr } = await sb.from('operateurs').select('name, phone, apikey')
  if (opsErr) return new Response(JSON.stringify({ error: opsErr.message }), { status: 500 })

  const opMap: Record<string, { phone: string; apikey: string }> =
    Object.fromEntries((ops || []).map((o: any) => [o.name, o]))

  // Toutes les réservations du jour : on calcule l'heure de début à partir du libellé du créneau,
  // ce qui fonctionne quelle que soit la taille de créneau de la machine (1 h, 2 h ou 4 h).
  const { data: bookings, error: bookErr } = await sb
    .from('bookings')
    .select('machine, slot, nom, prenom, operateur, projet')
    .eq('date', today)

  if (bookErr) return new Response(JSON.stringify({ error: bookErr.message }), { status: 500 })

  const notified: string[] = []

  for (const b of (bookings || []) as any[]) {
    const startMin = slotStartMin(b.slot)
    if (startMin < 0) continue

    // Exactement 20 minutes avant le début du créneau (1 seul envoi par exécution planifiée)
    if (startMin - nowMin !== 20) continue

    const op = opMap[b.operateur]
    if (!op?.phone || !op?.apikey) continue

    const msg =
      `Rappel : votre créneau ${b.slot} sur ${b.machine} commence dans 20 min. ` +
      `Réservé par ${b.nom} ${b.prenom} (${b.projet}).`

    const url =
      `https://api.callmebot.com/whatsapp.php` +
      `?phone=${encodeURIComponent(op.phone)}` +
      `&text=${encodeURIComponent(msg)}` +
      `&apikey=${encodeURIComponent(op.apikey)}`

    await fetch(url)
    notified.push(`${b.machine} / ${b.slot} → ${b.operateur}`)
  }

  return new Response(JSON.stringify({ ok: true, heureParis: `${parts.hour}:${parts.minute}`, notified }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
