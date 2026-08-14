/**
 * ÖLÇÜM — AZG tavan aşımı: SATIR ekseni (bugünkü panel) vs ŞOFÖR-GÜN ekseni
 * (AZG PDF'i, app/actions/azg-report.ts:288-297). Salt okuma.
 * ADIM 1'in ön koşulu: HAK61'de rakam değişiyor mu?
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const KOK = "C:/Users/90553/Desktop/business/hak-transport-takip";
function env(f) { const o = {}; for (const l of readFileSync(`${KOK}/${f}`, "utf8").split(/\r?\n/)) { const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(l.trim()); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ""); } return o; }
const db = (e) => createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TZ = "Europe/Vienna", H = 3600_000;
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const workedMs = (e) => Math.max(0, new Date(e.ended_at ?? Date.now()).getTime() - new Date(e.started_at).getTime() - (e.break_minutes ?? 0) * 60_000);
// lib/azg-rules.ts touchesNightWindow — pencere gün başı + [0h,4h)
function gece(s, en) {
  const st = new Date(s).getTime(), e2 = new Date(en ?? Date.now()).getTime();
  if (!(e2 > st)) return false;
  for (let t = st; t < e2 + 15 * 60_000; t += 15 * 60_000) {
    const tt = Math.min(t, e2 - 1);
    const h = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date(tt)) % 24;
    if (h < 4) return true;
  }
  return false;
}
const cap = (n) => (n ? 10 * H : 12 * H);

async function olc(ad, dosya) {
  const c = db(env(dosya));
  const { data } = await c.from("time_entries")
    .select("id, worker_id, started_at, ended_at, break_minutes")
    .gte("started_at", new Date(Date.now() - 120 * 24 * H).toISOString());
  const e = data ?? [];
  // SATIR ekseni (bugünkü panel)
  const satir = e.filter((x) => workedMs(x) > cap(gece(x.started_at, x.ended_at)));
  // ŞOFÖR-GÜN ekseni (önerilen)
  const m = new Map();
  for (const x of e) {
    if (!x.worker_id) continue;
    const k = `${x.worker_id}|${dayKey(x.started_at)}`;
    const a = m.get(k) ?? { ms: 0, gece: false, ids: [] };
    a.ms += workedMs(x); if (gece(x.started_at, x.ended_at)) a.gece = true; a.ids.push(x.id);
    m.set(k, a);
  }
  const asanGun = [...m.entries()].filter(([, a]) => a.ms > cap(a.gece));
  const gunIds = new Set(asanGun.flatMap(([, a]) => a.ids));
  const cokSatirli = [...m.values()].filter((a) => a.ids.length > 1).length;
  console.log(`\n══ ${ad} ══  (son 120 gün, ${e.length} vardiya)`);
  console.log(`  SATIR ekseni  · aşan vardiya sayısı        : ${satir.length}`);
  console.log(`  ŞOFÖR-GÜN eks · aşan şoför-gün sayısı      : ${asanGun.length}`);
  console.log(`  ŞOFÖR-GÜN eks · aşan güne ait vardiya sayısı: ${gunIds.size}   ← kart/tablo rozeti bu sayıyı kullanır`);
  console.log(`  çok vardiyalı şoför-gün                     : ${cokSatirli}`);
  const sIds = new Set(satir.map((x) => x.id));
  const yeni = [...gunIds].filter((id) => !sIds.has(id));
  const dusen = [...sIds].filter((id) => !gunIds.has(id));
  console.log(`  FARK: yeni işaretlenen ${yeni.length}, işaretten çıkan ${dusen.length}`);
  return { satir: satir.length, gun: asanGun.length, ids: gunIds.size, yeni: yeni.length, dusen: dusen.length };
}
await olc("HAK61", ".env.local");
await olc("SENDIGO", ".env.sendigo");
