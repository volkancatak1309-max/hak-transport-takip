/**
 * ÖLÇÜM — gün sınırı 00:00 → 04:00 (Viyana) kaydırılırsa ne değişir?
 * Salt okuma. İki tenant: HAK61 (.env.local) + SENDIGO (.env.sendigo).
 *
 * Gün anahtarı iki tanımla hesaplanır ve KARŞILAŞTIRILIR:
 *   D0  = viennaDayKey(started_at)                    (bugünkü kural)
 *   D4  = viennaDayKey(started_at - 4 saat)           (önerilen kural)
 * "4 saat çıkar sonra takvim gününü al" tanımı, gün sınırını 04:00'e almanın
 * birebir karşılığıdır (DST dahil: çıkarma mutlak, biçimlendirme dilimlidir).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const KOK = "C:/Users/90553/Desktop/business/hak-transport-takip";
function env(dosya) {
  const o = {};
  for (const line of readFileSync(`${KOK}/${dosya}`, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
function db(e) {
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
const TZ = "Europe/Vienna";
const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const dayKey4 = (iso) => new Date(new Date(iso).getTime() - 4 * 3600_000)
  .toLocaleDateString("en-CA", { timeZone: TZ });
const saat = (iso) =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));
const saatNum = (iso) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso));
  const h = +p.find((x) => x.type === "hour").value % 24;
  const m = +p.find((x) => x.type === "minute").value;
  return h + m / 60;
};
const H = 3600_000;
const AZG = { gunduz: 12 * H, gece: 10 * H };
// touchesNightWindow: pencere [gün başı+0h, gün başı+4h) = 00:00-04:00 duvar saati
function geceyeDegiyorMu(s, e) {
  const st = new Date(s).getTime();
  const en = new Date(e ?? Date.now()).getTime();
  if (!(en > st)) return false;
  // duvar saati 00:00-04:00 aralığıyla kesişim (mutlak saat ekseninde tara)
  for (let t = st; t <= en; t += 15 * 60_000) {
    const h = saatNum(new Date(t).toISOString());
    if (h < 4 && new Date(t).getTime() >= st && new Date(t).getTime() < en) return true;
  }
  return saatNum(new Date(en).toISOString()) < 4 && en > st;
}
const workedMs = (e) =>
  (new Date(e.ended_at ?? Date.now()).getTime() - new Date(e.started_at).getTime()) -
  (e.break_minutes ?? 0) * 60_000;

const B = (s) => `\n${"═".repeat(74)}\n  ${s}\n${"═".repeat(74)}`;

async function tenant(ad, dosya) {
  console.log(B(ad));
  const c = db(env(dosya));
  const simdi = Date.now();
  const gun30 = new Date(simdi - 30 * 24 * H).toISOString();
  const gun120 = new Date(simdi - 120 * 24 * H).toISOString();

  const { data: workers } = await c.from("workers").select("id, name, is_test");
  const ad_ = (id) => workers?.find((w) => w.id === id)?.name ?? id?.slice(0, 8) ?? "—";

  // ── son 120 gün (AZG geçmiş ayları da kapsasın) ──────────────────────────
  const { data: tum } = await c
    .from("time_entries")
    .select("id, worker_id, started_at, ended_at, break_minutes, plate, start_km, end_km")
    .gte("started_at", gun120)
    .order("started_at");
  const son30 = (tum ?? []).filter((e) => e.started_at >= gun30);

  console.log(`\nson 120 gün vardiya: ${tum?.length ?? 0}   |   son 30 gün: ${son30.length}`);

  // ── 1) Kaç vardiya farklı güne kayar? ───────────────────────────────────
  const kayan120 = (tum ?? []).filter((e) => dayKey(e.started_at) !== dayKey4(e.started_at));
  const kayan30 = son30.filter((e) => dayKey(e.started_at) !== dayKey4(e.started_at));
  console.log(`\n── 1 · GÜN DEĞİŞTİREN VARDİYALAR (başlangıcı 00:00-03:59) ──`);
  console.log(`son 30 gün : ${kayan30.length} / ${son30.length}  (%${son30.length ? (100 * kayan30.length / son30.length).toFixed(1) : 0})`);
  console.log(`son 120 gün: ${kayan120.length} / ${tum?.length ?? 0}  (%${tum?.length ? (100 * kayan120.length / tum.length).toFixed(1) : 0})`);
  for (const e of kayan120.slice(0, 25)) {
    console.log(`   ${ad_(e.worker_id)}  ${dayKey(e.started_at)} ${saat(e.started_at)} → D0=${dayKey(e.started_at)}  D4=${dayKey4(e.started_at)}  (${e.plate ?? "—"})`);
  }

  // ── 2) Başlangıç saati dağılımı ────────────────────────────────────────
  console.log(`\n── 2 · BAŞLANGIÇ SAATİ DAĞILIMI (son 120 gün, Viyana) ──`);
  const kova = new Array(24).fill(0);
  for (const e of tum ?? []) kova[Math.floor(saatNum(e.started_at))]++;
  for (let h = 0; h < 24; h++) {
    if (!kova[h]) continue;
    const isaret = h < 4 ? "  ← 04:00 sınırında ÖNCEKİ güne kayar" : "";
    console.log(`   ${String(h).padStart(2, "0")}:00  ${String(kova[h]).padStart(4)}  ${"█".repeat(Math.min(40, kova[h]))}${isaret}`);
  }

  // ── 3) AZG: şoför-gün toplamları iki tanımda ───────────────────────────
  console.log(`\n── 3 · AZG ŞOFÖR-GÜN TOPLAMLARI (son 120 gün, yalnız KAPALI vardiya) ──`);
  const kapali = (tum ?? []).filter((e) => e.ended_at);
  function azgGunler(keyFn) {
    const m = new Map();
    for (const e of kapali) {
      const k = `${e.worker_id}|${keyFn(e.started_at)}`;
      const a = m.get(k) ?? { ms: 0, n: 0, gece: false };
      a.ms += workedMs(e);
      a.n += 1;
      if (geceyeDegiyorMu(e.started_at, e.ended_at)) a.gece = true;
      m.set(k, a);
    }
    return m;
  }
  const g0 = azgGunler(dayKey), g4 = azgGunler(dayKey4);
  const ihlal = (m) => [...m.entries()].filter(([, a]) => a.ms > (a.gece ? AZG.gece : AZG.gunduz));
  const i0 = ihlal(g0), i4 = ihlal(g4);
  console.log(`şoför-gün kovası     : D0=${g0.size}   D4=${g4.size}   (fark ${g4.size - g0.size})`);
  console.log(`çok vardiyalı gün    : D0=${[...g0.values()].filter((a) => a.n > 1).length}   D4=${[...g4.values()].filter((a) => a.n > 1).length}`);
  console.log(`GÜNLÜK TAVAN İHLALİ  : D0=${i0.length}   D4=${i4.length}   ← yasal belgede DEĞİŞEN RAKAM`);
  const set0 = new Set(i0.map(([k]) => k)), set4 = new Set(i4.map(([k]) => k));
  const yeni = i4.filter(([k]) => !set0.has(k)), kalkan = i0.filter(([k]) => !set4.has(k));
  for (const [k, a] of yeni.slice(0, 15)) {
    const [w, d] = k.split("|");
    console.log(`   + YENİ İHLAL  ${ad_(w)}  ${d}  ${(a.ms / H).toFixed(2)} sa (${a.n} vardiya, tavan ${(a.gece ? 10 : 12)} sa)`);
  }
  for (const [k, a] of kalkan.slice(0, 15)) {
    const [w, d] = k.split("|");
    console.log(`   − KALKAN İHLAL ${ad_(w)}  ${d}  ${(a.ms / H).toFixed(2)} sa (${a.n} vardiya)`);
  }

  // ── 4) Gün toplamı DEĞİŞEN şoför-günler (rapor rakamı kayar) ───────────
  const degisen = [];
  for (const [k, a] of g0) {
    const b = g4.get(k);
    if (!b || Math.abs(b.ms - a.ms) > 60_000) degisen.push(k);
  }
  console.log(`\n── 4 · GÜN TOPLAMI DEĞİŞEN şoför-gün: ${degisen.length} / ${g0.size} ──`);

  // ── 5) Bugün ve "şu an" ──────────────────────────────────────────────
  console.log(`\n── 5 · BUGÜN ──`);
  const bugunD0 = dayKey(new Date().toISOString()), bugunD4 = dayKey4(new Date().toISOString());
  console.log(`şu an: ${saat(new Date().toISOString())}  |  D0 günü=${bugunD0}  D4 günü=${bugunD4}`);
  const bugun0 = (tum ?? []).filter((e) => dayKey(e.started_at) === bugunD0);
  const bugun4 = (tum ?? []).filter((e) => dayKey4(e.started_at) === bugunD4);
  console.log(`"bugün açılan vardiya": D0=${bugun0.length}  D4=${bugun4.length}`);

  // ── 6) 00:00-04:00 arasında ÇALIŞAN (açık vardiyası olan) şoförler ────
  console.log(`\n── 6 · GECE 00:00-04:00 PENCERESİNE DEĞEN VARDİYALAR (son 120 gün) ──`);
  const geceDegen = kapali.filter((e) => geceyeDegiyorMu(e.started_at, e.ended_at));
  const geceSoforleri = new Map();
  for (const e of geceDegen) geceSoforleri.set(e.worker_id, (geceSoforleri.get(e.worker_id) ?? 0) + 1);
  console.log(`gece penceresine değen vardiya: ${geceDegen.length} / ${kapali.length}`);
  for (const [w, n] of [...geceSoforleri.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${ad_(w)}  ${n} vardiya`);
  }

  return { kayan30: kayan30.length, son30: son30.length, i0: i0.length, i4: i4.length, degisen: degisen.length };
}

const h = await tenant("HAK61  (.env.local)", ".env.local");
const s = await tenant("SENDIGO  (.env.sendigo)", ".env.sendigo");

console.log(B("ÖZET"));
console.log(`HAK61   son 30 gün gün değiştiren vardiya: ${h.kayan30}/${h.son30}  |  AZG ihlal D0=${h.i0} → D4=${h.i4}  |  toplamı değişen şoför-gün: ${h.degisen}`);
console.log(`SENDIGO son 30 gün gün değiştiren vardiya: ${s.kayan30}/${s.son30}  |  AZG ihlal D0=${s.i0} → D4=${s.i4}  |  toplamı değişen şoför-gün: ${s.degisen}`);
