/**
 * SAKLAMA POLİTİKASI DOĞRULAMASI (migration 090).
 *
 * QA harness'ında koşar (Docker Postgres + PostgREST). ÜRETİMDE ÇALIŞTIRMAYIN —
 * betik gerçekten SİLER.
 *
 * ═══ NE KANITLIYOR ═══
 *
 *   1. Saf katman kuralları (gerekçe kapısı, kesim, ay granülerliği)
 *   2. FAIL-CLOSED: ayar kapalıyken silme YOK
 *   3. Sıra kapısı: özet/dondurma eksikken silme YOK
 *   4. Hazırlık: ömür izi + aylık özet + km dondurma
 *   5. 🔑 ÖNCE/SONRA: silme sonrası HANGİ yüzey ayakta, HANGİSİ boşaldı
 *   6. "Ölçülemedi ≠ 0": cihazsız araç 0 değil `null` + sebep döner
 */

import { pencereKapsami, ayarDenetle, aylar, aySilinebilir, aySiniri, kesimTarihi, silmeKapisi } from "@/lib/saklama";
import { supabaseAdmin } from "@/lib/supabase";
import { buildFuelReport } from "@/lib/reports";
import {
  saklamaAyari,
  saklamaAyariYaz,
  omurIziniTazele,
  ayOzetiYaz,
  kmDondur,
  kmDonmamisSayisi,
  silmeDurumu,
  hamSil,
  aylariSilinmisIsaretle,
} from "@/lib/saklama-db";

let gecti = 0;
let kaldi = 0;
const hatalar = [];

function iddia(ad, kosul, ayrinti = "") {
  if (kosul) {
    gecti++;
    console.log(`  ✓ ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
  } else {
    kaldi++;
    hatalar.push(ad);
    console.log(`  ✗ ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
  }
}

function baslik(s) {
  console.log(`\n═══ ${s} ═══`);
}

// ⚠️ Anahtar adları buildFuelReport'un DateRange sözleşmesi: start/end.
const ESKI = { start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-05-01T00:00:00Z") };
const YENI = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-21T00:00:00Z") };

const litre = (r) => (r.measured === 0 ? null : Number(r.totalConsumedLiters.toFixed(1)));

// ═════════════════════ 1 · SAF KATMAN ═══════════════════════════════════

baslik("1 · SAF KATMAN — kurallar veritabanına dokunmadan");

iddia("varsayılan 90 gün kabul", ayarDenetle(90, null) === null);
iddia("30 günün altı reddedilir", ayarDenetle(29, null) === "gun_araligi");
iddia("400 günün üstü reddedilir", ayarDenetle(401, "uzun bir gerekçe metni buraya") === "gun_araligi");
iddia("91 gün GEREKÇESİZ reddedilir", ayarDenetle(91, null) === "gerekce_gerekli");
iddia("91 gün KISA gerekçeyle reddedilir", ayarDenetle(91, "kısa") === "gerekce_kisa");
iddia("91 gün yeterli gerekçeyle kabul", ayarDenetle(91, "CMR Md. 32 kapsamındaki anlaşmazlıklar için gerekli") === null);

{
  const kesim = new Date("2026-05-28T00:00:00Z");
  const tam = pencereKapsami(ESKI.start, ESKI.end, kesim);
  const kismi = pencereKapsami(new Date("2026-05-01T00:00:00Z"), new Date("2026-06-15T00:00:00Z"), kesim);
  const ici = pencereKapsami(YENI.start, YENI.end, kesim);
  iddia("tamamen eski pencere = tamamen_disi", tam.tur === "tamamen_disi", `kayıp ${tam.kayipGun} gün`);
  iddia("kesimi bölen pencere = kismen_disi", kismi.tur === "kismen_disi", `kayıp ${kismi.kayipGun} gün`);
  iddia("yeni pencere = icinde", ici.tur === "icinde");
  iddia("kısmi pencerede ölçülebilir başlangıç kesim", kismi.olculebilirBas === kesim.toISOString());
}

{
  const kesim = new Date("2026-05-28T00:00:00Z");
  iddia("nisan tamamen kesimin gerisinde", aySilinebilir("2026-04-01", kesim) === true);
  iddia("mayıs kesimi BÖLÜYOR → silinemez", aySilinebilir("2026-05-01", kesim) === false);
  iddia("ağustos kesimin ilerisinde → silinemez", aySilinebilir("2026-08-01", kesim) === false);
  const s = aySiniri("2026-04-01");
  iddia("ay sınırı [1 Nis, 1 May)", s.bas.toISOString().startsWith("2026-04-01") && s.bit.toISOString().startsWith("2026-05-01"));
  iddia("aylar() ay listesini üretiyor", aylar(ESKI.start, YENI.end).length === 5, aylar(ESKI.start, YENI.end).join(","));
}

{
  const k = kesimTarihi(90, new Date("2026-08-26T00:00:00Z"));
  iddia("90 günlük kesim 28.05.2026", k.toISOString().startsWith("2026-05-28"), k.toISOString());
}

// ═════════════════════ 2 · SİLME KAPISI (saf) ═══════════════════════════

baslik("2 · FAIL-CLOSED KAPI — dört şart");

iddia(
  "ayar kapalı → izin YOK",
  silmeKapisi({ silmeAcik: false, hazirAylar: ["2026-04-01"], ozetiEksikAylar: [], kmDonmamisVardiya: 0, omurIziSatir: 3 }).engel === "ayar_kapali"
);
iddia(
  "ömür izi yok → izin YOK",
  silmeKapisi({ silmeAcik: true, hazirAylar: ["2026-04-01"], ozetiEksikAylar: [], kmDonmamisVardiya: 0, omurIziSatir: 0 }).engel === "omur_izi_yok"
);
iddia(
  "km dondurulmamış → izin YOK",
  silmeKapisi({ silmeAcik: true, hazirAylar: ["2026-04-01"], ozetiEksikAylar: [], kmDonmamisVardiya: 7, omurIziSatir: 3 }).engel === "km_donmadi"
);
iddia(
  "özet eksik → izin YOK",
  silmeKapisi({ silmeAcik: true, hazirAylar: [], ozetiEksikAylar: ["2026-04-01"], kmDonmamisVardiya: 0, omurIziSatir: 3 }).engel === "ozet_eksik"
);
iddia(
  "dördü de tamam → izin VAR",
  silmeKapisi({ silmeAcik: true, hazirAylar: ["2026-04-01"], ozetiEksikAylar: [], kmDonmamisVardiya: 0, omurIziSatir: 3 }).izin === true
);

// ═════════════════════ 3 · ÖNCE ═════════════════════════════════════════

baslik("3 · ÖNCE — silmeden önceki ölçüm");

const oncekiTelemetri = async () => {
  const { count } = await supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true });
  return count ?? 0;
};
const nisanSatir = async () => {
  const { count } = await supabaseAdmin
    .from("device_telemetry")
    .select("id", { count: "exact", head: true })
    .lt("recorded_at", "2026-05-01T00:00:00Z");
  return count ?? 0;
};
const agustosSatir = async () => {
  const { count } = await supabaseAdmin
    .from("device_telemetry")
    .select("id", { count: "exact", head: true })
    .gte("recorded_at", "2026-08-01T00:00:00Z");
  return count ?? 0;
};

const T0 = await oncekiTelemetri();
const N0 = await nisanSatir();
const A0 = await agustosSatir();
console.log(`    telemetri toplam=${T0} · nisan=${N0} · ağustos=${A0}`);
iddia("tohum yüklü — nisan satırı var", N0 > 0, `${N0} satır`);
iddia("tohum yüklü — ağustos satırı var", A0 > 0, `${A0} satır`);

const yakitEskiOnce = await buildFuelReport(ESKI);
const yakitYeniOnce = await buildFuelReport(YENI);
const eskiLitreOnce = litre(yakitEskiOnce);
const yeniLitreOnce = litre(yakitYeniOnce);
console.log(`    yakıt NİSAN  : ${eskiLitreOnce} L · ölçülen ${yakitEskiOnce.measured}/${yakitEskiOnce.vehicleCount}`);
console.log(`    yakıt AĞUSTOS: ${yeniLitreOnce} L · ölçülen ${yakitYeniOnce.measured}/${yakitYeniOnce.vehicleCount}`);
iddia("ÖNCE: nisan ÖLÇÜLEBİLİYOR", eskiLitreOnce !== null && yakitEskiOnce.measured > 0, `${eskiLitreOnce} L`);
iddia("ÖNCE: ağustos ÖLÇÜLEBİLİYOR", yeniLitreOnce !== null && yakitYeniOnce.measured > 0, `${yeniLitreOnce} L`);

/**
 * 🔑 AY GRANÜLERLİĞİ KANITI — günlük parçalama yakıtı ŞİŞİRİYOR.
 * Canlıda +%15,6/+%28,9 ölçülmüştü; burada aynı yönün tohum verisinde de
 * göründüğünü doğruluyoruz (büyüklük tohuma bağlı, YÖN yapısal).
 */
{
  let gunlukTop = 0;
  for (let g = 0; g < 30; g++) {
    const b = new Date(ESKI.start.getTime() + g * 86_400_000);
    const s = new Date(b.getTime() + 86_400_000);
    const r = await buildFuelReport({ start: b, end: s });
    gunlukTop += Number(r.totalConsumedLiters ?? 0);
  }
  const sapma = eskiLitreOnce ? ((gunlukTop - eskiLitreOnce) / eskiLitreOnce) * 100 : 0;
  console.log(`    günlük parça toplamı=${gunlukTop.toFixed(1)} L · aylık tek pencere=${eskiLitreOnce} L · sapma %${sapma.toFixed(1)}`);
  iddia("günlük parçalama aylıkla AYNI DEĞİL (özet neden aylık)", Math.abs(sapma) > 1, `sapma %${sapma.toFixed(1)}`);
}

// ═════════════════════ 4 · KAPALIYKEN SİLME YOK ═════════════════════════

baslik("4 · 🔴 AYAR KAPALIYKEN SİLME YOK");

const ayarBaslangic = await saklamaAyari();
iddia("varsayılan ham_gun = 90", ayarBaslangic.hamGun === 90, `${ayarBaslangic.hamGun}`);
iddia("varsayılan silme_acik = FALSE", ayarBaslangic.silmeAcik === false);

{
  const d = await silmeDurumu();
  iddia("kapalı ayarda kapı REDDEDİYOR", d.kapi.izin === false && d.kapi.engel === "ayar_kapali", d.kapi.ayrinti);
  const T = await oncekiTelemetri();
  iddia("hiçbir satır silinmedi", T === T0, `${T} satır`);
}

// ═════════════════════ 5 · SIRA KAPISI ══════════════════════════════════

baslik("5 · SIRA KAPISI — ayar açık ama hazırlık eksik");

await saklamaAyariYaz({ hamGun: 90, silmeAcik: true, gerekce: null }, null);
{
  const d = await silmeDurumu();
  console.log(`    engel=${d.kapi.engel} · ${d.kapi.ayrinti}`);
  iddia("ayar açık ama hazırlık eksik → izin YOK", d.kapi.izin === false, `engel=${d.kapi.engel}`);
  iddia("engel ömür izi ya da özet/km", ["omur_izi_yok", "ozet_eksik", "km_donmadi"].includes(d.kapi.engel ?? ""));
  const T = await oncekiTelemetri();
  iddia("hâlâ hiçbir satır silinmedi", T === T0, `${T} satır`);
}

// ═════════════════════ 6 · HAZIRLIK ═════════════════════════════════════

baslik("6 · HAZIRLIK — ömür izi + aylık özet + km dondurma");

{
  const o = await omurIziniTazele();
  iddia("ömür izi yazıldı", o.ok && o.satir > 0, `${o.satir} araç`);
  const { data } = await supabaseAdmin.from("vehicle_telemetry_lifetime").select("vehicle_id, ilk_kayit, son_kayit");
  const nisanBasi = (data ?? []).some((r) => String(r.ilk_kayit).startsWith("2026-04"));
  iddia("ömür izi NİSAN başlangıcını tutuyor", nisanBasi);
}

{
  const r = await ayOzetiYaz("2026-04-01");
  iddia("nisan özeti yazıldı", r.ok, r.ok ? `${r.sonuc.arac} araç · ölçülen ${r.sonuc.olculen} · ölçülemeyen ${r.sonuc.olculemeyen}` : r.hata);
  const { data } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("vehicle_id, ay, litre, km, olculemedi_sebep, ornek_sayisi")
    .eq("ay", "2026-04-01");
  const satir = data ?? [];
  iddia("özet satırı var", satir.length > 0, `${satir.length} satır`);
  const olculen = satir.filter((s) => s.olculemedi_sebep === null);
  const olculemeyen = satir.filter((s) => s.olculemedi_sebep !== null);
  iddia("ölçülen araç özette litre taşıyor", olculen.length > 0 && olculen.every((s) => s.litre !== null));
  /**
   * 🔑 "ÖLÇÜLEMEDİ ≠ 0" — cihazsız QA-SAK03 özette 0 DEĞİL, null + sebep.
   */
  iddia(
    "cihazsız araç 0 DEĞİL null + sebep",
    olculemeyen.length > 0 && olculemeyen.every((s) => s.litre === null && s.olculemedi_sebep),
    olculemeyen.map((s) => s.olculemedi_sebep).join(",")
  );

  const ozetLitre = olculen.reduce((a, s) => a + Number(s.litre ?? 0), 0);
  console.log(`    özet litre toplamı=${ozetLitre.toFixed(1)} · raporun cevabı=${eskiLitreOnce}`);
  iddia(
    "🔑 ÖZET RAPORUN CEVABIYLA AYNI (ikinci hesap yok)",
    Math.abs(ozetLitre - (eskiLitreOnce ?? 0)) < 0.2,
    `fark ${(ozetLitre - (eskiLitreOnce ?? 0)).toFixed(2)} L`
  );
}

{
  const k = await kmDondur();
  iddia("km yargısı donduruldu", k.ok && k.dondurulan > 0, `${k.dondurulan} vardiya, kalan ${k.kalan}`);
  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("id, km_dondu")
    .in("id", [
      "cc000001-0000-4000-8000-000000000001",
      "cc000002-0000-4000-8000-000000000002",
    ]);
  const a = (data ?? []).find((r) => r.id.startsWith("cc000001"));
  const b = (data ?? []).find((r) => r.id.startsWith("cc000002"));
  iddia("sayaç farkı OLAN vardiya: ölçüldü=true", a?.km_dondu === true);
  /**
   * 🔑 SIRA KANITI: sayaç farkı 0 ama ham'da hareket VAR → "ölçülemedi".
   * Bu cevap ham silindikten SONRA üretilemezdi.
   */
  iddia("sayaç farkı YOK + hareket VAR: ölçülemedi=false", b?.km_dondu === false);
  iddia("dondurulmamış vardiya kalmadı", (await kmDonmamisSayisi()) === 0);
}

// ═════════════════════ 7 · SİLME ════════════════════════════════════════

baslik("7 · SİLME — dört kapı da açık");

{
  const d = await silmeDurumu();
  console.log(`    izin=${d.kapi.izin} · hazır ay=${d.hazirAylar.join(",")} · eksik=${d.eksikAylar.join(",")}`);
  iddia("kapı artık İZİN VERİYOR", d.kapi.izin === true, d.kapi.ayrinti || "engel yok");
  iddia("hazır ay listesi nisanı içeriyor", d.hazirAylar.includes("2026-04-01"));
  iddia("ağustos hazır listede YOK (kesimin ilerisinde)", !d.hazirAylar.includes("2026-08-01"));

  const kuru = await hamSil(d.ayar.hamGun, true);
  console.log(`    KURU: ${kuru.telemetri} telemetri + ${kuru.konum} konum silinirdi`);
  iddia("kuru mod satır SAYIYOR", kuru.telemetri > 0, `${kuru.telemetri}`);
  iddia("kuru mod HİÇBİR ŞEY SİLMEDİ", (await oncekiTelemetri()) === T0);

  const s = await hamSil(d.ayar.hamGun, false);
  iddia("silme çalıştı", s.ok, `${s.telemetri} telemetri · ${s.konum} konum · ${s.tur} tur`);
  await aylariSilinmisIsaretle(d.hazirAylar);
}

// ═════════════════════ 8 · SONRA ════════════════════════════════════════

baslik("8 · 🔑 SONRA — hangi yüzey ayakta, hangisi boşaldı");

const T1 = await oncekiTelemetri();
const N1 = await nisanSatir();
const A1 = await agustosSatir();
console.log(`    telemetri toplam=${T0}→${T1} · nisan=${N0}→${N1} · ağustos=${A0}→${A1}`);
iddia("🔑 NİSAN ham satırları SİLİNDİ", N1 === 0, `${N0} → ${N1}`);
iddia("🔑 AĞUSTOS ham satırları DURUYOR", A1 === A0, `${A0} → ${A1}`);

{
  const yakitYeniSonra = await buildFuelReport(YENI);
  const l = litre(yakitYeniSonra);
  console.log(`    yakıt AĞUSTOS: ${yeniLitreOnce} → ${l} L`);
  iddia("🔑 AĞUSTOS yakıt raporu DEĞİŞMEDİ", l === yeniLitreOnce, `${yeniLitreOnce} → ${l}`);
}

{
  const yakitEskiSonra = await buildFuelReport(ESKI);
  const l = litre(yakitEskiSonra);
  console.log(`    yakıt NİSAN: ${eskiLitreOnce} → ${l} (ölçülen ${yakitEskiSonra.measured})`);
  /**
   * 🔑 EN ÖNEMLİ İDDİA. Silme sonrası nisan raporu 0 L DEĞİL, "ölçülemedi"
   * demeli. `measured === 0` olduğu için ekran "—" basıyor (FuelClient) ve
   * maliyet raporuna geçen litre null (yakit/page.tsx `measured > 0` kapısı).
   */
  iddia("🔑 NİSAN raporu ÖLÇÜLEMEDİ diyor (0 L DEĞİL)", yakitEskiSonra.measured === 0 && l === null, `measured=${yakitEskiSonra.measured}`);
}

{
  const { data } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("litre, km, olculemedi_sebep, ham_silindi_at")
    .eq("ay", "2026-04-01");
  const satir = data ?? [];
  const olculen = satir.filter((s) => s.olculemedi_sebep === null);
  const ozetLitre = olculen.reduce((a, s) => a + Number(s.litre ?? 0), 0);
  console.log(`    özet NİSAN litre=${ozetLitre.toFixed(1)} (ham silindikten SONRA)`);
  iddia("🔑 AYLIK ÖZET SİLMEDEN SONRA DA AYAKTA", satir.length > 0 && ozetLitre > 0, `${satir.length} satır · ${ozetLitre.toFixed(1)} L`);
  iddia(
    "🔑 özet, silmeden ÖNCEKİ rapor cevabıyla AYNI",
    Math.abs(ozetLitre - (eskiLitreOnce ?? 0)) < 0.2,
    `${ozetLitre.toFixed(1)} vs ${eskiLitreOnce}`
  );
  iddia("silinen ay işaretlendi", satir.every((s) => s.ham_silindi_at !== null));
}

{
  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("id, km_dondu")
    .in("id", ["cc000001-0000-4000-8000-000000000001", "cc000002-0000-4000-8000-000000000002"]);
  const a = (data ?? []).find((r) => r.id.startsWith("cc000001"));
  const b = (data ?? []).find((r) => r.id.startsWith("cc000002"));
  iddia("🔑 km yargısı silmeden SONRA da duruyor (A=ölçüldü)", a?.km_dondu === true);
  iddia("🔑 km yargısı silmeden SONRA da duruyor (B=ölçülemedi)", b?.km_dondu === false);
}

{
  const { data } = await supabaseAdmin.from("vehicle_telemetry_lifetime").select("ilk_kayit, son_kayit");
  const nisanBasi = (data ?? []).some((r) => String(r.ilk_kayit).startsWith("2026-04"));
  iddia("🔑 ömür izi silmeden SONRA da NİSAN'ı biliyor (sessiz araç uyarısı yaşıyor)", nisanBasi);
}

{
  // Türetilmiş kayıtlar: vardiya sayısı değişmedi.
  const { count } = await supabaseAdmin.from("time_entries").select("id", { count: "exact", head: true });
  iddia("türetilmiş kayıtlar (vardiya) SİLİNMEDİ", (count ?? 0) >= 3, `${count} vardiya`);
}

// ═════════════════════ 9 · İKİNCİ TUR ═══════════════════════════════════

baslik("9 · İKİNCİ TUR — silinmiş ayın özeti EZİLMEZ");

{
  const oncekiOzet = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("vehicle_id, litre")
    .eq("ay", "2026-04-01");
  const onceMap = new Map((oncekiOzet.data ?? []).map((r) => [r.vehicle_id, r.litre]));

  const r = await ayOzetiYaz("2026-04-01");
  iddia("silinmiş ay yeniden yazılabilir çağrısı hata vermez", r.ok);

  const sonraOzet = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("vehicle_id, litre")
    .eq("ay", "2026-04-01");
  const degisti = (sonraOzet.data ?? []).filter((r2) => onceMap.get(r2.vehicle_id) !== r2.litre);
  iddia(
    "🔑 ham silinmiş ayın özeti SIFIRLA EZİLMEDİ",
    degisti.length === 0,
    degisti.length ? `${degisti.length} satır değişti` : "hiçbir satır değişmedi"
  );
}

// ═════════════════════ SONUÇ ════════════════════════════════════════════

console.log(`\n${"═".repeat(60)}`);
console.log(`  GEÇTİ: ${gecti}  ·  KALDI: ${kaldi}`);
if (kaldi > 0) {
  console.log(`\n  BAŞARISIZ İDDİALAR:`);
  hatalar.forEach((h) => console.log(`    ✗ ${h}`));
}
console.log(`${"═".repeat(60)}\n`);
process.exit(kaldi > 0 ? 1 : 0);
