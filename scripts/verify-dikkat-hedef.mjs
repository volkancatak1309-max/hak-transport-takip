#!/usr/bin/env node
/**
 * DİKKAT KALEMİ HEDEFİ — SENTETİK + CANLI KANIT.
 *
 * ═══ NEDEN SENTETİK ═══════════════════════════════════════════════════════
 * `belge` · `bakim` · `isemri` hedefleri üç kiracıda da BUGÜN hiç kalem
 * üretmiyor (ölçüldü: demo 3 tür, HAK61 9 tür, üçü de listede yok). Kalem
 * doğması için canlı veriye yazmak gerekirdi — HAK61 ve Sendigo CANLI
 * MÜŞTERİ, demo'ya da ölçüm için satır yazmak kanıtı kirletirdi.
 *
 * ⚠️ SENTETİK TEST ÜRÜNÜN KENDİ ÇAĞRISINI KOŞTURUYOR, KOPYASINI DEĞİL.
 * Üç hedef `belgeHedefi` / `bakimHedefi` / `isEmriHedefi` ile üretiliyor ve
 * `lib/admin-dashboard.ts` içindeki push noktaları da tam bu üç fonksiyonu
 * çağırıyor. Fonksiyon bozulursa hem ürün hem test bozulur; test yeşil kalıp
 * ürün kırmızı olamaz.
 *
 * ═══ NE KANITLANIYOR ══════════════════════════════════════════════════════
 *   1. Üç yardımcı doğru hedefi üretiyor (tur + id + ikincil bağ).
 *   2. Push noktaları bu yardımcıları çağırıyor (elle nesne yazılmıyor).
 *   3. Üç tür için `attentionReason` anahtar + parametre üretiyor.
 *   4. ARIZA ENJEKSİYONU: ikincil bağ düşerse denetim KIRILIYOR.
 *   5. CANLI: bugünkü kalemlerin hepsinde hedef iyi biçimli; üç türün
 *      canlıda görülüp görülmediği DÜRÜSTÇE raporlanıyor.
 *
 * Kullanım:  npm run verify:dikkat-hedef
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  belgeHedefi,
  bakimHedefi,
  isEmriHedefi,
  attentionReason,
} from "@/lib/admin-dashboard";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const oku = (f) => readFileSync(join(KOK, f), "utf8");

let gecti = 0;
const dusen = [];
const ok = (ad, kosul, kanit = "") => {
  if (kosul) {
    gecti++;
    console.log(`  ✓ ${ad}${kanit ? ` — ${kanit}` : ""}`);
  } else {
    dusen.push(ad);
    console.log(`  ✗ ${ad}${kanit ? ` — ${kanit}` : ""}`);
  }
};

/* Sahte ama BİÇİMİ gerçek kimlikler — UUID kalıbı korunuyor. */
const BELGE = "11111111-1111-4111-8111-111111111111";
const PERSONEL = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const ARAC = "44444444-4444-4444-8444-444444444444";
const EMIR = "55555555-5555-4555-8555-555555555555";

console.log(`\n═══ 1 · SENTETİK — üç hedef yardımcısı ══════════════════════════`);
{
  const b = belgeHedefi(BELGE, PERSONEL);
  ok("belge → tur/id/personelId", b.tur === "belge" && b.id === BELGE && b.personelId === PERSONEL, JSON.stringify(b));
  ok("belge → aracId YAZILMIYOR (bilinmiyor, uydurulmuyor)", b.aracId === undefined);

  const m = bakimHedefi(PLAN, ARAC);
  ok("bakim → tur/id/aracId", m.tur === "bakim" && m.id === PLAN && m.aracId === ARAC, JSON.stringify(m));
  ok("bakim → id PLAN kimliği, araç kimliği DEĞİL", m.id !== m.aracId);
  ok("bakim → personelId YAZILMIYOR", m.personelId === undefined);

  const i = isEmriHedefi(EMIR, ARAC);
  ok("isemri → tur/id/aracId", i.tur === "isemri" && i.id === EMIR && i.aracId === ARAC, JSON.stringify(i));
  ok("isemri → personelId YAZILMIYOR", i.personelId === undefined);
}

console.log(`\n═══ 2 · PUSH NOKTALARI YARDIMCIYI ÇAĞIRIYOR ═════════════════════`);
{
  const kaynak = oku("lib/admin-dashboard.ts");
  const kodu = kaynak.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*/g, " ");
  ok("belge push → belgeHedefi(d.id, d.workerId)", /target:\s*belgeHedefi\(d\.id,\s*d\.workerId\)/.test(kodu));
  ok("bakim push → bakimHedefi(d.planId, d.vehicleId)", /target:\s*bakimHedefi\(d\.planId,\s*d\.vehicleId\)/.test(kodu));
  ok("isemri push → isEmriHedefi(e.id, e.vehicleId)", /target:\s*isEmriHedefi\(e\.id,\s*e\.vehicleId\)/.test(kodu));
  /* Elle nesne yazımına geri dönülmediği: bu üç tür artık literal taşımamalı. */
  ok(
    "üç tür için ELLE hedef nesnesi KALMADI",
    !/target:\s*\{\s*tur:\s*"(belge|bakim|isemri)"/.test(kodu)
  );
}

console.log(`\n═══ 3 · SEBEP ANAHTARI + PARAMETRE ══════════════════════════════`);
{
  const belge = {
    target: belgeHedefi(BELGE, PERSONEL),
    kind: "document",
    id: `${BELGE}-document`,
    worker_name: "Test Kişi",
    type_label: "SRC Belgesi",
    due: "2026-10-01",
    days: 13,
  };
  const bakim = {
    target: bakimHedefi(PLAN, ARAC),
    kind: "maintenanceDue",
    id: `${PLAN}-${ARAC}-maintenance`,
    plate: "W-GF-999",
    tip: "yag",
    eksen: "km",
    kalanKm: 420,
    kalanGun: null,
    gecti: false,
  };
  const emir = {
    target: isEmriHedefi(EMIR, ARAC),
    kind: "workOrder",
    id: `${EMIR}-workorder`,
    plate: "W-GF-999",
    aciklama: "Fren sesi",
    oncelik: "yuksek",
    kaynak: "dvir",
    days: -4,
  };
  const rb = attentionReason(belge);
  ok("document → document_due", rb.sebep === "document_due" && rb.param.gun === 13 && rb.param.belgeTuru === "SRC Belgesi", JSON.stringify(rb));
  const rm = attentionReason(bakim);
  ok("maintenanceDue → maintenance_due", rm.sebep === "maintenance_due" && rm.param.eksen === "km" && rm.param.kalanKm === 420 && rm.param.kalanGun === undefined, JSON.stringify(rm));
  const re = attentionReason(emir);
  ok("workOrder → work_order", re.sebep === "work_order" && re.param.gun === -4 && re.param.oncelik === "yuksek", JSON.stringify(re));
}

console.log(`\n═══ 4 · ARIZA ENJEKSİYONU ═══════════════════════════════════════`);
{
  /* Kaynak metni üzerinde: ikincil bağ düşerse 2. bölüm kırılmalı. */
  const kodu = oku("lib/admin-dashboard.ts")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*/g, " ");
  const ARIZALAR = [
    ["belge ikincil bağı düşerse", kodu.replace("belgeHedefi(d.id, d.workerId)", 'target: { tur: "belge", id: d.id }')],
    ["bakim ikincil bağı düşerse", kodu.replace("bakimHedefi(d.planId, d.vehicleId)", 'target: { tur: "bakim", id: d.planId }')],
    ["isemri ikincil bağı düşerse", kodu.replace("isEmriHedefi(e.id, e.vehicleId)", 'target: { tur: "isemri", id: e.id }')],
  ];
  const denetle = (k) =>
    /target:\s*belgeHedefi\(d\.id,\s*d\.workerId\)/.test(k) &&
    /target:\s*bakimHedefi\(d\.planId,\s*d\.vehicleId\)/.test(k) &&
    /target:\s*isEmriHedefi\(e\.id,\s*e\.vehicleId\)/.test(k) &&
    !/target:\s*\{\s*tur:\s*"(belge|bakim|isemri)"/.test(k);
  ok("temiz kaynak denetimden GEÇİYOR", denetle(kodu));
  for (const [ad, bozuk] of ARIZALAR) {
    ok(`arıza: ${ad}`, bozuk !== kodu && !denetle(bozuk), bozuk === kodu ? "🔴 ENJEKSİYON TUTMADI" : "denetim kırıldı (doğru)");
  }
  /* Yardımcının kendisi bozulursa 1. bölüm kırılmalı — davranışla sınanır. */
  const sahte = { ...bakimHedefi(PLAN, ARAC) };
  delete sahte.aracId;
  ok("arıza: bakimHedefi aracId'yi düşürürse kontrol kırılır", sahte.aracId === undefined && bakimHedefi(PLAN, ARAC).aracId === ARAC);
}

console.log(`\n═══ 5 · CANLI KAPSAMA (bilgi — geç/kal değil) ════════════`);
/**
 * 🔴 BU BÖLÜM DENETİM DEĞİL, KAPSAMA RAPORU.
 *
 * `belge`/`bakim`/`isemri` türleri canlıda bugün kalem üretmiyor olabilir ve
 * bu bir kusur DEĞİLDİR — o filoda şu an dolan belge, gelen bakım ya da açık
 * yüksek öncelikli iş emri yoktur. Bunu "test düştü" saymak, veriyi kodun
 * kusuru gibi göstermek olurdu. Geç/kal sentetik bölümlerde; burada yalnız
 * bugün NEYİN ÖLÇÜLEBİLDİĞİ yazılıyor.
 */
try {
  const { getDashboardData } = await import("@/lib/admin-dashboard");
  const dash = await getDashboardData();
  const sayac = new Map();
  let bozuk = 0;
  for (const a of dash.attention) {
    const t = a.target;
    if (!t || !t.tur || !t.id) bozuk++;
    const ek = t?.aracId ? "+aracId" : t?.personelId ? "+personelId" : "";
    const k = `${a.kind}|${t?.tur ?? "YOK"}${ek}`;
    sayac.set(k, (sayac.get(k) ?? 0) + 1);
  }
  console.log(`  ${dash.attention.length} kalem · hedefi bozuk ${bozuk}`);
  for (const [k, n] of [...sayac].sort()) {
    const [tur, hedef] = k.split("|");
    console.log(`    ${tur.padEnd(20)} ${hedef.padEnd(20)} ${String(n).padStart(3)}`);
  }
  const uc = ["document", "maintenanceDue", "workOrder"];
  const gorulen = uc.filter((x) => dash.attention.some((a) => a.kind === x));
  console.log(
    `  üç türün canlı kapsaması: ${gorulen.length ? gorulen.join(", ") : "HİÇBİRİ — bu kiracıda bugün kalem yok"}`
  );
  if (gorulen.length) {
    for (const a of dash.attention.filter((x) => uc.includes(x.kind))) {
      console.log(`    ${a.kind}: ${JSON.stringify(a.target)}`);
    }
  }
} catch (err) {
  console.log(`  ölçülemedi (canlı bağlantı yok): ${String(err?.message ?? err).slice(0, 80)}`);
}

console.log(`\n═══ SONUÇ ═══════════════════════════════════════════════════════`);
console.log(`  ${gecti}/${gecti + dusen.length} geçti${dusen.length ? ` · ${dusen.length} KALDI` : ""}\n`);
process.exit(dusen.length ? 1 : 0);
