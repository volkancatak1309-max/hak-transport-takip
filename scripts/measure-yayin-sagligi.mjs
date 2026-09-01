#!/usr/bin/env node
/**
 * YAYIN SAĞLIĞI — dağıtım ÖNCESİ/SONRASI karşılaştırma (SALT OKUMA).
 *
 * Tek soru: dağıtım telemetri akışını kesti mi? "Deploy başarılı" demek yetmez —
 * flespi akışı uygulamadan bağımsız görünse de `/api/flespi/sync` cron'u
 * uygulamanın İÇİNDE koşuyor; kırılırsa akış sessizce durur ve bu ancak
 * saatler sonra "araçlar haritada donmuş" diye fark edilir.
 *
 * Ölçülen üç şey (HAK61, hepsi SELECT):
 *   1. Son telemetri satırının yaşı — akış canlı mı?
 *   2. Son 60 dk / 15 dk satır sayısı ve kaç ayrı araç — hangi ölçekte?
 *   3. En yeni satırın `ingested_at` gecikmesi — geç mi düşüyor?
 *
 * ⚠️ SALT OKUMA. Plaka basılmaz, yalnız araç SAYISI.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/measure-yayin-sagligi.mjs
 *   ENV_FILE=.env.sendigo … (ikinci kiracı için)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const dosya = process.env.ENV_FILE ?? ".env.local";
const env = Object.fromEntries(
  readFileSync(dosya, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const simdi = Date.now();
const once = (dk) => new Date(simdi - dk * 60_000).toISOString();

// 1 · en yeni satır
const { data: sonSatir, error: e1 } = await sb
  .from("device_telemetry")
  .select("recorded_at, ingested_at")
  .order("recorded_at", { ascending: false })
  .limit(1);
if (e1) {
  console.error("HATA:", e1.message);
  process.exit(1);
}
const son = sonSatir?.[0];

/**
 * 2 · pencereler.
 *
 * ⚠️ SATIR SAYISI `count: "exact", head: true` İLE ALINIR, dizi uzunluğuyla
 * DEĞİL. PostgREST her sorguyu sunucu tarafında 1000 satırda keser — `.limit()`
 * verilse bile. İlk yazımda tam bu tuzağa düşüldü: 60 dakikalık pencere "1000
 * satır · 13 araç" dedi, 15 dakikalık pencere ise "899 satır · 16 araç".
 * 60 dakikada 15 dakikadan AZ araç görünmesi imkânsız — kırpma buydu.
 * (Aynı kusur bu depoda bir kez daha yaşandı: 14 günlük depo-geliş ortalaması
 * fiilen tek kısmi günden hesaplanıyordu.)
 *
 * Araç sayısı yine sayfalı okumadan geliyor; kırpıldıysa AÇIKÇA söylenir —
 * sessiz bir alt sınır, "yeterli" diye okunacak bir sayıdan iyidir.
 */
const SAYFA_TAVANI = 1000;
async function pencere(dk) {
  const bas = once(dk);
  const { count, error: eSay } = await sb
    .from("device_telemetry")
    .select("*", { count: "exact", head: true })
    .gte("recorded_at", bas);
  if (eSay) return { hata: eSay.message };

  const { data, error } = await sb
    .from("device_telemetry")
    .select("vehicle_id")
    .gte("recorded_at", bas);
  if (error) return { hata: error.message };
  return {
    satir: count,
    arac: new Set(data.map((r) => r.vehicle_id)).size,
    aracKirpik: data.length >= SAYFA_TAVANI,
  };
}
const p60 = await pencere(60);
const p15 = await pencere(15);

const yasSn = son ? Math.round((simdi - new Date(son.recorded_at).getTime()) / 1000) : null;
const gecikmeSn =
  son?.ingested_at
    ? Math.round((new Date(son.ingested_at).getTime() - new Date(son.recorded_at).getTime()) / 1000)
    : null;

console.log(`── FLESPİ AKIŞI · ${dosya} · ${new Date(simdi).toISOString()} ──`);
console.log(`son telemetri satırı      : ${son?.recorded_at ?? "YOK"}`);
console.log(`  yaşı                    : ${yasSn === null ? "—" : `${yasSn} sn (${(yasSn / 60).toFixed(1)} dk)`}`);
console.log(`  yutulma gecikmesi       : ${gecikmeSn === null ? "—" : `${gecikmeSn} sn`}`);
const yaz = (ad, p) =>
  console.log(
    `${ad.padEnd(26)}: ${p.satir ?? p.hata} satır · ` +
      `${p.arac ?? "—"} araç${p.aracKirpik ? " (⚠ araç sayımı 1000 satırda KIRPILDI — alt sınır)" : ""}`
  );
yaz("son 60 dk", p60);
yaz("son 15 dk", p15);
console.log(
  `\nAKIŞ: ${yasSn !== null && yasSn < 1800 ? "✓ CANLI (son satır 30 dk içinde)" : "⚠ SON SATIR 30 DK'DAN ESKİ — incele"}`
);
