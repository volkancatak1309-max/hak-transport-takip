#!/usr/bin/env node
/**
 * ÇOK DURAKLI SEFER — KANIT (migration 082).
 *
 * ⚠️ ÜRETİME DEĞİL, YEREL YIĞINA KOŞAR. Sefer/durak/kanıt YAZAR; üretim
 * veritabanında sahte tur üretmek istemediğimiz için harness ayrı:
 * Docker'da Postgres + PostgREST + supabase-js önekini soyan küçük bir proxy.
 * Kurulum adımları docs/COK-DURAKLI-SEFER.md §Prova.
 *
 * ── NE SINANIYOR ──────────────────────────────────────────────────────────
 * GERÇEK sunucu eylemleri (`app/actions/duraklar.ts`) GERÇEK kapılarından
 * (`requireFleetView` / `requireWorker`) geçirilerek çağrılıyor. Kimlik,
 * `SESSION_PASSWORD` ile mühürlenmiş GERÇEK bir iron-session çerezidir
 * (`QA_SESSION_COOKIE`); kapılar atlanmıyor, yalnız tarayıcının taşıdığı çerez
 * yerine konuyor. Yani ölçülen şey panelin ve şoför panelinin çalıştırdığı
 * yolun ta kendisi.
 *
 * Kullanım:
 *   ENV_FILE=<qa env> node --import ./scripts/ts-server.mjs scripts/verify-sefer-duraklari.mjs
 */
import { sealData } from "iron-session";
import { sessionOptions } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getSeferDuraklari,
  durakEkle,
  durakGuncelle,
  durakSil,
  duraklariSirala,
  durakDurumSifirla,
  getSoforDuraklari,
  durakIlerlet,
} from "@/app/actions/duraklar";
import { getSeferGunu, getSoforSeferleri, takipLinkiUret } from "@/app/actions/seferler";
import { teslimatKanitiBirak } from "@/app/actions/teslimat";
import { seferVarisKoprusu } from "@/lib/sefer-bridge";
import { issueTokens } from "@/lib/mobile-auth";
import {
  GET as DURAK_GET,
  POST as DURAK_POST,
  PUT as DURAK_PUT,
} from "@/app/api/mobile/sefer/[id]/duraklar/route";
import {
  PATCH as DURAK_PATCH,
  DELETE as DURAK_DELETE,
} from "@/app/api/mobile/sefer/[id]/duraklar/[durakId]/route";
import { POST as DURAK_DURUM } from "@/app/api/mobile/sefer/[id]/duraklar/[durakId]/durum/route";
import { listDuraklar, seferHedefi } from "@/lib/sefer-duraklari";
import { listTeslimatBySefer } from "@/lib/teslimat-db";

const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const SOFOR = "b0000000-0000-0000-0000-00000000000b";
const ARAC = "c0000000-0000-0000-0000-00000000000c";
const BOLGE_1 = "d1000000-0000-0000-0000-0000000000d1"; // Metzgerei Huber
const BOLGE_2 = "d2000000-0000-0000-0000-0000000000d2"; // Baecker Fuchs
const SEFER_ESKI = "e1000000-0000-0000-0000-0000000000e1"; // tek hedefli, duraksız
const SEFER_YENI = "e2000000-0000-0000-0000-0000000000e2"; // çok duraklı

/** Serbest hedefli durağın koordinatı (2. durak). */
const SERBEST = { lat: 47.4501, lng: 9.7301, yaricap: 150 };

let dusen = 0;
function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit ? "  —  " + kanit : ""}`);
  if (!kosul) dusen++;
}
function baslik(s) {
  console.log(`\n═══ ${s} ═══`);
}

/** Kimliği DEĞİŞTİR — gerçek mühür, gerçek kapı. */
async function kimlik(workerId, ad, isAdmin) {
  process.env.QA_SESSION_COOKIE = await sealData(
    { worker_id: workerId, name: ad, phone: "+430000000000", is_admin: isAdmin },
    { password: sessionOptions.password, ttl: 0 }
  );
}

const sirala = (d) => d.map((x) => `${x.sira}:${x.ad}`).join(" | ");

/**
 * ZAMAN KARŞILAŞTIRMASI — METİN DEĞİL, AN.
 *
 * JS `toISOString()` "…Z", PostgREST "…+00:00" yazıyor. Aynı an, farklı metin;
 * metin karşılaştırması doğru bir damgayı YANLIŞ diye raporluyordu (ilk turda
 * tam bu oldu). Karşılaştırma epoch üzerinden.
 */
const ayniAn = (a, b) =>
  a != null && b != null && Date.parse(String(a)) === Date.parse(String(b));

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · PANELDEN 3 DURAKLI SEFER");
  await kimlik(YONETICI, "QA Yonetici", true);

  const e1 = await durakEkle(SEFER_YENI, { ad: "Metzgerei Huber", zoneId: BOLGE_1 });
  const e2 = await durakEkle(SEFER_YENI, {
    ad: "Serbest adres durağı",
    adres: "Marktstrasse 12, 6850 Dornbirn",
    latitude: SERBEST.lat,
    longitude: SERBEST.lng,
    yaricapM: SERBEST.yaricap,
    pencereBas: "08:00",
    pencereBit: "12:00",
    tahminiSureDk: 15,
  });
  const e3 = await durakEkle(SEFER_YENI, { ad: "Baecker Fuchs", zoneId: BOLGE_2 });
  iddia("üç durak eklendi", e1.ok && e2.ok && e3.ok, `${e1.ok}/${e2.ok}/${e3.ok}`);

  let l = await getSeferDuraklari(SEFER_YENI);
  iddia("sıra 1-2-3, boşluksuz", sirala(l.duraklar) === "1:Metzgerei Huber | 2:Serbest adres durağı | 3:Baecker Fuchs", sirala(l.duraklar));
  iddia("ilerleme 0/3", l.ozet.toplam === 3 && l.ozet.biten === 0, `${l.ozet.biten}/${l.ozet.toplam}`);
  iddia(
    "zaman penceresi ve süre yazıldı",
    l.duraklar[1].pencere_bas?.startsWith("08:00") && l.duraklar[1].tahmini_sure_dk === 15,
    `${l.duraklar[1].pencere_bas}–${l.duraklar[1].pencere_bit} · ${l.duraklar[1].tahmini_sure_dk} dk`
  );
  iddia(
    "bölgeli durakta serbest alanlar TEMİZ (iki biçim birden olamaz)",
    l.duraklar[0].adres === null && l.duraklar[0].latitude === null,
    `adres=${l.duraklar[0].adres} lat=${l.duraklar[0].latitude}`
  );

  // ── SIRALAMA (ertelenmiş tekillik: takas TEK istekte)
  const ters = [l.duraklar[2].id, l.duraklar[1].id, l.duraklar[0].id];
  const s1 = await duraklariSirala(SEFER_YENI, ters);
  l = await getSeferDuraklari(SEFER_YENI);
  iddia("yeniden sıralandı (3↔1 takası)", s1.ok && sirala(l.duraklar) === "1:Baecker Fuchs | 2:Serbest adres durağı | 3:Metzgerei Huber", sirala(l.duraklar));

  const s2 = await duraklariSirala(SEFER_YENI, [l.duraklar[0].id]);
  iddia("eksik sıra listesi REDDEDİLDİ", !s2.ok && s2.hata === "eksik_id", s2.ok ? "kabul edildi" : s2.hata);

  // Eski düzene dön.
  await duraklariSirala(SEFER_YENI, [l.duraklar[2].id, l.duraklar[1].id, l.duraklar[0].id]);

  // ── SİLME + BOŞLUKSUZ NUMARALAMA
  l = await getSeferDuraklari(SEFER_YENI);
  const silinen = l.duraklar[1];
  const sil = await durakSil(silinen.id);
  l = await getSeferDuraklari(SEFER_YENI);
  iddia("ortadaki durak silindi, sıra 1-2 olarak yeniden yazıldı", sil.ok && sirala(l.duraklar) === "1:Metzgerei Huber | 2:Baecker Fuchs", sirala(l.duraklar));

  // Geri ekle — 3 duraklı hâle dön (serbest hedefli olan).
  await durakEkle(SEFER_YENI, {
    ad: "Serbest adres durağı",
    adres: "Marktstrasse 12, 6850 Dornbirn",
    latitude: SERBEST.lat,
    longitude: SERBEST.lng,
    yaricapM: SERBEST.yaricap,
  });
  l = await getSeferDuraklari(SEFER_YENI);
  await duraklariSirala(SEFER_YENI, [l.duraklar[0].id, l.duraklar[2].id, l.duraklar[1].id]);
  l = await getSeferDuraklari(SEFER_YENI);
  iddia("liste yeniden 1-2-3", sirala(l.duraklar) === "1:Metzgerei Huber | 2:Serbest adres durağı | 3:Baecker Fuchs", sirala(l.duraklar));

  const g = await durakGuncelle(l.duraklar[2].id, { ad: "Baecker Fuchs (arka kapı)", zoneId: BOLGE_2, notlar: "arka kapı" });
  l = await getSeferDuraklari(SEFER_YENI);
  iddia("durak düzenlenebiliyor", g.ok && l.duraklar[2].ad === "Baecker Fuchs (arka kapı)", l.duraklar[2].ad);

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · ŞOFÖR SIRALI LİSTEYİ GÖRÜYOR, SIRADAKİ ÖNE ÇIKIYOR");
  await kimlik(SOFOR, "QA Sofor", false);

  let sl = await getSoforDuraklari(SEFER_YENI);
  iddia("şoför kendi seferinin duraklarını görüyor", sl.duraklar.length === 3, `${sl.duraklar.length} durak`);
  iddia("sıra korunuyor", sirala(sl.duraklar) === sirala(l.duraklar), sirala(sl.duraklar));
  iddia("sıradaki durak = 1. durak", sl.ozet.sonraki?.sira === 1, `sira ${sl.ozet.sonraki?.sira} · ${sl.ozet.sonraki?.ad}`);

  // ── BAŞKASININ SEFERİ: şoför yöneticinin seferini GÖRMEMELİ
  const baskasi = await getSoforDuraklari(SEFER_ESKI);
  iddia("başkasının seferinin durakları GÖRÜNMÜYOR", baskasi.duraklar.length === 0, `${baskasi.duraklar.length} satır`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · DURAK DURUMU İLERLİYOR, SAYAÇ DOĞRU");

  const d1 = sl.duraklar[0], d3 = sl.duraklar[2];

  const i1 = await durakIlerlet(d1.id, "varildi");
  const i2 = await durakIlerlet(d1.id, "tamamlandi");
  sl = await getSoforDuraklari(SEFER_YENI);
  iddia("1. durak: bekliyor → varildi → tamamlandi", i1.ok && i2.ok && sl.duraklar[0].durum === "tamamlandi", sl.duraklar[0].durum);
  iddia("ilerleme 1/3", sl.ozet.biten === 1 && sl.ozet.toplam === 3, `${sl.ozet.biten}/${sl.ozet.toplam}`);
  iddia("sıradaki artık 2. durak", sl.ozet.sonraki?.sira === 2, `sira ${sl.ozet.sonraki?.sira}`);

  const geri = await durakIlerlet(d1.id, "varildi");
  iddia("kapanmış durak GERİ ALINAMAZ", !geri.ok && geri.hata === "kapali_durak", geri.ok ? "kabul edildi" : geri.hata);

  const sebepsiz = await durakIlerlet(d3.id, "atlandi", "");
  iddia("sebepsiz atlama REDDEDİLDİ", !sebepsiz.ok && sebepsiz.hata === "sebep_gerekli", sebepsiz.ok ? "kabul edildi" : sebepsiz.hata);

  const atla = await durakIlerlet(d3.id, "atlandi", "dükkân kapalıydı");
  sl = await getSoforDuraklari(SEFER_YENI);
  iddia("3. durak sebebiyle atlandı", atla.ok && sl.duraklar[2].durum === "atlandi" && sl.duraklar[2].atlama_sebep === "dükkân kapalıydı", sl.duraklar[2].atlama_sebep ?? "—");
  iddia("ilerleme 2/3 (atlanan da BİTMİŞ sayılır)", sl.ozet.biten === 2 && sl.ozet.atlanan === 1, `biten ${sl.ozet.biten} · atlanan ${sl.ozet.atlanan}`);
  iddia("sıradaki 2. durak (atlanan sıraya girmiyor)", sl.ozet.sonraki?.sira === 2, `sira ${sl.ozet.sonraki?.sira}`);

  // ── YÖNETİCİ DÜZELTMESİ
  await kimlik(YONETICI, "QA Yonetici", true);
  const sifir = await durakDurumSifirla(d1.id);
  l = await getSeferDuraklari(SEFER_YENI);
  iddia(
    "yönetici yanlış basılan durumu SIFIRLADI (damgalar temizlendi)",
    sifir.ok && l.duraklar[0].durum === "bekliyor" && l.duraklar[0].varildi_at === null && l.duraklar[0].tamamlandi_at === null,
    `${l.duraklar[0].durum} · varildi_at=${l.duraklar[0].varildi_at}`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · OTOMATİK VARIŞ — DURAK EKSENİNDE");

  /**
   * ⚠️ GÖZLEM ANI DURAKLARIN DOĞUMUNDAN SONRA OLMALI — köprünün (b) kuralı:
   * "durak yokken olmuş bir geçiş o durağın varışı değildir". Duraklar bu
   * betikte AZ ÖNCE açıldığı için gözlem anları da "şimdi" seçiliyor. Geçmişe
   * bir zaman vermek kuralın kendisini sınardı, özelliği değil.
   */
  const ziyaretAn = new Date().toISOString();
  const noktaAn = new Date(Date.now() + 1_000).toISOString();

  // (a) BÖLGELİ DURAK → zone_visits. Ziyaret motorunun yazdığı satırın aynısı.
  const { error: ziyaretHatasi } = await supabaseAdmin.from("zone_visits").insert({
    vehicle_id: ARAC,
    zone_id: BOLGE_1,
    worker_id: null, // ⚠️ BİLEREK boş: köprü kimliği VARDİYADAN sorar, bu alandan değil.
    started_at: ziyaretAn,
    last_seen_at: ziyaretAn,
  });
  // ⚠️ YAZMA SONUCU DENETLENİYOR: ilk turda bu satır SESSİZCE yazılmamıştı
  // (harness'ta service_role'ün BYPASSRLS'i yoktu, `zone_visits` RLS açık) ve
  // köprü "hiçbir şey damgalamadı" diye suçlanıyordu. Sessiz kurulum hatası
  // ürün hatası gibi görünmesin.
  iddia("ziyaret satırı GERÇEKTEN yazıldı", !ziyaretHatasi, ziyaretHatasi?.message ?? "ok");
  // Eski (duraksız) seferin hedefi de aynı bölge — o da damgalanmalı.

  // (b) KOORDİNATLI DURAK → turun bellekteki noktaları.
  const noktalar = new Map([
    [
      ARAC,
      [
        { latitude: 47.9, longitude: 9.9, recorded_at: ziyaretAn }, // uzak — daire DIŞINDA
        { latitude: SERBEST.lat, longitude: SERBEST.lng, recorded_at: noktaAn }, // TAM ÜSTÜNDE
      ],
    ],
  ]);

  const kopru = await seferVarisKoprusu(new Date(), noktalar);
  iddia("köprü hatasız koştu", kopru.hata === null, JSON.stringify(kopru));

  const { duraklar: sonra } = await listDuraklar(SEFER_YENI);
  const bolgeliDurak = sonra.find((x) => x.zone_id === BOLGE_1);
  const serbestDurak = sonra.find((x) => x.latitude !== null);
  iddia(
    "BÖLGELİ durak otomatik damgalandı (zone_visits)",
    bolgeliDurak?.durum === "varildi" && bolgeliDurak?.varis_kaynak === "otomatik",
    `${bolgeliDurak?.durum} · ${bolgeliDurak?.varis_kaynak} · ${bolgeliDurak?.varildi_at}`
  );
  iddia(
    "KOORDİNATLI durak otomatik damgalandı (tur noktaları)",
    serbestDurak?.durum === "varildi" && serbestDurak?.varis_kaynak === "otomatik",
    `${serbestDurak?.durum} · ${serbestDurak?.varis_kaynak} · ${serbestDurak?.varildi_at}`
  );
  iddia(
    "damga ANI gözlemin KENDİ anı (yazma anı DEĞİL)",
    ayniAn(bolgeliDurak?.varildi_at, ziyaretAn) && ayniAn(serbestDurak?.varildi_at, noktaAn),
    `${bolgeliDurak?.varildi_at} | ${serbestDurak?.varildi_at}`
  );

  const { data: seferSatiri } = await supabaseAdmin
    .from("seferler").select("vardi_at").eq("id", SEFER_YENI).maybeSingle();
  iddia(
    "seferin vardi_at'i EN ERKEN varışa düştü",
    ayniAn(seferSatiri?.vardi_at, ziyaretAn),
    `${seferSatiri?.vardi_at} (en erken gözlem ${ziyaretAn})`
  );

  // İKİNCİ TUR — damga bir kez düşer.
  const kopru2 = await seferVarisKoprusu(new Date(), noktalar);
  iddia("ikinci turda YENİ damga yok (idempotent)", kopru2.durakYazilan === 0, `durakYazilan=${kopru2.durakYazilan}`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · TESLİMAT KANITI DOĞRU DURAĞA BAĞLANIYOR");
  await kimlik(SOFOR, "QA Sofor", false);

  const hedefDurak = sonra.find((x) => x.sira === 2);
  const fd = new FormData();
  fd.set("seferId", SEFER_YENI);
  fd.set("durakId", hedefDurak.id);
  fd.set("aliciAd", "Frau Fuchs");
  fd.set("notlar", "kapıya bırakıldı");
  fd.set("fotoSayisi", "0");
  const kanit = await teslimatKanitiBirak(fd);
  iddia("kanıt kaydedildi", kanit.ok, kanit.ok ? kanit.id : kanit.hata);

  const { teslimatlar } = await listTeslimatBySefer(SEFER_YENI);
  iddia(
    "kanıt DOĞRU durağa bağlı (durak_id) ve durak_no o anki sıra",
    teslimatlar.length === 1 && teslimatlar[0].durakId === hedefDurak.id && teslimatlar[0].durakNo === 2,
    `durakId=${teslimatlar[0]?.durakId?.slice(0, 8)} durakNo=${teslimatlar[0]?.durakNo}`
  );

  // Aynı durağa ikinci GEÇERLİ kanıt olamaz.
  const fd2 = new FormData();
  fd2.set("seferId", SEFER_YENI);
  fd2.set("durakId", hedefDurak.id);
  fd2.set("notlar", "ikinci deneme");
  fd2.set("fotoSayisi", "0");
  const kanit2 = await teslimatKanitiBirak(fd2);
  iddia("aynı durağa ikinci GEÇERLİ kanıt REDDEDİLDİ", !kanit2.ok && kanit2.hata === "durak_dolu", kanit2.ok ? "kabul edildi" : kanit2.hata);

  // Duraksız çağrı: durakları olan seferde kanıt sahipsiz kalamaz.
  const fd3 = new FormData();
  fd3.set("seferId", SEFER_YENI);
  fd3.set("notlar", "duraksız");
  fd3.set("fotoSayisi", "0");
  const kanit3 = await teslimatKanitiBirak(fd3);
  iddia("durak seçilmeden kanıt REDDEDİLDİ", !kanit3.ok && kanit3.hata === "durak_secilmedi", kanit3.ok ? "kabul edildi" : kanit3.hata);

  // Başka seferin durağına bağlamak.
  const fd4 = new FormData();
  fd4.set("seferId", SEFER_YENI);
  fd4.set("durakId", "00000000-0000-0000-0000-000000000000");
  fd4.set("notlar", "yabancı durak");
  fd4.set("fotoSayisi", "0");
  const kanit4 = await teslimatKanitiBirak(fd4);
  iddia("yabancı durak REDDEDİLDİ", !kanit4.ok && kanit4.hata === "durak_yok", kanit4.ok ? "kabul edildi" : kanit4.hata);

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · ESKİ TEK HEDEFLİ SEFER BOZULMADI");
  await kimlik(YONETICI, "QA Yonetici", true);

  const { data: eski } = await supabaseAdmin
    .from("seferler").select("zone_id, vardi_at").eq("id", SEFER_ESKI).maybeSingle();
  iddia("eski seferin zone_id'si YERİNDE", eski?.zone_id === BOLGE_1, String(eski?.zone_id).slice(0, 8));
  iddia(
    "eski sefer ESKİ YOLDAN damgalandı (durak yok, zone_visits var)",
    ayniAn(eski?.vardi_at, ziyaretAn),
    `${eski?.vardi_at}`
  );

  const { duraklar: eskiDurak } = await listDuraklar(SEFER_ESKI);
  iddia("eski sefere durak UYDURULMADI", eskiDurak.length === 0, `${eskiDurak.length} durak`);

  const hedefEski = await seferHedefi({ id: SEFER_ESKI, zone_id: BOLGE_1 });
  iddia("hedef çözümü eski seferde zone_id'ye düşüyor", hedefEski?.kaynak === "bolge" && hedefEski?.ad === "Metzgerei Huber", `${hedefEski?.ad} (${hedefEski?.kaynak})`);

  const hedefYeni = await seferHedefi({ id: SEFER_YENI, zone_id: null });
  iddia("hedef çözümü yeni seferde SIRADAKİ durağa gidiyor", hedefYeni?.durakId !== null, `${hedefYeni?.ad} (${hedefYeni?.kaynak})`);

  const gun = await getSeferGunu(new Date().toISOString().slice(0, 10));
  const satirEski = gun.seferler.find((x) => x.id === SEFER_ESKI);
  const satirYeni = gun.seferler.find((x) => x.id === SEFER_YENI);
  iddia("panel: eski sefer hedef adını gösteriyor", satirEski?.bolge_ad === "Metzgerei Huber", satirEski?.bolge_ad ?? "—");
  iddia("panel: eski seferde durak sayacı 0 (kapalı değil, YOK)", satirEski?.ilerleme.toplam === 0, `${satirEski?.ilerleme.biten}/${satirEski?.ilerleme.toplam}`);
  iddia("panel: eski sefer takip linkine UYGUN (araç + zone_id)", satirEski?.takip_uygun === true, String(satirEski?.takip_uygun));
  iddia("panel: yeni seferde sayaç 3 durak", satirYeni?.ilerleme.toplam === 3, `${satirYeni?.ilerleme.biten}/${satirYeni?.ilerleme.toplam}`);
  iddia("panel: yeni seferin hedefi SIRADAKİ durak", satirYeni?.bolge_ad === hedefYeni?.ad, `${satirYeni?.bolge_ad}`);
  iddia("panel: yeni sefer takip linkine UYGUN (araç + durak hedefi)", satirYeni?.takip_uygun === true, String(satirYeni?.takip_uygun));

  const linkEski = await takipLinkiUret(SEFER_ESKI, null);
  const linkYeni = await takipLinkiUret(SEFER_YENI, null);
  iddia("takip linki İKİ seferde de üretilebildi", linkEski.ok && linkYeni.ok, `${linkEski.ok ? "eski✓" : "eski✗:" + linkEski.hata} ${linkYeni.ok ? "yeni✓" : "yeni✗:" + linkYeni.hata}`);

  // ── ŞOFÖR TAKVİMİ: sayaç orada da doğru
  await kimlik(SOFOR, "QA Sofor", false);
  const takvim = await getSoforSeferleri(new Date().toISOString().slice(0, 7));
  const soforSatiri = takvim.seferler.find((x) => x.id === SEFER_YENI);
  iddia("şoför takvimi durak sayacını taşıyor", soforSatiri?.ilerleme.toplam === 3, `${soforSatiri?.ilerleme.biten}/${soforSatiri?.ilerleme.toplam}`);
  iddia("şoför takviminde hedef adı SIRADAKİ durak", Boolean(soforSatiri?.bolge_ad), soforSatiri?.bolge_ad ?? "—");

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · KAPSAM VE KAPILAR");

  // Şoför durak EKLEYEMEZ: `durakEkle` requireFleetView'dan geçer ve şoför
  // ne patron ne şef olduğu için o kapı /panel'e YÖNLENDİRİR (redirect bir
  // istisna fırlatır). Yakalayıp kapının çalıştığını ölçüyoruz.
  let redirectAtti = false;
  try {
    await durakEkle(SEFER_YENI, { ad: "izinsiz" });
  } catch (e) {
    redirectAtti = String(e?.digest ?? e?.message ?? e).includes("NEXT_REDIRECT");
  }
  iddia("şoför durak EKLEYEMİYOR (yönetim kapısı)", redirectAtti, redirectAtti ? "redirect" : "geçti!");

  const { duraklar: sonDurum } = await listDuraklar(SEFER_YENI);
  iddia("izinsiz denemeden sonra durak sayısı DEĞİŞMEDİ", sonDurum.length === 3, `${sonDurum.length}`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · MOBIL UÇLAR (HTTP sözleşmesi)");

  const yoneticiJeton = (await issueTokens(YONETICI, true, 0)).accessToken;
  const soforJeton = (await issueTokens(SOFOR, false, 0)).accessToken;

  const cagir = async (fn, yol, opsiyon, params) => {
    const res = await fn(
      new Request(`http://x${yol}`, {
        method: opsiyon.method ?? "GET",
        headers: {
          authorization: `Bearer ${opsiyon.jeton}`,
          ...(opsiyon.body ? { "content-type": "application/json" } : {}),
        },
        ...(opsiyon.body ? { body: JSON.stringify(opsiyon.body) } : {}),
      }),
      { params: Promise.resolve(params) }
    );
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const mGet = await cagir(DURAK_GET, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: soforJeton }, { id: SEFER_YENI });
  iddia("GET /duraklar — şoför kendi seferini okuyor", mGet.status === 200 && mGet.json?.duraklar?.length === 3, `${mGet.status} · ${mGet.json?.duraklar?.length} durak`);
  iddia("GET yanıtı ilerleme özetini taşıyor", mGet.json?.ozet?.toplam === 3, JSON.stringify(mGet.json?.ozet ?? {}).slice(0, 80));
  iddia(
    "durak gövdesi otomatik varış YETENEĞİNİ söylüyor",
    mGet.json?.duraklar?.every((d) => typeof d.otomatikVarisVar === "boolean"),
    mGet.json?.duraklar?.map((d) => `${d.sira}:${d.otomatikVarisVar}`).join(" ")
  );

  const mYabanci = await cagir(DURAK_GET, `/api/mobile/sefer/${SEFER_ESKI}/duraklar`, { jeton: soforJeton }, { id: SEFER_ESKI });
  iddia("GET — başkasının seferi 403", mYabanci.status === 403, `${mYabanci.status} ${mYabanci.json?.error ?? ""}`);

  const mSoforEkle = await cagir(DURAK_POST, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: soforJeton, method: "POST", body: { ad: "izinsiz" } }, { id: SEFER_YENI });
  iddia("POST — şoför durak EKLEYEMİYOR", mSoforEkle.status === 403, `${mSoforEkle.status} ${mSoforEkle.json?.error ?? ""}`);

  const mEkle = await cagir(DURAK_POST, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton, method: "POST", body: { ad: "Mobil durak", bolgeId: BOLGE_2 } }, { id: SEFER_YENI });
  iddia("POST — yönetici durak ekledi (sıra 4)", mEkle.status === 201 && mEkle.json?.durak?.sira === 4, `${mEkle.status} · sira ${mEkle.json?.durak?.sira}`);
  const mobilDurakId = mEkle.json?.durak?.id;

  const mKotu = await cagir(DURAK_POST, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton, method: "POST", body: { ad: "Kotu pencere", pencereBas: "14:00", pencereBit: "09:00" } }, { id: SEFER_YENI });
  iddia("POST — ters zaman penceresi 400", mKotu.status === 400, `${mKotu.status} ${mKotu.json?.detay?.alan ?? ""}`);

  const mDar = await cagir(DURAK_POST, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton, method: "POST", body: { ad: "Dar yaricap", lat: 47.5, lng: 9.7, yaricapM: 10 } }, { id: SEFER_YENI });
  iddia("POST — 50 m altı yarıçap 400", mDar.status === 400, `${mDar.status} ${mDar.json?.detay?.alan ?? ""}`);

  const guncelListe = (await cagir(DURAK_GET, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton }, { id: SEFER_YENI })).json;
  const tersId = [...guncelListe.duraklar].reverse().map((d) => d.id);
  const mSira = await cagir(DURAK_PUT, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton, method: "PUT", body: { sira: tersId } }, { id: SEFER_YENI });
  iddia(
    "PUT — mobilden yeniden sıralandı (tam ters)",
    mSira.status === 200 && mSira.json?.duraklar?.[0]?.id === tersId[0] && mSira.json?.duraklar?.[0]?.sira === 1,
    `${mSira.status} · ${mSira.json?.duraklar?.map((d) => d.sira).join(",")}`
  );

  const mEksik = await cagir(DURAK_PUT, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton, method: "PUT", body: { sira: [tersId[0]] } }, { id: SEFER_YENI });
  iddia("PUT — eksik liste 400", mEksik.status === 400, `${mEksik.status} ${mEksik.json?.error ?? ""}`);

  const mDurum = await cagir(DURAK_DURUM, `/api/mobile/sefer/${SEFER_YENI}/duraklar/${mobilDurakId}/durum`, { jeton: soforJeton, method: "POST", body: { durum: "varildi" } }, { id: SEFER_YENI, durakId: mobilDurakId });
  iddia("POST /durum — şoför durağı ilerletti", mDurum.status === 200 && mDurum.json?.durak?.durum === "varildi", `${mDurum.status} · ${mDurum.json?.durak?.durum}`);
  iddia("durum yanıtı ilerleme özetini de taşıyor", typeof mDurum.json?.ozet?.toplam === "number", JSON.stringify(mDurum.json?.ozet ?? {}).slice(0, 70));

  const mAtla = await cagir(DURAK_DURUM, `/api/mobile/sefer/${SEFER_YENI}/duraklar/${mobilDurakId}/durum`, { jeton: soforJeton, method: "POST", body: { durum: "atlandi" } }, { id: SEFER_YENI, durakId: mobilDurakId });
  iddia("POST /durum — sebepsiz atlama 400", mAtla.status === 400 && mAtla.json?.error === "sebep_gerekli", `${mAtla.status} ${mAtla.json?.error}`);

  const { PATCH: SEFER_PATCH } = await import("@/app/api/mobile/sefer/[id]/route");
  const mBolgeYama = await cagir(
    SEFER_PATCH,
    `/api/mobile/sefer/${SEFER_YENI}`,
    { jeton: yoneticiJeton, method: "PATCH", body: { bolgeId: BOLGE_1 } },
    { id: SEFER_YENI }
  );
  iddia(
    "PATCH /sefer — duraklı seferde bolgeId açıkça REDDEDİLİYOR (sessiz kabul yok)",
    mBolgeYama.status === 409 && mBolgeYama.json?.error === "duraklarla_yonetiliyor",
    `${mBolgeYama.status} ${mBolgeYama.json?.error}`
  );

  // ── PATCH: düzenleme · durum sıfırlama · durum sızıntısı
  const mDuzenle = await cagir(DURAK_PATCH, `/api/mobile/sefer/${SEFER_YENI}/duraklar/${mobilDurakId}`, { jeton: yoneticiJeton, method: "PATCH", body: { ad: "Mobil durak (düzeltildi)" } }, { id: SEFER_YENI, durakId: mobilDurakId });
  iddia("PATCH — durak düzenlendi (kısmi yama, diğer alanlar korundu)", mDuzenle.status === 200 && mDuzenle.json?.durak?.ad === "Mobil durak (düzeltildi)" && mDuzenle.json?.durak?.durum === "varildi", `${mDuzenle.status} · ${mDuzenle.json?.durak?.ad} · ${mDuzenle.json?.durak?.durum}`);

  const mDurumSizinti = await cagir(DURAK_PATCH, `/api/mobile/sefer/${SEFER_YENI}/duraklar/${mobilDurakId}`, { jeton: yoneticiJeton, method: "PATCH", body: { durum: "tamamlandi" } }, { id: SEFER_YENI, durakId: mobilDurakId });
  iddia("PATCH — `durum` bu uçtan DEĞİŞMEZ (çizgi yalnız şoförde)", mDurumSizinti.status === 400 && mDurumSizinti.json?.error === "durum_bu_uctan_degismez", `${mDurumSizinti.status} ${mDurumSizinti.json?.error}`);

  const mSifirla = await cagir(DURAK_PATCH, `/api/mobile/sefer/${SEFER_YENI}/duraklar/${mobilDurakId}`, { jeton: yoneticiJeton, method: "PATCH", body: { durumSifirla: true } }, { id: SEFER_YENI, durakId: mobilDurakId });
  iddia("PATCH — yönetici durumu sıfırladı, damgalar temizlendi", mSifirla.status === 200 && mSifirla.json?.durak?.durum === "bekliyor" && mSifirla.json?.durak?.damgalar?.varildi === null, `${mSifirla.status} · ${mSifirla.json?.durak?.durum} · varildi=${mSifirla.json?.durak?.damgalar?.varildi}`);

  const mSil = await cagir(DURAK_DELETE, `/api/mobile/sefer/${SEFER_YENI}/duraklar/${mobilDurakId}`, { jeton: yoneticiJeton, method: "DELETE" }, { id: SEFER_YENI, durakId: mobilDurakId });
  const sonListe = (await cagir(DURAK_GET, `/api/mobile/sefer/${SEFER_YENI}/duraklar`, { jeton: yoneticiJeton }, { id: SEFER_YENI })).json;
  iddia(
    "DELETE — durak silindi ve sıra BOŞLUKSUZ yeniden yazıldı",
    mSil.status === 200 && sonListe.duraklar.map((d) => d.sira).join(",") === "1,2,3",
    `${mSil.status} · ${sonListe.duraklar.map((d) => d.sira).join(",")}`
  );

  console.log(
    `\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`
  );
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
