#!/usr/bin/env node
/**
 * MEVZUAT ERKEN UYARI — KANIT (migration 086).
 *
 * Yığın: Docker Postgres 16 + PostgREST + proxy (docs/MEVZUAT-ERKEN-UYARI.md §Prova).
 * Saf katman DEĞİL, gerçek sorgular ve gerçek Expo ucu koşturulur.
 *
 * Kullanım:
 *   set -a; . <qa env>; set +a
 *   npm run verify:mevzuat
 */
import { supabaseAdmin } from "@/lib/supabase";
import {
  KURAL_SETLERI,
  kademeSec,
  kuralDurumu,
  setinTemeli,
  uyariMetni,
  VARSAYILAN_KADEME,
  VARDIYA_BAYAT_MS,
} from "@/lib/mevzuat";
import { mevzuatPanosu, mevzuatTara, mevzuatAyariYaz, surusTahminiOlc, uyariGecmisi } from "@/lib/mevzuat-db";
import { AZG_DAILY_MAX_MS, AZG_NIGHT_DAILY_MAX_MS } from "@/lib/azg-rules";

const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const ERKEN = "b1000000-0000-0000-0000-0000000000b1";
const YAKLASTI = "b2000000-0000-0000-0000-0000000000b2";
const SON = "b3000000-0000-0000-0000-0000000000b3";
const IHLAL = "b4000000-0000-0000-0000-0000000000b4";
const MOLALI = "b5000000-0000-0000-0000-0000000000b5";
const TELEMETRISIZ = "b6000000-0000-0000-0000-0000000000b6";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);
const AYAR = { ...VARSAYILAN_KADEME };

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · SAF KATMAN — kademe ve kalan süre");

  iddia("60 dk kala 'erken'", kademeSec(50, AYAR) === "erken", `50 dk → ${kademeSec(50, AYAR)}`);
  iddia("30 dk kala 'yaklasti'", kademeSec(20, AYAR) === "yaklasti", `20 dk → ${kademeSec(20, AYAR)}`);
  iddia("15 dk kala 'son'", kademeSec(8, AYAR) === "son", `8 dk → ${kademeSec(8, AYAR)}`);
  iddia("eşik aşılınca 'ihlal'", kademeSec(-30, AYAR) === "ihlal", `−30 dk → ${kademeSec(-30, AYAR)}`);
  iddia("uzaktayken kademe YOK (gürültü yok)", kademeSec(200, AYAR) === null, `200 dk → ${kademeSec(200, AYAR)}`);

  const kural6 = KURAL_SETLERI.AT_AZG.find((k) => k.ad === "mola_6sa");
  const d1 = kuralDurumu(kural6, { calismaMs: 5.5 * 3600e3, gece: false, molaDk: null, surusMs: null, surusBelirsizMs: null }, AYAR);
  iddia("kalan süre = eşik − ölçülen", d1.kalanDk === 30, `360 − 330 = ${d1.kalanDk} dk`);
  iddia("dayanak satırda taşınıyor", /13c/.test(d1.dayanak), d1.dayanak);

  // ── GECE TAVANI
  const tavan = KURAL_SETLERI.AT_AZG.find((k) => k.ad === "gunluk_tavan");
  const gunduz = kuralDurumu(tavan, { calismaMs: 0, gece: false, molaDk: null, surusMs: null, surusBelirsizMs: null }, AYAR);
  const gece = kuralDurumu(tavan, { calismaMs: 0, gece: true, molaDk: null, surusMs: null, surusBelirsizMs: null }, AYAR);
  iddia(
    "🔑 GECE TAVANI 12→10 saate iniyor (§ 14 Abs. 2)",
    gunduz.esikDk === AZG_DAILY_MAX_MS / 60000 && gece.esikDk === AZG_NIGHT_DAILY_MAX_MS / 60000,
    `gündüz ${gunduz.esikDk} dk · gece ${gece.esikDk} dk`
  );

  // ── ÖLÇÜLEMEDİ ≠ SIFIR
  const olcusuz = kuralDurumu(kural6, { calismaMs: null, gece: false, molaDk: null, surusMs: null, surusBelirsizMs: null }, AYAR);
  iddia(
    "🔑 ÖLÇÜLEMEYEN DEĞER null — SIFIR DEĞİL, sebebi KAYITLI",
    olcusuz.olculenDk === null && olcusuz.kalanDk === null && olcusuz.olculemediSebep === "vardiya_yok",
    `olculen=${olcusuz.olculenDk} · kalan=${olcusuz.kalanDk} · sebep=${olcusuz.olculemediSebep}`
  );

  // ── MOLA ÜÇ DURUMLU
  const molaYok = kuralDurumu(kural6, { calismaMs: 7 * 3600e3, gece: false, molaDk: null, surusMs: null, surusBelirsizMs: null }, AYAR);
  const molaAz = kuralDurumu(kural6, { calismaMs: 7 * 3600e3, gece: false, molaDk: 10, surusMs: null, surusBelirsizMs: null }, AYAR);
  const molaTam = kuralDurumu(kural6, { calismaMs: 7 * 3600e3, gece: false, molaDk: 35, surusMs: null, surusBelirsizMs: null }, AYAR);
  iddia("🔑 MOLA KAYDI YOK → 'bilinmiyor' (null), 'mola vermedi' DEĞİL", molaYok.molaKarsilandi === null, String(molaYok.molaKarsilandi));
  iddia("yetersiz mola → karşılanmadı", molaAz.molaKarsilandi === false, `10 dk < 30 dk → ${molaAz.molaKarsilandi}`);
  iddia("yeterli mola → karşılandı VE kademe üretilmiyor", molaTam.molaKarsilandi === true && molaTam.kademe === null, `35 dk ≥ 30 dk · kademe=${molaTam.kademe}`);

  // ── UYARI METNİ TAHMİNİ SÖYLÜYOR
  const surusKural = KURAL_SETLERI.EU_561.find((k) => k.ad === "surus_molasi");
  const surusDurum = kuralDurumu(surusKural, { calismaMs: null, gece: false, molaDk: null, surusMs: 4.3 * 3600e3, surusBelirsizMs: 40 * 60e3 }, AYAR);
  const metin = uyariMetni(surusDurum, "yaklasti");
  iddia("🔑 SÜRÜŞ TAHMİNİNE DAYANAN UYARI 'tahmini' DİYOR", /tahmini/.test(metin.govde), metin.govde.slice(0, 90));
  const calismaMetin = uyariMetni(d1, "erken");
  iddia("çalışma süresine dayanan uyarıda 'tahmini' YOK", !/tahmini/.test(calismaMetin.govde), calismaMetin.baslik);
  iddia("belirsizlik bandı sayı olarak taşınıyor", surusDurum.belirsizDk === 40, `${surusDurum.belirsizDk} dk`);

  iddia("EU_561 sürüş ekseni, AT/DE çalışma ekseni", setinTemeli("EU_561") === "surus_tahmini" && setinTemeli("AT_AZG") === "calisma_suresi" && setinTemeli("DE_ARBZG") === "calisma_suresi", "3/3");

  // ── ALMANYA FARKI
  const deTavan = KURAL_SETLERI.DE_ARBZG.find((k) => k.ad === "gunluk_tavan");
  const atTavan = KURAL_SETLERI.AT_AZG.find((k) => k.ad === "gunluk_tavan");
  iddia(
    "🔑 ALMANYA GÜNLÜK TAVANI 10 sa, AVUSTURYA 12 sa — aynı vardiya farklı sonuç",
    deTavan.esikMs === 10 * 3600e3 && atTavan.esikMs === 12 * 3600e3,
    `DE ${deTavan.esikMs / 3600e3} sa · AT ${atTavan.esikMs / 3600e3} sa`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · CANLI PANO — GERÇEK VARDİYALARDAN KALAN SÜRE");

  const pano = await mevzuatPanosu();
  iddia("086 okundu, ayar geldi", !pano.ayar.tabloYok && pano.ayar.kuralSeti === "AT_AZG", `${pano.ayar.kuralSeti} · ${pano.ayar.kademe.erken}/${pano.ayar.kademe.yaklasti}/${pano.ayar.kademe.son}`);
  iddia("6 açık vardiya tarandı", pano.satirlar.length === 6, `${pano.satirlar.length} satır · ${pano.vardiyasiz} vardiyasız`);

  const bul = (id) => pano.satirlar.find((s) => s.workerId === id);
  const mola6 = (s) => s.kurallar.find((k) => k.kural === "mola_6sa");

  for (const [ad, id, bek] of [
    ["Erken", ERKEN, "erken"],
    ["Yaklaştı", YAKLASTI, "yaklasti"],
    ["Son", SON, "son"],
    ["İhlal", IHLAL, "ihlal"],
  ]) {
    const k = mola6(bul(id));
    console.log(`  ── ${ad}: ${k.olculenDk}/${k.esikDk} dk · kalan ${k.kalanDk} dk · kademe ${k.kademe}`);
    iddia(`  ${ad} senaryosu '${bek}' kademesinde`, k.kademe === bek, `${k.kademe}`);
  }

  const molaliK = mola6(bul(MOLALI));
  iddia(
    "🔑 MOLASINI VERMİŞ ŞOFÖRE KADEME ÜRETİLMİYOR (gürültü yok)",
    molaliK.molaKarsilandi === true && molaliK.kademe === null,
    `mola 35 dk · eşik aşıldı (${molaliK.kalanDk} dk) ama kademe ${molaliK.kademe}`
  );

  /**
   * 🔴 KAPANMAMIŞ KAYIT — CANLI KOŞUMDA YAKALANDI.
   *
   * HAK61'de 9 açık vardiyanın 7'si 36 saatten uzundu. Bunlara "ihlal" demek
   * 8 şoföre 24 sahte bildirim gönderirdi. 24 saati aşan kayıt artık
   * değerlendirilmiyor ve sebebi kayıtta duruyor.
   */
  const bayatId = "b7000000-0000-0000-0000-0000000000b7";
  await supabaseAdmin.from("workers").upsert({
    id: bayatId, name: "Sofor Kapanmamis", phone: "+430000000117", pin_hash: "x", is_admin: false, is_active: true,
  });
  await supabaseAdmin.from("time_entries").insert({
    worker_id: bayatId,
    vehicle_id: null,
    started_at: new Date(Date.now() - 37 * 3600e3).toISOString(),
    start_km: 1000,
  });
  const bayatPano = await mevzuatPanosu();
  const bayatSatir = bayatPano.satirlar.find((s) => s.workerId === bayatId);
  const bayatKural = bayatSatir.kurallar.find((k) => k.kural === "mola_6sa");
  iddia(
    "🔑 37 SAATTİR AÇIK KAYIT 'ihlal' DEMİYOR — 'kapanmamış kayıt' diyor",
    bayatSatir.vardiyaBayat === true && bayatKural.kademe === null && bayatKural.olculemediSebep === "vardiya_bayat",
    `bayat=${bayatSatir.vardiyaBayat} · kademe=${bayatKural.kademe} · sebep=${bayatKural.olculemediSebep}`
  );
  iddia("  panoda ayrı sayaçla görünüyor", bayatPano.bayatVardiya === 1, `${bayatPano.bayatVardiya} kapanmamış kayıt`);
  const bayatTara = await mevzuatTara(new Date(), true);
  iddia(
    "  kuru taramada ADAY OLMUYOR (bildirim gitmez)",
    !bayatTara.gonderilenler.some((g) => g.workerId === bayatId),
    `${bayatTara.aday} aday`
  );
  iddia("  eşik 24 saat", VARDIYA_BAYAT_MS === 24 * 3600e3, `${VARDIYA_BAYAT_MS / 3600e3} saat`);
  // 14,7 saatlik gerçek vardiya ELENMİYOR — eşiğin doğru yerde olduğunun kanıtı.
  const uzunAma = kuralDurumu(
    KURAL_SETLERI.AT_AZG.find((k) => k.ad === "gunluk_tavan"),
    { calismaMs: 14.7 * 3600e3, gece: false, molaDk: null, surusMs: null, surusBelirsizMs: null, vardiyaBayat: false },
    AYAR
  );
  iddia(
    "  14,7 saatlik GERÇEK vardiya hâlâ değerlendiriliyor (eşik doğru yerde)",
    uzunAma.kademe === "ihlal",
    `882/${uzunAma.esikDk} dk → ${uzunAma.kademe}`
  );
  await supabaseAdmin.from("time_entries").delete().eq("worker_id", bayatId);
  await supabaseAdmin.from("workers").delete().eq("id", bayatId);

  const telemetrisiz = bul(TELEMETRISIZ);
  iddia("araçsız şoför de ÇALIŞMA ekseninde ölçülüyor", mola6(telemetrisiz).olculenDk !== null, `${mola6(telemetrisiz).olculenDk} dk`);
  iddia("en kritik satır başta (ihlal önce)", pano.satirlar[0].workerId === IHLAL, pano.satirlar[0].ad);

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · UYARI GÖNDERİMİ — GERÇEK EXPO UCU");

  const kuru = await mevzuatTara(new Date(), true);
  iddia("kuru koşum aday buluyor ama YAZMIYOR", kuru.aday > 0 && kuru.yazilan === 0, `${kuru.aday} aday · ${kuru.yazilan} yazıldı`);
  const { count: kuruSonra } = await supabaseAdmin.from("mevzuat_uyarilari").select("id", { count: "exact", head: true });
  iddia("  kuru koşumdan sonra defter BOŞ", (kuruSonra ?? 0) === 0, `${kuruSonra} satır`);

  const tur1 = await mevzuatTara();
  console.log(`  ── TUR 1: ${tur1.taranan} tarandı · ${tur1.aday} aday · ${tur1.yazilan} yazıldı · ${tur1.tekrar} tekrar`);
  for (const g of tur1.gonderilenler) {
    console.log(`     ${g.ad} · ${g.kural} · ${g.kademe} · kalan ${g.kalanDk} dk · şoför ${g.soforJeton} · yönetici ${g.yoneticiJeton} cihaz`);
  }
  iddia("uyarılar yazıldı", tur1.yazilan > 0, `${tur1.yazilan} uyarı`);
  iddia("hata yok", tur1.hata === null, String(tur1.hata));

  const sonUyari = tur1.gonderilenler.find((g) => g.workerId === SON);
  iddia(
    "🔑 EŞİĞE YAKLAŞAN ŞOFÖRE UYARI DÜŞTÜ (test hesabı)",
    Boolean(sonUyari) && sonUyari.kademe === "son",
    sonUyari ? `${sonUyari.ad} · ${sonUyari.kademe} · kalan ${sonUyari.kalanDk} dk` : "yok"
  );
  iddia(
    "  şoförün KENDİ cihazına gitti (1 jeton)",
    sonUyari?.soforJeton === 1,
    `şoför ${sonUyari?.soforJeton} · yönetici ${sonUyari?.yoneticiJeton}`
  );
  /**
   * ⚠️ YÖNETİCİ JETONU TUR İÇİNDE TÜKENİR — bu bir kusur değil, ÖLÜ JETON
   * TEMİZLİĞİ. İlk uyarı yöneticinin cihazına gider, Expo "DeviceNotRegistered"
   * der, jeton silinir; aynı turdaki ikinci uyarı artık 0 yönetici cihazı
   * bulur. İddia bu yüzden TEK satıra değil, turun TAMAMINA bakıyor.
   */
  iddia(
    "  yöneticiye de gitti (tur içinde en az bir kez)",
    tur1.gonderilenler.some((g) => g.yoneticiJeton >= 1),
    tur1.gonderilenler.map((g) => `${g.kademe}:${g.yoneticiJeton}`).join(" · ")
  );

  const { data: molaliSatir } = await supabaseAdmin
    .from("mevzuat_uyarilari").select("id").eq("worker_id", MOLALI);
  iddia("🔑 MOLASINI VERMİŞ ŞOFÖRE UYARI GİTMEDİ", (molaliSatir ?? []).length === 0, `${(molaliSatir ?? []).length} satır`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · SPAM YOK — İKİNCİ TUR");

  const tur2 = await mevzuatTara();
  console.log(`  ── TUR 2: ${tur2.aday} aday · ${tur2.yazilan} yazıldı · ${tur2.tekrar} tekrar`);
  iddia(
    "🔑 İKİNCİ TUR HİÇBİR ŞEY GÖNDERMEDİ",
    tur2.yazilan === 0 && tur2.tekrar > 0,
    `${tur2.yazilan} yeni · ${tur2.tekrar} tekil indekse takıldı`
  );
  const { count: toplam } = await supabaseAdmin.from("mevzuat_uyarilari").select("id", { count: "exact", head: true });
  iddia("  defterde satır sayısı ARTMADI", (toplam ?? 0) === tur1.yazilan, `${toplam} satır (tur 1: ${tur1.yazilan})`);

  // Kademe İLERLEYİNCE yeni uyarı gider — susturma değil, KADEME başına tekillik.
  await supabaseAdmin
    .from("time_entries")
    .update({ started_at: new Date(Date.now() - 7 * 3600e3).toISOString() })
    .eq("worker_id", ERKEN);
  const tur3 = await mevzuatTara();
  const ilerleyen = tur3.gonderilenler.find((g) => g.workerId === ERKEN);
  iddia(
    "🔑 KADEME İLERLEYİNCE YENİ UYARI GİDİYOR (susturulmuş değil)",
    Boolean(ilerleyen) && ilerleyen.kademe === "ihlal",
    ilerleyen ? `erken → ${ilerleyen.kademe}` : "gitmedi"
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · SÜRÜŞ TAHMİNİ — EU_561 TURU");

  const olc = await mevzuatAyariYaz(
    { kuralSeti: "EU_561", surusTahmini: true, kademe: AYAR },
    YONETICI
  );
  iddia("kural seti EU_561'e çevrildi", olc.ok, olc.ok ? "ok" : olc.hata);

  const { data: vRow } = await supabaseAdmin
    .from("time_entries").select("vehicle_id, started_at").eq("worker_id", SON).single();
  const surus = await surusTahminiOlc(vRow.vehicle_id, vRow.started_at, new Date().toISOString());
  console.log(`  ── sürüş tahmini: ${(surus.surusMs / 3600e3).toFixed(2)} sa · belirsiz ${(surus.belirsizMs / 60e3).toFixed(0)} dk · ${surus.nokta} nokta`);
  iddia("hareketten sürüş süresi tahmin edildi", surus.surusMs > 0 && surus.nokta > 0, `${(surus.surusMs / 3600e3).toFixed(2)} sa`);

  const surusYok = await surusTahminiOlc(null, vRow.started_at, new Date().toISOString());
  iddia(
    "🔑 ARAÇ YOKSA SÜRÜŞ null — SIFIR DEĞİL",
    surusYok.surusMs === null,
    `surusMs=${surusYok.surusMs}`
  );

  const euPano = await mevzuatPanosu();
  const euSatir = euPano.satirlar.find((s) => s.workerId === TELEMETRISIZ);
  const euKural = euSatir.kurallar.find((k) => k.kural === "surus_molasi");
  iddia(
    "🔑 TELEMETRİSİ OLMAYAN ŞOFÖR 'ölçülemedi' DİYOR, 0 DEMİYOR",
    euKural.olculenDk === null && euKural.olculemediSebep === "telemetri_yok",
    `olculen=${euKural.olculenDk} · sebep=${euKural.olculemediSebep}`
  );
  const euVarsayilan = euPano.satirlar.find((s) => s.workerId === SON);
  iddia(
    "  telemetrisi olan şoförde sürüş ÖLÇÜLDÜ ve TAHMİN etiketi taşıyor",
    euVarsayilan.kurallar.every((k) => k.temel === "surus_tahmini"),
    `${euVarsayilan.kurallar.length} kural, hepsi sürüş ekseninde`
  );

  // Sürüş tahmini KAPATILINCA eksen sessizce 0 göstermez.
  await mevzuatAyariYaz({ kuralSeti: "EU_561", surusTahmini: false, kademe: AYAR }, YONETICI);
  const kapali = await mevzuatPanosu();
  iddia(
    "🔑 SÜRÜŞ TAHMİNİ KAPALIYKEN EKRAN 'kapalı' DİYOR, 0 GÖSTERMİYOR",
    kapali.surusEkseniKapali === true &&
      kapali.satirlar.every((s) => s.kurallar.every((k) => k.olculenDk === null)),
    `surusEkseniKapali=${kapali.surusEkseniKapali}`
  );

  await mevzuatAyariYaz({ kuralSeti: "AT_AZG", surusTahmini: false, kademe: AYAR }, YONETICI);

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · AYAR KAPISI");

  const kotu = await mevzuatAyariYaz({ kuralSeti: "AT_AZG", surusTahmini: false, kademe: { erken: 10, yaklasti: 30, son: 15 } }, YONETICI);
  iddia("kademeler daralmıyorsa REDDEDİLİYOR", !kotu.ok && kotu.hata === "kademe_sirasi", kotu.ok ? "kabul etti!" : kotu.hata);

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · GEÇMİŞ — GÖNDERİM AKIBETİ KAYITTA");

  const { satirlar: gecmis } = await uyariGecmisi(7);
  iddia("gönderilen uyarılar defterde", gecmis.length > 0, `${gecmis.length} kayıt`);
  const jetonlu = gecmis.find((g) => g.workerId === SON);
  iddia(
    "her kayıt kalan süreyi ve eşiği TAŞIYOR (açıklanabilirlik)",
    jetonlu && jetonlu.esikDk > 0 && jetonlu.olculenDk !== null,
    jetonlu ? `${jetonlu.olculenDk}/${jetonlu.esikDk} dk · kalan ${jetonlu.kalanDk}` : "yok"
  );
  iddia(
    "🔑 GÖNDERİM AKIBETİ SAYIYLA KAYITLI (jeton 0 ise 'gitti' denmiyor)",
    jetonlu && jetonlu.soforJeton !== null,
    jetonlu ? `şoför ${jetonlu.soforJeton} · yönetici ${jetonlu.yoneticiJeton} cihaz` : "yok"
  );

  const { data: oluJeton } = await supabaseAdmin.from("push_tokens").select("token");
  iddia(
    "🔑 ÖLÜ JETON TEMİZLENDİ (Expo 'DeviceNotRegistered' dedi)",
    (oluJeton ?? []).length === 0,
    `${(oluJeton ?? []).length} jeton kaldı`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · MEVCUT AZG RAPORU BOZULMADI");

  const { buildAZGReport } = await import("@/lib/azg-report");
  const ay = new Date().toISOString().slice(0, 7);
  const rapor = await buildAZGReport(ay);
  /**
   * ⚠️ BU BÖLÜM BOŞ GEÇMEMELİ. İlk koşumda tohumda hiç KAPANMIŞ vardiya
   * yoktu ve rapor "0 şoför · 0 gün" ile geçti — hiçbir şey kanıtlamadan.
   * Raporun gerçekten sayı ürettiği ÖNCE sınanıyor.
   */
  iddia("AZG raporu koşuyor", rapor.ok === true, rapor.ok ? "ok" : rapor.error);
  const d = rapor.ok ? rapor.data : null;
  console.log(
    `  ── ${ay}: ${d?.totalShifts} vardiya · ${d?.totalWorkers} şoför · ${d?.totalViolations} ihlal ` +
      `(uyarı ${d?.warningCount} · ihlal ${d?.violationCount} · ağır ${d?.seriousCount})`
  );
  iddia(
    "🔑 AZG raporu GERÇEK sayı üretiyor (boş iddia değil)",
    (d?.totalShifts ?? 0) > 0 && (d?.totalWorkers ?? 0) > 0 && (d?.totalViolations ?? 0) > 0,
    `${d?.totalShifts} vardiya · ${d?.totalViolations} ihlal`
  );

  /**
   * MEVZUAT KATMANI RAPORU DEĞİŞTİRMİYOR — ÖLÇEREK.
   *
   * Uyarı defteri DOLU (yukarıdaki turlar yazdı). Rapor aynı ay için ikinci
   * kez koşturuluyor ve AYNI sayıları vermeli: iki katman aynı vardiyalara
   * bakıyor ama biri diğerine hiç dokunmuyor.
   */
  const { count: uyariSayisi } = await supabaseAdmin
    .from("mevzuat_uyarilari")
    .select("id", { count: "exact", head: true });
  const rapor2 = await buildAZGReport(ay);
  const d2 = rapor2.ok ? rapor2.data : null;
  iddia(
    "🔑 UYARI DEFTERİ DOLUYKEN DE AZG RAPORU AYNI SAYIYI ÜRETİYOR",
    d2?.totalShifts === d?.totalShifts &&
      d2?.totalViolations === d?.totalViolations &&
      d2?.seriousCount === d?.seriousCount,
    `${uyariSayisi} uyarı kayıtlı · ${d?.totalShifts}/${d?.totalViolations} → ${d2?.totalShifts}/${d2?.totalViolations}`
  );
  iddia(
    "🔑 AZG raporu mevzuat tablolarını HİÇ OKUMUYOR",
    !/mevzuat_uyarilari|tenant_mevzuat/.test(
      (await import("node:fs")).readFileSync("lib/azg-report.ts", "utf8")
    ),
    "kaynakta geçmiyor"
  );

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
