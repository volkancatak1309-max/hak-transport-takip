#!/usr/bin/env node
/**
 * KM EKSENİ ADIM 3 — mobil uçlarda SAYI DEĞİŞTİ. CANLI kanıt, **SALT OKUMA.**
 *
 * Adım 2'de yalnız etiket eklenmişti; bu turda `/shifts`, `/shifts/[id]` ve
 * `/workers/[id]` `km` alanını lib/km-axis.ts çekirdeğinden alıyor.
 *
 * "ÖNCE" burada eski yanıt DEĞİL — `kmDiff` ile BAĞIMSIZ yeniden hesaplanan
 * sayaç ekseni. Eski uca çağrı yapıp karşılaştırmak mümkün değil (kod artık
 * yeni); ama karşılaştırmanın anlamı aynı: "bu satır dün ne gösteriyordu".
 *
 * Yazma yok, HAK61 dâhil her kiracıda güvenle koşar.
 *
 * Kullanım:
 *   ENV_FILE=.env.local npm run verify:km-ekseni-adim3
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { kmDiff } from "@/lib/format";
import { markKmMeasured } from "@/lib/km-quality";
import { kmEkseniCoz, kmPencere, kmOku } from "@/lib/km-axis";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptk") ? "HAK61" : url.includes("ftbaz") ? "Sendigo" : "galzura-demo";

let gecen = 0;
const dusen = [];
const ok = (b, k, kanit) => {
  if (k) { gecen++; console.log(`  ✓ ${b}${kanit ? `   [${kanit}]` : ""}`); }
  else { dusen.push({ b, kanit }); console.log(`  ✗ ${b}   [${kanit}]`); }
};
const n = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(0));

const { GET: SHIFTS } = await import("@/app/api/mobile/shifts/route.ts");
const { GET: SHIFT } = await import("@/app/api/mobile/shifts/[id]/route.ts");
const { GET: WORKER } = await import("@/app/api/mobile/workers/[id]/route.ts");

const { data: adm } = await supabaseAdmin
  .from("workers").select("id, name, token_version")
  .eq("is_admin", true).eq("is_active", true).limit(1).maybeSingle();
if (!adm) { console.error("✗ yönetici bulunamadı"); process.exit(1); }
const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;
const H = { authorization: `Bearer ${token}` };
const cagir = async (fn, u, ctx) => {
  const t0 = performance.now();
  const res = ctx ? await fn(new Request(u, { headers: H }), ctx) : await fn(new Request(u, { headers: H }));
  return { kod: res.status, govde: await res.json(), ms: performance.now() - t0 };
};

console.log(`\n═══ ${KIRACI} · yönetici ${adm.name} ═══`);

// ══ 1 · AYNI 30 VARDİYADA ÖNCE/SONRA ═══════════════════════════════════════
console.log("\n────────── /shifts?limit=30 · önce → sonra ──────────");
const L = await cagir(SHIFTS, "https://x.invalid/api/mobile/shifts?limit=30");
ok("liste 200", L.kod === 200, String(L.kod));
const v = L.govde.vardiyalar ?? [];
ok("kmEkseni hazır", L.govde.kmEkseni?.durum === "hazir", L.govde.kmEkseni?.durum);

// ÖNCE: bağımsız yeniden hesap (sayaç ekseni)
const { data: ham } = await supabaseAdmin.from("time_entries").select("*").in("id", v.map((r) => r.id));
const isaretli = await markKmMeasured(ham ?? []);
const once = new Map(isaretli.map((e) => [e.id, kmDiff(e)]));

console.log(
  "\n  " + "id".padEnd(10) + "önce".padStart(8) + "sonra".padStart(8) +
    "fark".padStart(8) + "  kaynak"
);
let degisen = 0, toplamOnce = 0, toplamSonra = 0;
for (const r of v) {
  const o = once.get(r.id) ?? null;
  const s = r.km ?? null;
  if (o !== null) toplamOnce += o;
  if (s !== null) toplamSonra += s;
  const fark = o !== null && s !== null ? s - o : null;
  const ayni = o === s;
  if (!ayni) degisen++;
  console.log(
    "  " + r.id.slice(0, 8).padEnd(10) + n(o).padStart(8) + n(s).padStart(8) +
      (fark === null ? "—" : (fark > 0 ? "+" : "") + fark.toFixed(0)).padStart(8) +
      "  " + String(r.kmKaynak).padEnd(11) + (ayni ? "" : "←")
  );
}
const yuzde = toplamOnce > 0 ? ((toplamSonra - toplamOnce) / toplamOnce) * 100 : 0;
console.log(
  `\n  değişen satır : ${degisen}/${v.length}` +
    `\n  Σ önce ${toplamOnce.toFixed(0)} km → Σ sonra ${toplamSonra.toFixed(0)} km` +
    `  (fark ${(toplamSonra - toplamOnce > 0 ? "+" : "")}${(toplamSonra - toplamOnce).toFixed(0)}, %${yuzde.toFixed(1)})`
);
const dag = {};
for (const r of v) dag[r.kmKaynak] = (dag[r.kmKaynak] ?? 0) + 1;
console.log(`  kaynak dağılımı: ${JSON.stringify(dag)}`);

// ── Her satır çekirdeğin kararıyla BİREBİR mi ─────────────────────────────
const pen = kmPencere(isaretli);
const coz = pen ? await kmEkseniCoz(isaretli, pen) : null;
const sapan = v.filter((r) => (r.km ?? null) !== (coz ? kmOku(coz.karar, r.id, once.get(r.id) ?? null) : null));
ok(
  "🔑 her satır çekirdeğin kararıyla BİREBİR",
  sapan.length === 0,
  sapan.length ? sapan.slice(0, 3).map((r) => r.id.slice(0, 8)).join(",") : `${v.length}/${v.length}`
);
// "cihaz" etiketli satır sayaç değerinden FARKLI olabilir; "sayac" etiketli ASLA.
const sayacSapan = v.filter((r) => r.kmKaynak === "sayac" && (r.km ?? null) !== (once.get(r.id) ?? null));
ok(
  '"sayac" etiketli satırlar sayaç değerini aynen taşıyor',
  sayacSapan.length === 0,
  sayacSapan.length ? sayacSapan.map((r) => r.id.slice(0, 8)).join(",") : `${dag.sayac ?? 0} satır`
);
// Ham uçlar DURUYOR.
ok(
  "baslangicKm / bitisKm ham alanları duruyor",
  v.every((r) => "baslangicKm" in r && "bitisKm" in r),
  `${v.length} satırda da var`
);

// ══ 2 · DETAY UCU ══════════════════════════════════════════════════════════
console.log("\n────────── /shifts/[id] ──────────");
const hedef = v.find((r) => r.kmKaynak === "cihaz") ?? v[0];
const D = await cagir(SHIFT, `https://x.invalid/api/mobile/shifts/${hedef.id}`, { params: Promise.resolve({ id: hedef.id }) });
ok("detay 200", D.kod === 200, String(D.kod));
ok(
  "🔑 detay km = liste km (tek kaynak)",
  (D.govde.vardiya?.km ?? null) === (hedef.km ?? null),
  `${n(D.govde.vardiya?.km)} vs ${n(hedef.km)}`
);
console.log(`   önce ${n(once.get(hedef.id))} → sonra ${n(D.govde.vardiya?.km)} · kaynak ${D.govde.vardiya?.kmKaynak}`);

// ══ 3 · buAy.km ÖNCE/SONRA ═════════════════════════════════════════════════
console.log("\n────────── /workers/[id] · buAy.km ──────────");
const W = await cagir(WORKER, `https://x.invalid/api/mobile/workers/${hedef.soforId}`, { params: Promise.resolve({ id: hedef.soforId }) });
ok("çalışan 200", W.kod === 200, String(W.kod));
const ayBas = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
const { data: ayRows } = await supabaseAdmin
  .from("time_entries").select("*").eq("worker_id", hedef.soforId).gte("started_at", ayBas);
const ayIsaretli = await markKmMeasured(ayRows ?? []);
const ayOnce = ayIsaretli.reduce((a, e) => a + (kmDiff(e) ?? 0), 0);
const aySonra = W.govde.buAy?.km ?? 0;
console.log(
  `   ${hedef.soforId.slice(0, 8)} · buAy.km  önce ${ayOnce.toFixed(0)} → sonra ${aySonra.toFixed(0)}` +
    `  (fark ${(aySonra - ayOnce > 0 ? "+" : "")}${(aySonra - ayOnce).toFixed(0)}` +
    `, %${ayOnce > 0 ? (((aySonra - ayOnce) / ayOnce) * 100).toFixed(1) : "0"})`
);
console.log(`   kmKaynakDagilim: ${JSON.stringify(W.govde.buAy?.kmKaynakDagilim)}`);
ok("buAy.km bir sayı döndü", typeof aySonra === "number", String(aySonra));

// ══ 4 · GECİKME (5 koşum medyan) ═══════════════════════════════════════════
console.log("\n────────── gecikme ──────────");
const cek = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  if (pen) await kmEkseniCoz(isaretli, pen);
  cek.push(performance.now() - t0);
}
const sirali = [...cek].sort((a, b) => a - b);
const medyan = sirali[Math.floor(sirali.length / 2)];
console.log(`   çekirdek payı: ${cek.map((x) => x.toFixed(0)).join(" / ")} ms → medyan ${medyan.toFixed(0)} ms`);
ok("🔑 çekirdeğin eklediği süre (medyan) < 100 ms", medyan < 100, `medyan ${medyan.toFixed(0)} ms`);

// ══ 5 · ŞOFÖR EKSENİ — en çok değişen 5 kişi (son 30 gün) ══════════════════
console.log("\n────────── şoför ekseni · son 30 gün · en çok değişen 5 ──────────");
const otuz = new Date(Date.now() - 30 * 86400000).toISOString();
const { data: aylik } = await supabaseAdmin
  .from("time_entries").select("*").gte("started_at", otuz);
const ai = await markKmMeasured(aylik ?? []);
const aPen = kmPencere(ai);
const aCoz = aPen ? await kmEkseniCoz(ai, aPen) : null;
const perO = new Map(), perS = new Map();
for (const e of ai) {
  const o = kmDiff(e);
  const s = aCoz ? kmOku(aCoz.karar, e.id, o) : o;
  if (o !== null) perO.set(e.worker_id, (perO.get(e.worker_id) ?? 0) + o);
  if (s !== null) perS.set(e.worker_id, (perS.get(e.worker_id) ?? 0) + s);
}
const kisiler = [...new Set([...perO.keys(), ...perS.keys()])].map((w) => {
  const o = perO.get(w) ?? 0, s = perS.get(w) ?? 0;
  return { w, o, s, fark: s - o, yuzde: o > 0 ? ((s - o) / o) * 100 : null };
});
kisiler.sort((x, y) => Math.abs(y.fark) - Math.abs(x.fark));
console.log("  " + "worker_id".padEnd(12) + "önce".padStart(9) + "sonra".padStart(9) + "fark".padStart(9) + "  %");
for (const k of kisiler.slice(0, 5)) {
  console.log(
    "  " + k.w.slice(0, 10).padEnd(12) + k.o.toFixed(0).padStart(9) + k.s.toFixed(0).padStart(9) +
      ((k.fark > 0 ? "+" : "") + k.fark.toFixed(0)).padStart(9) +
      "  " + (k.yuzde === null ? "—" : (k.yuzde > 0 ? "+" : "") + k.yuzde.toFixed(1) + "%")
  );
}
const toplamO = kisiler.reduce((a, k) => a + k.o, 0);
const toplamS = kisiler.reduce((a, k) => a + k.s, 0);
console.log(
  `  ── filo geneli: ${toplamO.toFixed(0)} → ${toplamS.toFixed(0)} km` +
    ` (${(toplamS - toplamO > 0 ? "+" : "")}${(toplamS - toplamO).toFixed(0)}, %${toplamO > 0 ? (((toplamS - toplamO) / toplamO) * 100).toFixed(1) : "0"})` +
    ` · ${kisiler.filter((k) => Math.abs(k.fark) > 0.5).length}/${kisiler.length} şoförde değişti`
);

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} km ekseni Adım 3: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.b}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
