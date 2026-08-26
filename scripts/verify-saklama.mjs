/**
 * SAKLAMA DOĞRULAMASI (migration 090).
 *
 * QA harness'ında koşar (Docker Postgres + PostgREST). ÜRETİMDE ÇALIŞTIRMAYIN —
 * betik gerçekten SİLER.
 *
 * ═══ NE KANITLIYOR ═══
 *
 *   1. Saf katman: kategoriler, aralık kuralları, uyarı aciliyeti, eşik
 *   2. 🔴 OTOMATİK SİLME YOK — şemada anahtar yok, gün-bazlı fonksiyon yok
 *   3. 🔴 YASAL EŞİK TABLOSU BOŞ — uydurma sayı yok
 *   4. Elle silme kapısı: altı şart, hepsi ayrı ayrı
 *   5. Uyarı üretimi
 *   6. Hazırlık: ömür izi + aylık özet + km dondurma
 *   7. 🔑 ÖNCE/SONRA: silme sonrası HANGİ yüzey ayakta, HANGİSİ boşaldı
 *   8. Denetim izi: kim, ne zaman, hangi aralık, kaç satır, sebep
 *   9. "Ölçülemedi ≠ 0": cihazsız araç 0 değil `null` + sebep
 */

import {
  ARALIK_MAX_GUN,
  SEBEP_MIN_UZUNLUK,
  SIL_ONAY_METNI,
  aralikDenetle,
  ayAraligi,
  ayBasi,
  aySiniri,
  ayarDenetle,
  aylar,
  esikGosterilebilir,
  haftaAraligi,
  pencereKapsami,
  silinebilirMi,
  silmeKapisi,
  uyariAciliyeti,
  uyariCikarMi,
  uyariKesimi,
  uyariVarMi,
} from "@/lib/saklama";
import { supabaseAdmin } from "@/lib/supabase";
import { buildFuelReport } from "@/lib/reports";
import {
  saklamaAyari,
  saklamaAyariYaz,
  kategoriler,
  tabloKategorisi,
  yasalEsik,
  uyarilar,
  omurIziniTazele,
  hamVeriBaslangici,
  ayOzetiYaz,
  hazirligiIlerlet,
  hazirlikDurumu,
  manuelSil,
  silmeIzi,
  aralikSatirSayisi,
} from "@/lib/saklama-db";
import { kuralSaklamaUyarisi, TABAN } from "@/lib/haftalik-aksiyon";

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
const baslik = (s) => console.log(`\n═══ ${s} ═══`);

// ⚠️ Anahtar adları buildFuelReport'un DateRange sözleşmesi: start/end.
const ESKI = { start: new Date("2026-04-01T00:00:00Z"), end: new Date("2026-05-01T00:00:00Z") };
const YENI = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-21T00:00:00Z") };
const NISAN = { bas: ESKI.start, bit: ESKI.end };

const litre = (r) => (r.measured === 0 ? null : Number(r.totalConsumedLiters.toFixed(1)));
const SEBEP = "QA provasi: nisan ham izi silme kanitlanmasi icin";

// ═════════════════════ 1 · SAF KATMAN ═══════════════════════════════════

baslik("1 · SAF KATMAN — kurallar veritabanına dokunmadan");

iddia("varsayılan 90 gün + AT kabul", ayarDenetle(90, "AT") === null);
iddia("0 gün reddedilir", ayarDenetle(0, "AT") === "gun_araligi");
iddia("3651 gün reddedilir", ayarDenetle(3651, "AT") === "gun_araligi");
iddia("tek harfli ülke reddedilir", ayarDenetle(90, "A") === "ulke_kodu");
iddia("küçük harfli ülke reddedilir", ayarDenetle(90, "at") === "ulke_kodu");
iddia("30 gün de kabul (eşik SİLMEZ, alt sınır yok)", ayarDenetle(30, "DE") === null);

{
  const k = uyariKesimi(90, new Date("2026-08-26T00:00:00Z"));
  iddia("90 günlük uyarı kesimi 28.05.2026", k.toISOString().startsWith("2026-05-28"), k.toISOString());
}

baslik("1b · KATEGORİLER");
iddia("kişisel veri silinebilir", silinebilirMi("kisisel") === true);
iddia("araç verisi silinebilir", silinebilirMi("arac") === true);
iddia("🔑 yasal zorunlu SİLİNEMEZ", silinebilirMi("yasal_zorunlu") === false);
iddia("uyarı yalnız KİŞİSEL veri için", uyariCikarMi("kisisel") === true && uyariCikarMi("arac") === false);
iddia("yasal zorunlu için uyarı çıkmaz", uyariCikarMi("yasal_zorunlu") === false);

baslik("1c · YASAL EŞİK — kaynaksız sayı gösterilmez");
iddia("null eşik gösterilmez", esikGosterilebilir(null) === false);
iddia("esikGun null → gösterilmez", esikGosterilebilir({ esikGun: null, yasalDayanak: "x", kaynakUrl: "y", dogrulanmaTarihi: "2026-01-01" }) === false);
iddia("🔑 kaynaksız eşik gösterilmez", esikGosterilebilir({ esikGun: 60, yasalDayanak: null, kaynakUrl: null, dogrulanmaTarihi: null }) === false);
iddia("tarihsiz eşik gösterilmez", esikGosterilebilir({ esikGun: 60, yasalDayanak: "x", kaynakUrl: "y", dogrulanmaTarihi: null }) === false);
iddia("tam kayıt gösterilir", esikGosterilebilir({ esikGun: 60, yasalDayanak: "x", kaynakUrl: "y", dogrulanmaTarihi: "2026-01-01" }) === true);

baslik("1d · ARALIK KURALLARI");
{
  const h = haftaAraligi(new Date("2026-08-26T12:00:00Z")); // Çarşamba
  iddia("hafta Pazartesi başlar", h.bas.getUTCDay() === 1, h.bas.toISOString().slice(0, 10));
  iddia("hafta 7 gün", (h.bit - h.bas) / 86_400_000 === 7);
  const a = ayAraligi(new Date("2026-04-17T00:00:00Z"));
  iddia("ay 1 Nisan → 1 Mayıs", a.bas.toISOString().startsWith("2026-04-01") && a.bit.toISOString().startsWith("2026-05-01"));
}
{
  const simdi = new Date("2026-08-26T00:00:00Z");
  iddia("geçerli aralık kabul", aralikDenetle(NISAN, simdi) === null);
  iddia("ters aralık reddedilir", aralikDenetle({ bas: ESKI.end, bit: ESKI.start }, simdi) === "ters_aralik");
  iddia(
    "🔑 GELECEĞE uzanan aralık reddedilir",
    aralikDenetle({ bas: new Date("2026-08-01T00:00:00Z"), bit: new Date("2026-09-30T00:00:00Z") }, simdi) === "gelecek"
  );
  iddia(
    `🔑 ${ARALIK_MAX_GUN} günden uzun aralık reddedilir`,
    aralikDenetle({ bas: new Date("2024-01-01T00:00:00Z"), bit: new Date("2026-08-01T00:00:00Z") }, simdi) === "cok_uzun"
  );
}

baslik("1e · AY YARDIMCILARI");
iddia("ay başı biçimi", ayBasi(new Date("2026-04-17T00:00:00Z")) === "2026-04-01");
iddia("aylar() ay listesi", aylar(ESKI.start, YENI.end).length === 5, aylar(ESKI.start, YENI.end).join(","));
{
  const s = aySiniri("2026-04-01");
  iddia("ay sınırı [1 Nis, 1 May)", s.bas.toISOString().startsWith("2026-04-01") && s.bit.toISOString().startsWith("2026-05-01"));
}

baslik("1f · UYARI ACİLİYETİ");
{
  const temel = { tabloAdi: "device_telemetry", kategori: "kisisel", satirSayisi: 100, uyariGun: 90, ulkeKodu: "AT", yasalEsikGun: null, yasalDayanak: null, kaynakUrl: null, enEski: null };
  iddia("0 satır → uyarı yok", uyariVarMi({ ...temel, satirSayisi: 0, enEskiGun: 100 }) === false);
  iddia("araç verisi → uyarı yok", uyariVarMi({ ...temel, kategori: "arac", enEskiGun: 100 }) === false);
  iddia("eşiğin altında → aciliyet 0", uyariAciliyeti({ ...temel, enEskiGun: 80 }) === 0);
  iddia("bir kat aşım → aciliyet 100", uyariAciliyeti({ ...temel, enEskiGun: 180 }) === 100);
  iddia("aciliyet tavanı 100", uyariAciliyeti({ ...temel, enEskiGun: 900 }) === 100);
}

// ═════════════════════ 2 · SİLME KAPISI (saf) ═══════════════════════════

baslik("2 · ELLE SİLME KAPISI — altı şart");
const tamGirdi = {
  kategori: "kisisel",
  aralikHatasi: null,
  ozetiEksikAylar: [],
  kmDonmamisVardiya: 0,
  omurIziSatir: 3,
  onayMetni: SIL_ONAY_METNI,
  sebep: SEBEP,
};
iddia("🔑 yasal zorunlu → izin YOK", silmeKapisi({ ...tamGirdi, kategori: "yasal_zorunlu" }).engel === "kategori_yasal");
iddia("geçersiz aralık → izin YOK", silmeKapisi({ ...tamGirdi, aralikHatasi: "gelecek" }).engel === "aralik_gecersiz");
iddia("🔑 onay metni YANLIŞ → izin YOK", silmeKapisi({ ...tamGirdi, onayMetni: "sil lutfen" }).engel === "onay_yanlis");
iddia("onay metni BOŞ → izin YOK", silmeKapisi({ ...tamGirdi, onayMetni: "" }).engel === "onay_yanlis");
iddia("küçük harf 'sil' KABUL (büyük/küçük duyarsız)", silmeKapisi({ ...tamGirdi, onayMetni: "sil" }).izin === true);
iddia("kısa sebep → izin YOK", silmeKapisi({ ...tamGirdi, sebep: "kisa" }).engel === "sebep_kisa");
iddia("ömür izi yok → izin YOK", silmeKapisi({ ...tamGirdi, omurIziSatir: 0 }).engel === "omur_izi_yok");
iddia("km dondurulmamış → izin YOK", silmeKapisi({ ...tamGirdi, kmDonmamisVardiya: 7 }).engel === "km_donmadi");
iddia("özet eksik → izin YOK", silmeKapisi({ ...tamGirdi, ozetiEksikAylar: ["2026-04-01"] }).engel === "ozet_eksik");
iddia("altısı da tamam → izin VAR", silmeKapisi(tamGirdi).izin === true);

// ═════════════════════ 3 · ŞEMA: OTOMATİK SİLME YOK ═════════════════════

baslik("3 · 🔴 ŞEMADA OTOMATİK SİLME YOK");
{
  const ayar = await saklamaAyari();
  iddia("migration 090 uygulandı", ayar.tabloYok === false);
  iddia("varsayılan uyarı eşiği 90 gün", ayar.uyariGun === 90, `${ayar.uyariGun}`);
  iddia("varsayılan ülke AT", ayar.ulkeKodu === "AT");
  iddia(
    "🔑 `silme_acik` diye bir alan YOK",
    !Object.prototype.hasOwnProperty.call(ayar, "silmeAcik"),
    "otomatik silme anahtarı kaldırıldı"
  );

  const { data: kolonlar } = await supabaseAdmin.from("tenant_saklama").select("*").limit(1);
  const alanlar = Object.keys(kolonlar?.[0] ?? {});
  iddia("🔑 tabloda da `silme_acik` kolonu YOK", !alanlar.includes("silme_acik"), alanlar.join(","));
  iddia("tabloda `uyari_gun` var", alanlar.includes("uyari_gun"));
  iddia("tabloda `ulke_kodu` var", alanlar.includes("ulke_kodu"));
}

baslik("3b · 🔴 YASAL EŞİK TABLOSU BOŞ — uydurma sayı yok");
{
  const { count } = await supabaseAdmin.from("saklama_esikleri").select("*", { count: "exact", head: true });
  iddia("🔑 saklama_esikleri BOŞ", (count ?? -1) === 0, `${count} satır`);
  const e = await yasalEsik("AT", "ham_konum");
  iddia("🔑 AT/ham_konum çıpası YOK (null)", e === null, "eşikler ayrı araştırma turuyla gelecek");
}

baslik("3c · KATEGORİ KAYDI");
{
  const kats = await kategoriler();
  iddia("kategori kaydı dolu", kats.length >= 10, `${kats.length} satır`);
  iddia("🔑 device_telemetry KİŞİSEL veri", (await tabloKategorisi("device_telemetry")) === "kisisel", "GPS izi şoförün");
  iddia("driver_locations kişisel", (await tabloKategorisi("driver_locations")) === "kisisel");
  iddia("vehicles ARAÇ verisi", (await tabloKategorisi("vehicles")) === "arac");
  iddia("🔑 time_entries YASAL ZORUNLU", (await tabloKategorisi("time_entries")) === "yasal_zorunlu");
  iddia("🔑 teslimat_kanitlari yasal zorunlu", (await tabloKategorisi("teslimat_kanitlari")) === "yasal_zorunlu");
  iddia("🔑 silme izinin KENDİSİ yasal zorunlu", (await tabloKategorisi("saklama_silme_izi")) === "yasal_zorunlu");
  iddia(
    "🔑 FAIL-CLOSED: sınıflandırılmamış tablo yasal zorunlu sayılır",
    (await tabloKategorisi("bilinmeyen_tablo_xyz")) === "yasal_zorunlu"
  );
  iddia("her kategorinin gerekçesi yazılı", kats.every((k) => k.gerekce.length > 10));
}

// ═════════════════════ 4 · ÖNCE ═════════════════════════════════════════

baslik("4 · ÖNCE — silmeden önceki ölçüm");
const sayTel = async () => {
  const { count } = await supabaseAdmin.from("device_telemetry").select("id", { count: "exact", head: true });
  return count ?? 0;
};
const sayNisan = () => aralikSatirSayisi("device_telemetry", NISAN);
const sayAgustos = () =>
  aralikSatirSayisi("device_telemetry", { bas: YENI.start, bit: new Date("2026-09-01T00:00:00Z") });

const T0 = await sayTel();
const N0 = await sayNisan();
const A0 = await sayAgustos();
console.log(`    telemetri toplam=${T0} · nisan=${N0} · ağustos=${A0}`);
iddia("tohum yüklü — nisan satırı var", N0 > 0, `${N0} satır`);
iddia("tohum yüklü — ağustos satırı var", A0 > 0, `${A0} satır`);

const yakitEskiOnce = await buildFuelReport(ESKI);
const yakitYeniOnce = await buildFuelReport(YENI);
const eskiLitreOnce = litre(yakitEskiOnce);
const yeniLitreOnce = litre(yakitYeniOnce);
console.log(`    yakıt NİSAN=${eskiLitreOnce} L (ölçülen ${yakitEskiOnce.measured}/${yakitEskiOnce.vehicleCount}) · AĞUSTOS=${yeniLitreOnce} L`);
iddia("ÖNCE: nisan ÖLÇÜLEBİLİYOR", eskiLitreOnce !== null && yakitEskiOnce.measured > 0, `${eskiLitreOnce} L`);
iddia("ÖNCE: ağustos ÖLÇÜLEBİLİYOR", yeniLitreOnce !== null && yakitYeniOnce.measured > 0, `${yeniLitreOnce} L`);

{
  // 🔑 AY GRANÜLERLİĞİ — günlük parçalama yakıtı ŞİŞİRİYOR.
  let gunlukTop = 0;
  for (let g = 0; g < 30; g++) {
    const b = new Date(ESKI.start.getTime() + g * 86_400_000);
    const r = await buildFuelReport({ start: b, end: new Date(b.getTime() + 86_400_000) });
    gunlukTop += Number(r.totalConsumedLiters ?? 0);
  }
  const sapma = eskiLitreOnce ? ((gunlukTop - eskiLitreOnce) / eskiLitreOnce) * 100 : 0;
  console.log(`    günlük parça=${gunlukTop.toFixed(1)} L · aylık tek pencere=${eskiLitreOnce} L · sapma %${sapma.toFixed(1)}`);
  iddia("🔑 günlük parçalama aylıkla AYNI DEĞİL (özet neden aylık)", Math.abs(sapma) > 1, `sapma %${sapma.toFixed(1)}`);
}

// ═════════════════════ 5 · UYARI ════════════════════════════════════════

baslik("5 · UYARI ÜRETİMİ — sistem yalnız uyarır");
await saklamaAyariYaz({ uyariGun: 30, ulkeKodu: "AT", gerekce: null }, null);
{
  const { uyarilar: liste, hata } = await uyarilar();
  iddia("uyarı üretildi", !hata && liste.length > 0, `${liste.length} tablo`);
  const dt = liste.find((u) => u.tabloAdi === "device_telemetry");
  iddia("device_telemetry uyarısı var", !!dt);
  iddia("uyarı satır sayısı > 0", (dt?.satirSayisi ?? 0) > 0, `${dt?.satirSayisi} satır`);
  iddia("uyarı en eski yaşı ölçülü", dt?.enEskiGun !== null && dt?.enEskiGun > 30, `${dt?.enEskiGun} gün`);
  iddia("🔑 yasal çıpa NULL — sayı uydurulmadı", dt?.yasalEsikGun === null);
  iddia("uyarı yalnız KİŞİSEL tablolar için", liste.every((u) => u.kategori === "kisisel"));

  // 084 kuralı — aynı girdiden kalem üretiyor mu
  const kalem = kuralSaklamaUyarisi({
    satirSayisi: dt.satirSayisi,
    enEskiGun: dt.enEskiGun,
    uyariGun: dt.uyariGun,
    ulkeKodu: dt.ulkeKodu,
    yasalEsikGun: dt.yasalEsikGun,
    yasalDayanak: dt.yasalDayanak,
  });
  iddia("🔑 084 kuralı kalem üretiyor", kalem !== null);
  iddia("kalemin öznesi YOK (kiracının kendisi)", kalem.workerId === null && kalem.vehicleId === null && kalem.musteriId === null);
  iddia("kalem /admin/saklama'ya gidiyor", kalem.hedefYol === "/admin/saklama");
  iddia("🔑 çıpa yokken cümlede SAYI GEÇMİYOR", kalem.gerekce.includes("DOĞRULANMADI"), "uydurma sayı yok");
  iddia("kanıt yasalCipaDogrulandi=false taşıyor", kalem.kanit.yasalCipaDogrulandi === false);
  iddia("TABAN 450 (yakıt 400 üstü, skor 500 altı)", TABAN.saklama_uyarisi === 450);
  iddia("kalem 'silin' DEMİYOR", !kalem.baslik.toLowerCase().includes("silin"), kalem.baslik.slice(0, 60));

  // Eşiğin altında uyarı ÇIKMAZ
  const yok = kuralSaklamaUyarisi({ satirSayisi: 100, enEskiGun: 10, uyariGun: 90, ulkeKodu: "AT", yasalEsikGun: null, yasalDayanak: null });
  iddia("eşiğin altında kalem ÜRETİLMEZ", yok === null);
}
await saklamaAyariYaz({ uyariGun: 90, ulkeKodu: "AT", gerekce: null }, null);

// ═════════════════════ 6 · ÖN KOŞULLAR EKSİKKEN SİLME YOK ═══════════════

baslik("6 · 🔴 ÖN KOŞUL EKSİKKEN SİLME YOK");
{
  const r = await manuelSil({
    tablo: "device_telemetry",
    aralik: NISAN,
    sebep: SEBEP,
    onayMetni: SIL_ONAY_METNI,
    workerId: null,
    kuru: false,
  });
  iddia("hazırlık eksikken silme REDDEDİLDİ", r.ok === false, `engel=${r.kapi.engel}`);
  iddia("engel ömür izi / özet / km", ["omur_izi_yok", "ozet_eksik", "km_donmadi"].includes(r.kapi.engel ?? ""));
  iddia("hiçbir satır silinmedi", (await sayTel()) === T0, `${T0} satır`);
}

// ═════════════════════ 7 · HAZIRLIK ═════════════════════════════════════

baslik("7 · HAZIRLIK — ömür izi + aylık özet + km dondurma");
{
  const o = await omurIziniTazele();
  iddia("ömür izi yazıldı", o.ok && o.satir > 0, `${o.satir} araç`);
  const bas = await hamVeriBaslangici();
  iddia("ham veri başlangıcı NİSAN", bas !== null && bas.toISOString().startsWith("2026-04"), bas?.toISOString());
}
{
  const r = await hazirligiIlerlet(NISAN);
  iddia("hazırlık ilerledi", r.ok, r.ok ? `özet ${r.ozetYazilan.length} ay · km ${r.kmDondurulan}` : r.hata);
  const d = await hazirlikDurumu(NISAN);
  iddia("nisan özeti yazıldı", d.eksikAylar.length === 0, `hazır: ${d.hazirAylar.join(",")}`);
  iddia("aralıkta dondurulmamış vardiya kalmadı", d.kmDonmamis === 0);
}
{
  const { data } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("vehicle_id, litre, km, olculemedi_sebep")
    .eq("ay", "2026-04-01");
  const satir = data ?? [];
  iddia("özet satırı var", satir.length > 0, `${satir.length} satır`);
  const olculen = satir.filter((s) => s.olculemedi_sebep === null);
  const olculemeyen = satir.filter((s) => s.olculemedi_sebep !== null);
  iddia("ölçülen araç litre taşıyor", olculen.length > 0 && olculen.every((s) => s.litre !== null));
  iddia(
    "🔑 cihazsız araç 0 DEĞİL null + sebep",
    olculemeyen.length > 0 && olculemeyen.every((s) => s.litre === null && s.olculemedi_sebep),
    olculemeyen.map((s) => s.olculemedi_sebep).join(",")
  );
  const ozetLitre = olculen.reduce((a, s) => a + Number(s.litre ?? 0), 0);
  iddia(
    "🔑 ÖZET RAPORUN CEVABIYLA AYNI (ikinci hesap yok)",
    Math.abs(ozetLitre - (eskiLitreOnce ?? 0)) < 0.2,
    `${ozetLitre.toFixed(1)} vs ${eskiLitreOnce}`
  );
}
{
  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("id, km_dondu")
    .in("id", ["cc000001-0000-4000-8000-000000000001", "cc000002-0000-4000-8000-000000000002"]);
  const a = (data ?? []).find((r) => r.id.startsWith("cc000001"));
  const b = (data ?? []).find((r) => r.id.startsWith("cc000002"));
  iddia("sayaç farkı OLAN vardiya: ölçüldü=true", a?.km_dondu === true);
  iddia("🔑 sayaç farkı YOK + hareket VAR: ölçülemedi=false", b?.km_dondu === false, "ham olmadan üretilemezdi");
}

// ═════════════════════ 8 · KURU MOD + ÇİFT ONAY ═════════════════════════

baslik("8 · KURU MOD ve ÇİFT ONAY");
{
  const kuru = await manuelSil({
    tablo: "device_telemetry",
    aralik: NISAN,
    sebep: "",
    onayMetni: "",
    workerId: null,
    kuru: true,
  });
  iddia("kuru mod satır SAYIYOR", kuru.ok && kuru.satir === N0, `${kuru.satir} satır`);
  iddia("kuru mod HİÇBİR ŞEY SİLMEDİ", (await sayTel()) === T0);
  iddia("kuru modda kapı İZİN veriyor (ön koşullar tamam)", kuru.kapi.izin === true);
}
{
  const r = await manuelSil({
    tablo: "device_telemetry",
    aralik: NISAN,
    sebep: SEBEP,
    onayMetni: "evet sil",
    workerId: null,
    kuru: false,
  });
  iddia("🔑 YANLIŞ onay metniyle silme REDDEDİLDİ", r.ok === false && r.kapi.engel === "onay_yanlis");
  iddia("hiçbir satır silinmedi", (await sayTel()) === T0);
}
{
  const r = await manuelSil({
    tablo: "device_telemetry",
    aralik: NISAN,
    sebep: "kisa",
    onayMetni: SIL_ONAY_METNI,
    workerId: null,
    kuru: false,
  });
  iddia("🔑 KISA sebeple silme REDDEDİLDİ", r.ok === false && r.kapi.engel === "sebep_kisa", `min ${SEBEP_MIN_UZUNLUK}`);
  iddia("hiçbir satır silinmedi", (await sayTel()) === T0);
}
{
  const r = await manuelSil({
    tablo: "device_telemetry",
    aralik: { bas: new Date("2026-08-01T00:00:00Z"), bit: new Date("2027-01-01T00:00:00Z") },
    sebep: SEBEP,
    onayMetni: SIL_ONAY_METNI,
    workerId: null,
    kuru: false,
  });
  iddia("🔑 GELECEĞE uzanan aralık REDDEDİLDİ", r.ok === false && r.kapi.engel === "aralik_gecersiz");
  iddia("hiçbir satır silinmedi", (await sayTel()) === T0);
}
{
  const izOnce = await silmeIzi();
  iddia("reddedilen denemeler denetim izine YAZILMADI", izOnce.length === 0, `${izOnce.length} kayıt`);
}

// ═════════════════════ 9 · GERÇEK SİLME ═════════════════════════════════

baslik("9 · GERÇEK SİLME — çift onay verildi");
{
  const r = await manuelSil({
    tablo: "device_telemetry",
    aralik: NISAN,
    sebep: SEBEP,
    onayMetni: SIL_ONAY_METNI,
    workerId: "aa000001-0000-4000-8000-000000000001",
    kuru: false,
  });
  iddia("silme çalıştı", r.ok === true, `${r.satir} satır · ${r.tur} tur`);
  iddia("silinen sayı kuru modun sayısıyla aynı", r.satir === N0, `${r.satir} vs ${N0}`);
}

// ═════════════════════ 10 · SONRA ═══════════════════════════════════════

baslik("10 · 🔑 SONRA — hangi yüzey ayakta, hangisi boşaldı");
const T1 = await sayTel();
const N1 = await sayNisan();
const A1 = await sayAgustos();
console.log(`    telemetri toplam=${T0}→${T1} · nisan=${N0}→${N1} · ağustos=${A0}→${A1}`);
iddia("🔑 NİSAN ham satırları SİLİNDİ", N1 === 0, `${N0} → ${N1}`);
iddia("🔑 AĞUSTOS ham satırları DURUYOR", A1 === A0, `${A0} → ${A1}`);

{
  const l = litre(await buildFuelReport(YENI));
  iddia("🔑 AĞUSTOS yakıt raporu DEĞİŞMEDİ", l === yeniLitreOnce, `${yeniLitreOnce} → ${l}`);
}
{
  const r = await buildFuelReport(ESKI);
  const l = litre(r);
  iddia("🔑 NİSAN raporu ÖLÇÜLEMEDİ diyor (0 L DEĞİL)", r.measured === 0 && l === null, `measured=${r.measured}`);
}
{
  const { data } = await supabaseAdmin
    .from("vehicle_month_metrics")
    .select("litre, olculemedi_sebep, ham_silindi_at")
    .eq("ay", "2026-04-01");
  const satir = data ?? [];
  const olculen = satir.filter((s) => s.olculemedi_sebep === null);
  const ozetLitre = olculen.reduce((a, s) => a + Number(s.litre ?? 0), 0);
  iddia("🔑 AYLIK ÖZET SİLMEDEN SONRA DA AYAKTA", satir.length > 0 && ozetLitre > 0, `${ozetLitre.toFixed(1)} L`);
  iddia("🔑 özet, silmeden ÖNCEKİ rapor cevabıyla AYNI", Math.abs(ozetLitre - (eskiLitreOnce ?? 0)) < 0.2);
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
  const bas = await hamVeriBaslangici();
  iddia("🔑 ömür izi NİSAN'ı hâlâ biliyor (sessiz araç uyarısı yaşıyor)", bas !== null && bas.toISOString().startsWith("2026-04"));
}
{
  const { count } = await supabaseAdmin.from("time_entries").select("id", { count: "exact", head: true });
  iddia("türetilmiş kayıtlar (vardiya) SİLİNMEDİ", (count ?? 0) >= 3, `${count} vardiya`);
}
{
  // Kapsam şeridi: ham başlangıcı NİSAN kaldığı için mart penceresi dışarıda.
  const bas = await hamVeriBaslangici();
  const k = pencereKapsami(new Date("2026-02-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"), bas);
  iddia("kapsam şeridi: eski pencere tamamen_disi", k.tur === "tamamen_disi", `kayıp ${k.kayipGun} gün`);
  const k2 = pencereKapsami(YENI.start, YENI.end, bas);
  iddia("kapsam şeridi: ağustos icinde", k2.tur === "icinde");
}

// ═════════════════════ 11 · DENETİM İZİ ═════════════════════════════════

baslik("11 · 🔑 DENETİM İZİ");
{
  const iz = await silmeIzi();
  iddia("iz kaydı yazıldı", iz.length === 1, `${iz.length} kayıt`);
  const x = iz[0];
  iddia("izde KİM yazılı", x.silenAd === "QA Sofor Bir", x.silenAd ?? "—");
  iddia("izde NE ZAMAN yazılı", !!x.silindiAt);
  iddia("izde HANGİ TABLO yazılı", x.tabloAdi === "device_telemetry");
  iddia("izde KATEGORİ yazılı", x.kategori === "kisisel");
  iddia("izde ARALIK yazılı", x.aralikBas.startsWith("2026-04-01") && x.aralikBit.startsWith("2026-05-01"));
  iddia("izde KAÇ SATIR yazılı", x.satirSayisi === N0, `${x.satirSayisi}`);
  iddia("izde SEBEP yazılı", x.sebep === SEBEP);
}

// ═════════════════════ 12 · İKİNCİ TUR ══════════════════════════════════

baslik("12 · İKİNCİ TUR — silinmiş ayın özeti EZİLMEZ");
{
  const once = await supabaseAdmin.from("vehicle_month_metrics").select("vehicle_id, litre").eq("ay", "2026-04-01");
  const onceMap = new Map((once.data ?? []).map((r) => [r.vehicle_id, r.litre]));
  const r = await ayOzetiYaz("2026-04-01");
  iddia("silinmiş ay için çağrı hata vermez", r.ok);
  const sonra = await supabaseAdmin.from("vehicle_month_metrics").select("vehicle_id, litre").eq("ay", "2026-04-01");
  const degisti = (sonra.data ?? []).filter((x) => onceMap.get(x.vehicle_id) !== x.litre);
  iddia(
    "🔑 ham silinmiş ayın özeti SIFIRLA EZİLMEDİ",
    degisti.length === 0,
    degisti.length ? `${degisti.length} satır değişti` : "hiçbir satır değişmedi"
  );
}

// ═════════════════════ SONUÇ ════════════════════════════════════════════

console.log(`\n${"═".repeat(60)}`);
console.log(`  GEÇTİ: ${gecti}  ·  KALDI: ${kaldi}`);
if (kaldi > 0) hatalar.forEach((h) => console.log(`    ✗ ${h}`));
console.log(`${"═".repeat(60)}\n`);
process.exit(kaldi > 0 ? 1 : 0);
