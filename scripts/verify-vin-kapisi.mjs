#!/usr/bin/env node
/**
 * VIN KAPISI — ÜÇ DURUM KANITI. 🔴 SALT OKUMA, HİÇBİR ŞEY YAZMAZ.
 *
 * `app/api/flespi/sync/route.ts` içindeki karar satırı:
 *     if (vin && v.vin === null) { await maybeBackfillVin(v.id, vin); }
 *
 * Bu betik o kararı CANLI araç satırları üzerinde koşturur ve
 * ÖNCE (koşulsuz) / SONRA (iki kapılı) istek sayısını basar.
 * Tek satır bile yazmaz: yalnız `vehicles` okur.
 *
 * Kullanım:
 *   node scripts/verify-vin-kapisi.mjs            # HAK61 (.env.local)
 *   node scripts/verify-vin-kapisi.mjs .env.sendigo
 */
import { readFileSync } from "node:fs";

const ENV_DOSYA = process.argv[2] ?? ".env.local";

function env(p) {
  const o = {};
  for (const satir of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(satir.trim());
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}

const e = env(ENV_DOSYA);
const URL_ = e.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}` };

/** Sync turunun giriş sorgusunun BİREBİR aynısı (route.ts:64). */
const r = await fetch(
  `${URL_}/rest/v1/vehicles?select=id,plate,flespi_device_id,assigned_worker_id,vin&flespi_device_id=not.is.null`,
  { headers: H }
);
if (!r.ok) {
  console.error(`🔴 giriş sorgusu HTTP ${r.status} — 'vin' kolonu bu kiracıda YOK olabilir`);
  process.exit(1);
}
const araclar = await r.json();

/** ÖNCE: koşul yalnız cihazın VIN gönderip göndermediğine bakıyordu. */
const once = (v, cihazVin) => Boolean(cihazVin);
/** SONRA: cihaz VIN gönderdi VE bellekteki değer null. */
const sonra = (v, cihazVin) => Boolean(cihazVin) && v.vin === null;

console.log(`\n╔══ VIN KAPISI · ÜÇ DURUM (salt okuma) ══════════════════════════`);
console.log(`║ kaynak ${ENV_DOSYA} · ${URL_}`);
console.log(`║ an     ${new Date().toISOString()}`);
console.log(`║ cihazlı araç ${araclar.length} · vin DOLU ${araclar.filter((v) => v.vin !== null).length} · vin NULL ${araclar.filter((v) => v.vin === null).length}`);

const bosArac = araclar.find((v) => v.vin === null) ?? null;
const doluArac = araclar.find((v) => v.vin !== null) ?? null;

const durumlar = [
  {
    ad: "a) DB'de vin NULL · cihaz vin gönderiyor",
    beklenen: "YAZILMALI",
    arac: bosArac ?? { id: "sentetik", plate: "(sentetik)", vin: null },
    cihazVin: "WVWZZZ1JZXW000001",
    sentetik: bosArac === null,
  },
  {
    ad: "b) DB'de vin DOLU · cihaz vin gönderiyor",
    beklenen: "İSTEK GİTMEMELİ",
    arac: doluArac,
    cihazVin: doluArac?.vin ?? "WVWZZZ1JZXW000001",
    sentetik: false,
  },
  {
    ad: "c) DB'de vin NULL · cihaz vin GÖNDERMİYOR",
    beklenen: "İSTEK GİTMEMELİ",
    arac: bosArac ?? { id: "sentetik", plate: "(sentetik)", vin: null },
    cihazVin: null,
    sentetik: bosArac === null,
  },
];

console.log(`\n  durum                                        | önce | sonra | beklenen        | sonuç`);
console.log(`  ---------------------------------------------+------+-------+-----------------+------`);
let hata = 0;
for (const d of durumlar) {
  if (!d.arac) { console.log(`  ${d.ad.padEnd(44)} | — bu kiracıda örnek satır yok`); continue; }
  const o = once(d.arac, d.cihazVin);
  const s = sonra(d.arac, d.cihazVin);
  const gecti = d.beklenen === "YAZILMALI" ? s === true : s === false;
  if (!gecti) hata++;
  console.log(
    `  ${d.ad.padEnd(44)} | ${(o ? "GİT" : "yok").padStart(4)} | ${(s ? "GİT" : "yok").padStart(5)} |` +
      ` ${d.beklenen.padEnd(15)} | ${gecti ? "✓" : "🔴 KALDI"}${d.sentetik ? "  (sentetik satır)" : ""}`
  );
}

// ── TUR BAŞINA İSTEK: gerçek kadro üzerinden ────────────────────────────────
// "Cihaz VIN gönderiyor" en kötü hâl kabul edilir (her araç gönderiyor).
const oncekiIstek = araclar.filter((v) => once(v, "X")).length;
const sonrakiIstek = araclar.filter((v) => sonra(v, "X")).length;
console.log(`\n  EN KÖTÜ HÂL (her araç VIN gönderiyor varsayımıyla):`);
console.log(`    önce : ${oncekiIstek} UPDATE/tur`);
console.log(`    sonra: ${sonrakiIstek} UPDATE/tur`);

if (hata > 0) {
  console.error(`\n🔴 ${hata} durum beklendiği gibi davranmadı.`);
  process.exit(1);
}
console.log(`\n✓ üç durumun üçü de beklendiği gibi.\n`);
