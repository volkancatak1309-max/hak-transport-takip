#!/usr/bin/env node
/**
 * FİLO KARŞILAŞTIRMASI — CANLI kanıt. **SALT OKUMA.**
 *
 * Uç yalnız SELECT/RPC-okuma yapar; bu betik hiçbir yazma çağrısı içermez, bu
 * yüzden HAK61 dâhil her kiracıda güvenle koşar (Volkan kuralı: HAK61 salt
 * okuma). HAK61'de ayrıca DAHA GÜÇLÜ bir kanıt verir: orada gerçekten İKİ filo
 * var, dolayısıyla "Σ filolar = toplam" kimliği bölünmeyi de sınar — tek
 * filolu bir kiracıda o kimlik önemsiz derecede doğrudur.
 *
 * NE KANITLIYOR:
 *   1. Σ(filolar + sahipsiz) === toplayıcının kendi toplamı   (5 metrikte)
 *   2. alarm / vardiya / rölanti === /api/mobile/analytics'in AYNI sayıları
 *   3. yakıt litre === buildFuelReport'un kendi toplamı
 *   4. km 052 ekseninde tutarlı; Analiz'in km'siyle FARKI ÖLÇÜLÜP yazdırılır
 *      (aynı olgu değil — bkz. lib/fleet-compare.ts başlığı)
 *   5. şef aktörüyle kapsam daralması (çekirdek çağrısı; HTTP'de şef jetonu yok)
 *
 * Kullanım:
 *   ENV_FILE=.env.galzura-demo npm run verify:filo-karsilastir
 *   ENV_FILE=.env.local        npm run verify:filo-karsilastir   (salt okuma)
 */
import { supabaseAdmin } from "@/lib/supabase";
import { issueTokens } from "@/lib/mobile-auth";
import { computeAnalyticsRange } from "@/lib/analytics";
import { getFleetScope } from "@/lib/fleet-scope";
import { buildFleetComparison } from "@/lib/fleet-compare";

if (supabaseAdmin?.__MOCK__ === true) {
  console.error("✗ şim devrede — gerçek veritabanı gerekli.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KIRACI = url.includes("gopptkmetpfsxmgcijbb")
  ? "HAK61"
  : url.includes("ftbazsyiolkeqivwzmlh")
    ? "Sendigo"
    : url.includes("omgnkvoulndbglmxlvzc")
      ? "galzura-demo"
      : "BİLİNMEYEN";

let gecen = 0;
const dusen = [];
function ok(baslik, kosul, kanit) {
  if (kosul) {
    gecen++;
    console.log(`  ✓ ${baslik}${kanit ? `   [${kanit}]` : ""}`);
  } else {
    dusen.push({ baslik, kanit });
    console.log(`  ✗ ${baslik}   [${kanit}]`);
  }
}
const yakin = (a, b, tol = 1e-6) => Math.abs((a ?? 0) - (b ?? 0)) < tol;
const n1 = (x) => (x == null ? "null" : Number(x).toFixed(1));

const { GET: KARSILASTIR } = await import(
  "@/app/api/mobile/fleets/karsilastir/route.ts"
);
const { GET: ANALIZ } = await import("@/app/api/mobile/analytics/route.ts");

const { data: adm } = await supabaseAdmin
  .from("workers")
  .select("id, name, token_version")
  .eq("is_admin", true)
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();
if (!adm) {
  console.error("✗ yönetici bulunamadı");
  process.exit(1);
}
const token = (await issueTokens(adm.id, true, adm.token_version ?? 0)).accessToken;
const H = { authorization: `Bearer ${token}` };

const cagir = async (donem) => {
  const u = new URL("https://x.invalid/api/mobile/fleets/karsilastir");
  u.searchParams.set("donem", donem);
  const res = await KARSILASTIR(new Request(u.toString(), { headers: H }));
  return { kod: res.status, govde: await res.json() };
};
const analiz = async (range) => {
  const u = new URL("https://x.invalid/api/mobile/analytics");
  u.searchParams.set("range", range);
  const res = await ANALIZ(new Request(u.toString(), { headers: H }));
  return { kod: res.status, govde: await res.json() };
};

console.log(`\n═══ kiracı: ${KIRACI} · yönetici: ${adm.name} ═══`);

for (const donem of ["hafta", "ay"]) {
  console.log(`\n────────── ${donem} ──────────`);
  const k = await cagir(donem);
  ok(`${donem}: 200`, k.kod === 200, String(k.kod));
  if (k.kod !== 200) continue;
  const g = k.govde;

  const satirlar = [...g.filolar, ...(g.sahipsiz ? [g.sahipsiz] : [])];
  console.log(
    `  filo satırı: ${g.filolar.length}` +
      (g.sahipsiz ? ` + sahipsiz(${g.sahipsiz.aracSayisi} araç)` : " + sahipsiz YOK") +
      `  ·  km kaynağı: ${g.kmKaynagi}  ·  kırpıldı: ${g.kirpildi}`
  );
  for (const f of g.filolar) {
    console.log(
      `    ${(f.kod ?? "-").padEnd(8)} ${String(f.ad).padEnd(14)} ` +
        `araç ${String(f.aracSayisi).padStart(3)} · kişi ${String(f.personelSayisi).padStart(3)} · ` +
        `km ${n1(f.km).padStart(9)} · vardiya ${String(f.vardiyaSayisi).padStart(4)} · ` +
        `alarm ${String(f.alarm.toplam).padStart(5)} (K${f.alarm.kritik}/U${f.alarm.uyari}/R${f.alarm.rutin}) · ` +
        `L ${n1(f.yakitLitre).padStart(8)} · € ${n1(f.yakitEuro).padStart(9)} · ` +
        `rölanti ${n1(f.rolantiSaat).padStart(7)}sa · skor ${f.skorOrtalama == null ? "—" : Number(f.skorOrtalama).toFixed(1)} (${f.skorlananSayisi}) · ` +
        `alarm/100km ${f.kmBasinaAlarm == null ? "—" : Number(f.kmBasinaAlarm).toFixed(2)}`
    );
  }
  if (g.sahipsiz) {
    const s = g.sahipsiz;
    console.log(
      `    ${"(yok)".padEnd(8)} ${String(s.ad).padEnd(14)} ` +
        `araç ${String(s.aracSayisi).padStart(3)} · km ${n1(s.km).padStart(9)} · ` +
        `vardiya ${String(s.vardiyaSayisi).padStart(4)} · alarm ${String(s.alarm.toplam).padStart(5)}`
    );
  }

  // ── 1) YANITTAKİ DENKLİK BLOĞU ────────────────────────────────────────
  for (const [ad, d] of Object.entries(g.denklik)) {
    ok(
      `denklik ${ad}: Σ filolar = kaynak toplam`,
      d.esit === true,
      `Σ=${n1(d.filolarToplami)} kaynak=${n1(d.kaynakToplam)}`
    );
  }

  // ── 2) BETİK KENDİ DE TOPLASIN (yanıta güvenme) ───────────────────────
  const sKm = satirlar.reduce((a, f) => a + f.km, 0);
  const sVardiya = satirlar.reduce((a, f) => a + f.vardiyaSayisi, 0);
  const sAlarm = satirlar.reduce((a, f) => a + f.alarm.toplam, 0);
  const sRol = satirlar.reduce((a, f) => a + f.rolantiSaat, 0);
  const sLitre = satirlar.reduce((a, f) => a + (f.yakitLitre ?? 0), 0);
  ok("betik Σ km = toplam.km", yakin(sKm, g.toplam.km, 1e-6), `${n1(sKm)} vs ${n1(g.toplam.km)}`);
  ok("betik Σ vardiya = toplam", sVardiya === g.toplam.vardiyaSayisi, `${sVardiya} vs ${g.toplam.vardiyaSayisi}`);
  ok("betik Σ alarm = toplam", sAlarm === g.toplam.alarm.toplam, `${sAlarm} vs ${g.toplam.alarm.toplam}`);
  ok("betik Σ rölanti = toplam", yakin(sRol, g.toplam.rolantiSaat, 1e-6), `${n1(sRol)} vs ${n1(g.toplam.rolantiSaat)}`);
  ok("betik Σ litre = toplam", yakin(sLitre, g.toplam.yakitLitre ?? 0, 1e-6), `${n1(sLitre)} vs ${n1(g.toplam.yakitLitre)}`);

  // Alarm kademeleri toplamı = alarm toplamı (rutin gizlenmiş olsaydı tutmazdı).
  for (const f of satirlar) {
    ok(
      `${f.kod ?? "sahipsiz"}: kritik+uyarı+rutin = toplam`,
      f.alarm.kritik + f.alarm.uyari + f.alarm.rutin === f.alarm.toplam,
      `${f.alarm.kritik}+${f.alarm.uyari}+${f.alarm.rutin} vs ${f.alarm.toplam}`
    );
  }

  // ── 3) ANALİZ UCUYLA KARŞILAŞTIR ──────────────────────────────────────
  const a = await analiz(donem);
  ok(`analiz ucu 200`, a.kod === 200, String(a.kod));
  if (a.kod === 200) {
    const t = a.govde.toplam;
    ok(
      "🔑 alarm toplamı = Analiz alarm.toplam",
      g.toplam.alarm.toplam === t.alarm.toplam,
      `karşılaştır=${g.toplam.alarm.toplam} analiz=${t.alarm.toplam}`
    );
    ok(
      "🔑 vardiya sayısı = Analiz vardiya",
      g.toplam.vardiyaSayisi === t.vardiya,
      `karşılaştır=${g.toplam.vardiyaSayisi} analiz=${t.vardiya}`
    );
    ok(
      "🔑 rölanti saat = Analiz rolanti.toplamMs",
      yakin(g.toplam.rolantiSaat, t.rolanti.toplamMs / 3_600_000, 1e-6),
      `karşılaştır=${n1(g.toplam.rolantiSaat)} analiz=${n1(t.rolanti.toplamMs / 3_600_000)}`
    );
    // KM: aynı olgu DEĞİL — fark ölçülür ve YAZDIRILIR, iddia edilmez.
    const fark = g.toplam.km - t.km;
    const yuzde = t.km > 0 ? (fark / t.km) * 100 : 0;
    console.log(
      `  ℹ km EKSEN FARKI (kusur değil): 052=${n1(g.toplam.km)} · Analiz(start/end_km)=${n1(t.km)} · ` +
        `fark ${fark > 0 ? "+" : ""}${n1(fark)} km (${yuzde > 0 ? "+" : ""}${yuzde.toFixed(1)}%)`
    );
    ok(
      "km alanı 052 ekseninden geliyor (Analiz ekseni DEĞİL)",
      g.kmKaynagi === "052",
      g.kmKaynagi
    );
  }
}

// ══ 4) ŞEF AKTÖRÜ — çekirdek çağrısı (HTTP'de şef jetonu yok) ═════════════
console.log(`\n────────── şef kapsamı (çekirdek) ──────────`);
const { data: filolar } = await supabaseAdmin
  .from("fleets")
  .select("code")
  .order("sort_order");
const kodlar = (filolar ?? []).map((f) => f.code);
if (kodlar.length === 0) {
  console.log("  (filo tanımı yok — atlandı)");
} else {
  const hedef = kodlar[0];
  const scope = await getFleetScope(hedef);
  const range = computeAnalyticsRange("hafta");
  const sefSonuc = await buildFleetComparison(range, scope);
  ok("şef YALNIZ 1 filo görüyor", sefSonuc.filolar.length === 1, `${sefSonuc.filolar.length} satır`);
  ok("şefin gördüğü filo kendi filosu", sefSonuc.filolar[0]?.kod === hedef, `${sefSonuc.filolar[0]?.kod} vs ${hedef}`);
  ok("şefte 'sahipsiz' kovası YOK", sefSonuc.sahipsiz === null, String(sefSonuc.sahipsiz));
  for (const [ad, d] of Object.entries(sefSonuc.denklik)) {
    ok(`şef denklik ${ad}`, d.esit === true, `Σ=${n1(d.filolarToplami)} kaynak=${n1(d.kaynakToplam)}`);
  }
  // Daraltma GERÇEKTEN daraltıyor mu: kısıtsız toplamdan küçük ya da eşit olmalı.
  const tumu = await buildFleetComparison(range, {
    fleet: null,
    vehicleIds: [],
    workerIds: [],
    restricted: false,
    isFleetVehicle: () => true,
    isFleetWorker: () => true,
  });
  ok(
    "şef toplamı ≤ kısıtsız toplam (alarm)",
    sefSonuc.toplam.alarm.toplam <= tumu.toplam.alarm.toplam,
    `şef=${sefSonuc.toplam.alarm.toplam} tümü=${tumu.toplam.alarm.toplam}`
  );
  ok(
    "şef toplamı ≤ kısıtsız toplam (km)",
    sefSonuc.toplam.km <= tumu.toplam.km + 1e-6,
    `şef=${n1(sefSonuc.toplam.km)} tümü=${n1(tumu.toplam.km)}`
  );
  console.log(
    `  şef(${hedef}): araç ${sefSonuc.toplam.aracSayisi} · km ${n1(sefSonuc.toplam.km)} · ` +
      `alarm ${sefSonuc.toplam.alarm.toplam}   |   kısıtsız: araç ${tumu.toplam.aracSayisi} · ` +
      `km ${n1(tumu.toplam.km)} · alarm ${tumu.toplam.alarm.toplam}`
  );
}

console.log(
  `\n${dusen.length === 0 ? "✓" : "✗"} filo karşılaştırması: ${gecen}/${gecen + dusen.length} denetim geçti` +
    (dusen.length ? `\nDÜŞEN:\n${dusen.map((d) => `  · ${d.baslik}  [${d.kanit}]`).join("\n")}` : "")
);
process.exit(dusen.length === 0 ? 0 : 1);
