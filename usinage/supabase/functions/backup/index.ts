// Edge Function : backup
// Sauvegarde QUOTIDIENNE de toutes les tables dans un fichier JSON, déposé sur Google Drive
// (sous-dossier "backups", fichier PRIVÉ, purge automatique des backups de plus de 15 jours).
// Déclenchée par un GitHub Actions cron (voir .github/workflows/backup.yml).
//
// Secrets attendus :
//   BACKUP_TOKEN      : jeton partagé avec le workflow (empêche un déclenchement non autorisé)
//   APPS_SCRIPT_URL   : l'URL /exec du Google Apps Script (le même que l'impression 3D)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY : fournis automatiquement par Supabase
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
// Base64 d'une chaîne UTF-8 (btoa ne gère pas l'unicode directement).
function toB64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

// Toutes les tables à sauvegarder.
const TABLES = [
  'bookings', 'booking_pins', 'disabled_slots', 'machines',
  'operateurs', 'etudiants', 'parametres',
  'demandes', 'demande_contacts', 'waitlist', 'carousel_pages',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const b = await req.json().catch(() => ({}))
    // Auth : jeton partagé (le workflow le fournit).
    const token = (Deno.env.get('BACKUP_TOKEN') || '').trim()
    if (!token || (b.token ?? '').toString() !== token) return json({ ok: false, error: 'auth' }, 401)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appsUrl = (Deno.env.get('APPS_SCRIPT_URL') || '').trim()
    if (!appsUrl) return json({ ok: false, error: 'no-apps-script-url' }, 500)

    // Dump de chaque table.
    const dump: any = { generatedAt: new Date().toISOString(), tables: {} }
    const counts: Record<string, number | string> = {}
    for (const t of TABLES) {
      const { data, error } = await sb.from(t).select('*')
      if (error) { dump.tables[t] = { error: error.message }; counts[t] = 'err' }
      else { dump.tables[t] = data || []; counts[t] = (data || []).length }
    }

    // Envoi sur Drive (sous-dossier backups, fichier privé, purge > 15 jours, écrase le fichier du jour).
    const today = new Date().toISOString().slice(0, 10)
    const dataB64 = toB64(JSON.stringify(dump))
    const resp = await fetch(appsUrl, {
      method: 'POST',
      body: JSON.stringify({
        name: `backup-${today}.json`,
        mimeType: 'application/json',
        dataB64,
        subfolder: 'backups',
        purgeOlderThanDays: 15,
        private: true,
        replaceByName: true,
      }),
    })
    const drive = await resp.json().catch(() => ({}))
    if (!drive.ok) return json({ ok: false, error: 'drive-failed', drive, counts }, 502)
    return json({ ok: true, file: `backup-${today}.json`, counts })
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500)
  }
})
