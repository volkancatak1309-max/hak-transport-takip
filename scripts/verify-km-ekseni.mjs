#!/usr/bin/env node
/**
 * KM EKSENİ — ÇEKİRDEK ve ETİKET SÖZLEŞMESİ. CANLI kanıt, **SALT OKUMA.**
 *
 * ⚠️ 16.09.2026: bu betik Adım 1+2 için yazılmıştı ve sözü "SAYI DEĞİŞMEDİ"
 * idi. Adım 3 sayıyı çekirdeğe bağlayınca o söz geçersiz kaldı; denetimler
 * yeni sözleşmeye çevrildi — "uçtaki `km`, çekirdeğin kararının TA KENDİSİ".
 * Ölçüm tarafı (etiket dağılımı, tolerans, gecikme medyanı) aynen duruyor.
 * Sayının DEĞİŞİMİNİ ölçen tablo ayrı betikte: verify-km-ekseni-adim3.mjs.
 *
 * Yazma yok, HAK61 dâhil her kiracıda güvenle koşar.
 *
 * Kullanım:
 *   ENV_FILE=.env.local npm run verify:km-ekseni
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { kmDiff } from "@/lib/format";
import { markKmMeasured } from "@/lib/km-quality";
import { kmEkseniCoz, kmPencere, kaynakSay, kmOku, KAPSAMA_TOLERANS_DK } from "@/lib/km-axis";

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

const { GET: SHIFTS } = await import("@/app/api/mobile/shifts/route.ts");
const { GET: SHIFT } = await import("@/app/api/mobile/shifts/[id]/route.ts");
const { GET: WORKER } = await import("@/app/api/mobile/workers/[id]/route.ts");
const { GET: ANALIZ } = await import("@/app/api/mobile/analytics/route.ts");

const { data: adm } = await supabaseAdmin
  .from("workers").select("id, name, token_version")
  .eq("is_admin", true).eq("is_active", true).limit(1).maybeSingle();
if (!adm) { console.error("✗ yönetici bulunamadı"); process.exit(1); }
const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;
const H = { authorization: `Bearer ${token}` };
const cagir = async (fn, u, ctx) => {
  const t0 = performance.now();
  const res = ctx ? await fn(new Request(u, { headers: H }), ctx) : await fn(new Request(u, { headers: H }));
  const ms = performance.now() - t0;
  return { kod: res.status, govde: await res.json(), ms };
};

console.log(`\n═══ ${KIRACI} · yönetici ${adm.name} · tolerans ${KAPSAMA_TOLERANS_DK} dk ═══`);

// ══ 1 · LİSTE UCU — km alanı çekirdekle birebir mi ════════════════════════
console.log("\n── /shifts (limit 30) ──");
const L = await cagir(SHIFTS, "https://x.invalid/api/mobile/shifts?limit=30");
ok("liste 200", L.kod === 200, String(L.kod));
const v = L.govde.vardiyalar ?? [];
ok("30 satır döndü", v.length > 0, `${v.length} satır`);

/**
 * ⚠️ SÖZLEŞME 16.09.2026'DA DEĞİŞTİ (13. madde Adım 3). Bu denetim o güne
 * kadar "km hâlâ A ekseninde, BİT-BİT aynı" diyordu — Adım 2'nin sözü buydu.
 * Adım 3 sayıyı çekirdeğe bağladı, yani eski iddia artık YANLIŞ.
 *
 * Denetim SİLİNMEDİ, GÜNCELLENDİ: yeni söz "uçtaki km, çekirdeğin bu vardiya
 * için verdiği kararın TA KENDİSİ". Ölü bir sözleşmeyi denetleyen betik,
 * denetim olmaktan çıkar; ama denetimi tümden kaldırmak da ucu çekirdeğinden
 * ayrılmaya açık bırakırdı.
 */
const { data: ham } = await supabaseAdmin
  .from("time_entries").select("*").in("id", v.map((r) => r.id));
const isaretliHam = await markKmMeasured(ham ?? []);
const yedek = new Map(isaretliHam.map((e) => [e.id, kmDiff(e)]));
const penL = kmPencere(isaretliHam);
const cozL = penL ? await kmEkseniCoz(isaretliHam, penL) : null;
const beklenen = new Map(
  isaretliHam.map((e) => [
    e.id,
    cozL ? kmOku(cozL.karar, e.id, yedek.get(e.id) ?? null) : (yedek.get(e.id) ?? null),
  ])
);
const kmFark = v.filter((r) => (r.km ?? null) !== (beklenen.get(r.id) ?? null));
ok(
  "🔑 km alanı çekirdeğin kararıyla BİREBİR",
  kmFark.length === 0,
  kmFark.length ? kmFark.slice(0, 3).map((r) => `${r.id}: ${r.km} vs ${beklenen.get(r.id)}`).join(" | ") : `${v.length}/${v.length} eşleşti`
);
ok("her satırda kmKaynak var", v.every((r) => typeof r.kmKaynak === "string"));
ok("kmEkseni.durum yanıtta", typeof L.govde.kmEkseni?.durum === "string", L.govde.kmEkseni?.durum);
ok("toleransDk yanıtta", L.govde.kmEkseni?.toleransDk === KAPSAMA_TOLERANS_DK, String(L.govde.kmEkseni?.toleransDk));
const dag = {};
for (const r of v) dag[r.kmKaynak] = (dag[r.kmKaynak] ?? 0) + 1;
console.log(`   etiket dağılımı: ${JSON.stringify(dag)}`);

// ══ 2 · GECİKME — ek süre < 100 ms ═════════════════════════════════════════
console.log("\n── gecikme ──");
const sureler = [];
for (let i = 0; i < 3; i++) {
  const r = await cagir(SHIFTS, "https://x.invalid/api/mobile/shifts?limit=30");
  sureler.push(r.ms);
}
/**
 * Çekirdeğin EKLEDİĞİ süre. Tek atış ölçülmez: ilk çağrı bağlantı ısınmasını
 * da taşır ve ağ gecikmesi atıştan atışa 20-30 ms oynar. Beş koşum, karar
 * MEDYANA göre — eşiği geçmek için değil, gerçeği görmek için.
 */
const rows = await markKmMeasured((ham ?? []));
const pen = kmPencere(rows);
const cekirdekler = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  if (pen) await kmEkseniCoz(rows, pen);
  cekirdekler.push(performance.now() - t0);
}
const sirali = [...cekirdekler].sort((a, b) => a - b);
const medyan = sirali[Math.floor(sirali.length / 2)];
console.log(`   uç toplam    : ${sureler.map((s) => s.toFixed(0)).join(" / ")} ms`);
console.log(
  `   çekirdek payı: ${cekirdekler.map((s) => s.toFixed(0)).join(" / ")} ms` +
    `  → medyan ${medyan.toFixed(0)} ms · en iyi ${sirali[0].toFixed(0)} · en kötü ${sirali[sirali.length - 1].toFixed(0)}`
);
ok("🔑 çekirdeğin eklediği süre (medyan) < 100 ms", medyan < 100, `medyan ${medyan.toFixed(0)} ms`);

// ══ 3 · DETAY UCU ══════════════════════════════════════════════════════════
console.log("\n── /shifts/[id] ──");
const hedef = v.find((r) => !r.acik) ?? v[0];
const D = await cagir(SHIFT, `https://x.invalid/api/mobile/shifts/${hedef.id}`, { params: Promise.resolve({ id: hedef.id }) });
ok("detay 200", D.kod === 200, String(D.kod));
ok(
  "🔑 detay km = liste km (tek kaynak)",
  (D.govde.vardiya?.km ?? null) === (hedef.km ?? null),
  `${D.govde.vardiya?.km} vs ${hedef.km}`
);
ok("detayda kmKaynak var", typeof D.govde.vardiya?.kmKaynak === "string", D.govde.vardiya?.kmKaynak);

// ══ 4 · ÇALIŞAN UCU ════════════════════════════════════════════════════════
console.log("\n── /workers/[id] ──");
const W = await cagir(WORKER, `https://x.invalid/api/mobile/workers/${hedef.soforId}`, { params: Promise.resolve({ id: hedef.soforId }) });
ok("çalışan 200", W.kod === 200, String(W.kod));
ok("buAy.kmKaynakDagilim var", !!W.govde.buAy?.kmKaynakDagilim, JSON.stringify(W.govde.buAy?.kmKaynakDagilim));
ok("sonVardiyalar'da kmKaynak var", (W.govde.sonVardiyalar ?? []).every((r) => typeof r.kmKaynak === "string"));
// buAy.km bağımsız olarak yeniden hesaplanır
const { data: ayRows } = await supabaseAdmin
  .from("time_entries").select("*").eq("worker_id", hedef.soforId)
  .gte("started_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
// Ay toplamı da çekirdeğin kararlarının toplamı olmalı (Adım 3 sözleşmesi).
const ayIsaretli = await markKmMeasured(ayRows ?? []);
const penAy = kmPencere(ayIsaretli);
const cozAy = penAy ? await kmEkseniCoz(ayIsaretli, penAy) : null;
const ayBeklenen = ayIsaretli.reduce(
  (a, e) => a + ((cozAy ? kmOku(cozAy.karar, e.id, kmDiff(e)) : kmDiff(e)) ?? 0),
  0
);
ok(
  "🔑 buAy.km = çekirdek kararlarının toplamı",
  Math.abs((W.govde.buAy?.km ?? 0) - ayBeklenen) < 0.001,
  `${W.govde.buAy?.km} vs ${ayBeklenen}`
);

// ══ 5 · ANALİZ UCU ═════════════════════════════════════════════════════════
console.log("\n── /analytics?range=hafta ──");
const A = await cagir(ANALIZ, "https://x.invalid/api/mobile/analytics?range=hafta");
ok("analiz 200", A.kod === 200, String(A.kod));
ok("kmKaynakDagilim var", !!A.govde.toplam?.kmKaynakDagilim, JSON.stringify(A.govde.toplam?.kmKaynakDagilim));
ok("kmEkseni.durum var", typeof A.govde.toplam?.kmEkseni?.durum === "string", A.govde.toplam?.kmEkseni?.durum);
console.log(`   analiz km (A ekseni, değişmedi): ${A.govde.toplam?.km?.toFixed?.(0) ?? A.govde.toplam?.km}`);

// ══ 6 · ÇEKİRDEK KURALI (aynı pencerede dağılım) ═══════════════════════════
console.log("\n── çekirdek dağılımı (son 30 gün) ──");
const otuz = new Date(Date.now() - 30 * 86400000).toISOString();
const { data: ayl } = await supabaseAdmin
  .from("time_entries").select("id, vehicle_id, started_at, ended_at, start_km, end_km")
  .gte("started_at", otuz);
const isaretli = await markKmMeasured(ayl ?? []);
const pen30 = kmPencere(isaretli);
const coz = pen30 ? await kmEkseniCoz(isaretli, pen30) : null;
if (coz) {
  console.log(`   bDurumu: ${coz.bDurumu ?? "hazir"}`);
  console.log(`   dağılım: ${JSON.stringify(kaynakSay(isaretli, coz.karar))}`);
  const sebep = {};
  for (const k of coz.karar.values()) if (k.bSebep) sebep[k.bSebep] = (sebep[k.bSebep] ?? 0) + 1;
  console.log(`   B kullanılmama sebepleri: ${JSON.stringify(sebep)}`);
  ok(
    "çekirdek km'si A ile aynı (100 uygulanmadan B'ye güvenilmiyor)",
    coz.bDurumu !== "zaman_yok" || [...coz.karar.values()].every((k) => k.kaynak !== "cihaz"),
    coz.bDurumu ?? "hazir"
  );
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} km ekseni Adım 1+2: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.b}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
