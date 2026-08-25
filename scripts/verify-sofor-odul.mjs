#!/usr/bin/env node
/**
 * ŞOFÖR ÖDÜL VE LİDERLİK — KANIT (migration 088).
 *
 * Yığın: Docker Postgres 16 + PostgREST + proxy (docs/SOFOR-ODUL.md §Prova).
 * Gerçek skor motoru, gerçek mobil uç, gerçek kapılar.
 *
 * Kullanım:
 *   set -a; . <qa env>; set +a
 *   npm run verify:sofor-odul
 */
import { supabaseAdmin } from "@/lib/supabase";
import {
  ROZET_SKOR_ESIK,
  SERI_DONEM,
  YON_ESIK,
  kiyaslanabilir,
  rozetleriHesapla,
  seriKazanilabilirMi,
  siralamaKur,
  yonBul,
} from "@/lib/odul";
import {
  donemiHesaplaVeYaz,
  donemOzeti,
  liderlikPanosu,
  odulAyariYaz,
  rozetleriDegerlendir,
  rozetleriOku,
} from "@/lib/odul-db";

const YONETICI = "a0000000-0000-4000-8000-00000000000a";
const ADA = "b1000000-0000-4000-8000-0000000000b1"; // hiç olay yok
const BORA = "b2000000-0000-4000-8000-0000000000b2";
const DENIZ = "b4000000-0000-4000-8000-0000000000b4"; // çok olay
const ELIF = "b5000000-0000-4000-8000-0000000000b5"; // düşüşte
/** Km eşiğini geçemeyen şoför — 5. kanıtın öznesi. */
const FILIZ = "b6000000-0000-4000-8000-0000000000b6";

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);

const D = (bas, skor, epokAt, epokOncesi = false, olay = 0) => ({
  workerId: "w",
  donemBas: bas,
  donemBit: bas,
  skor,
  kapi: skor === null ? "km_yetersiz" : null,
  olaySayisi: olay,
  km: 1000,
  esikKm: 300,
  epokAt,
  epokOncesi,
});

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · SAF KATMAN — sıralama ve skorsuzluk");

  const donemler = [
    { ...D("2026-08-01", 90, "E1"), workerId: "a" },
    { ...D("2026-08-01", 70, "E1"), workerId: "b" },
    { ...D("2026-08-01", null, "E1"), workerId: "c" },
  ];
  const adlar = new Map([["a", "Ada"], ["b", "Bora"], ["c", "Cem"]]);
  const { siralı, skorsuz } = siralamaKur(donemler, adlar, new Map(), "b", false, (n) => `#${n}`);

  iddia("skorlular sıraya girdi", siralı.length === 2 && siralı[0].sira === 1, `${siralı.length} sıralı`);
  iddia(
    "🔑 SKORSUZ ŞOFÖR SIRALANMADI (sira null) ve 0 PUAN ALMADI",
    skorsuz.length === 1 && skorsuz[0].sira === null && skorsuz[0].skor === null,
    `sira=${skorsuz[0].sira} · skor=${skorsuz[0].skor} · kapı=${skorsuz[0].kapi}`
  );
  iddia(
    "🔑 İSİM GİZLİYKEN ŞOFÖR KENDİ ADINI GÖRÜR, DİĞERLERİ TAKMA",
    siralı.find((r) => r.ben)?.ad === "Bora" && siralı.find((r) => !r.ben)?.ad === "#1",
    siralı.map((r) => `${r.ad}${r.ben ? "(ben)" : ""}`).join(" · ")
  );

  const acik = siralamaKur(donemler, adlar, new Map(), "b", true, (n) => `#${n}`);
  iddia(
    "isim AÇIKken gerçek adlar görünüyor",
    acik.siralı.every((r) => r.ad !== `#${r.sira}`),
    acik.siralı.map((r) => r.ad).join(" · ")
  );

  iddia(`yön eşiği ${YON_ESIK}: küçük fark 'sabit'`, yonBul(70, 68) === "sabit", `70 vs 68 → ${yonBul(70, 68)}`);
  iddia("büyük artış 'yukari'", yonBul(80, 70) === "yukari", `80 vs 70 → ${yonBul(80, 70)}`);
  iddia("kıyas yoksa yön null", yonBul(80, null) === null, String(yonBul(80, null)));

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · KALİBRASYON SINIRI");

  iddia(
    "🔑 FARKLI EPOK → KIYASLANAMAZ",
    !kiyaslanabilir(D("2026-08-01", 90, "E2"), D("2026-07-01", 90, "E1")),
    "E2 vs E1 → false"
  );
  iddia(
    "🔑 EPOK ÖNCESİ DÖNEM KIYASLANAMAZ",
    !kiyaslanabilir(D("2026-08-01", 90, "E1"), D("2026-07-01", 90, "E1", true)),
    "epokOncesi=true → false"
  );
  iddia("aynı epok → kıyaslanabilir", kiyaslanabilir(D("2026-08-01", 90, "E1"), D("2026-07-01", 90, "E1")), "true");

  const seriKarisik = rozetleriHesapla(
    [D("2026-08-01", 90, "E1"), D("2026-07-01", 90, "E1", true), D("2026-06-01", 90, "E1", true)],
    []
  );
  iddia(
    "🔑 EPOK ÖNCESİ DÖNEMLERLE SERİ ROZETİ VERİLMEZ",
    !seriKarisik.some((r) => r.rozet === "seri_iyi"),
    seriKarisik.map((r) => r.rozet).join(" · ") || "rozet yok"
  );

  const seriTemiz = rozetleriHesapla(
    [D("2026-08-01", 90, "E1"), D("2026-07-01", 85, "E1"), D("2026-06-01", 88, "E1")],
    []
  );
  iddia(
    "  aynı epokta 3 dönem 80+ → seri rozeti VERİLİR",
    seriTemiz.some((r) => r.rozet === "seri_iyi"),
    seriTemiz.map((r) => r.rozet).join(" · ")
  );

  const kilit = seriKazanilabilirMi(1);
  iddia(
    "🔑 TEMİZ DÖNEM YETMİYORSA 'kazanılamaz' + EKSİK SAYISI",
    !kilit.olur && kilit.eksikDonem === SERI_DONEM - 1,
    `temiz 1 · eksik ${kilit.eksikDonem} · gereken ${SERI_DONEM}`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · DÖNEM SNAPSHOT — GERÇEK SKOR MOTORU");

  // Üç dönem: 0 (bu), 1, 2 — hepsi epok sonrası (epok 75 gün önce).
  const yazmalar = [];
  for (let i = 2; i >= 0; i--) yazmalar.push(await donemiHesaplaVeYaz(new Date(), i));
  for (const y of yazmalar) {
    console.log(`  ── ${y.donemBas}: ${y.yazilan} satır · skorlanan ${y.skorlanan} · skorsuz ${y.skorsuz}${y.epokOncesi ? " ⚠ EPOK ÖNCESİ" : ""}`);
  }
  iddia("üç dönem yazıldı", yazmalar.every((y) => y.yazilan > 0), yazmalar.map((y) => y.yazilan).join(" · "));
  iddia("hiçbiri epok öncesi değil (epok 75 gün önce)", yazmalar.every((y) => !y.epokOncesi), "3/3 temiz");

  const { data: snap } = await supabaseAdmin
    .from("sofor_skor_donem")
    .select("worker_id, donem_bas, skor, kapi, olay_sayisi, km, epok_at, epok_oncesi")
    .order("donem_bas", { ascending: false });
  const son = snap.filter((r) => r.donem_bas === yazmalar.at(-1).donemBas);
  console.log("  ── SON DÖNEM:", son.map((r) => `${r.worker_id.slice(0, 2)}=${r.skor ?? "null"}`).join(" · "));

  const ada = son.find((r) => r.worker_id === ADA);
  const deniz = son.find((r) => r.worker_id === DENIZ);
  iddia("🔑 OLAYSIZ ŞOFÖR EN YÜKSEK SKOR", ada?.skor === 100 && ada?.olay_sayisi === 0, `Ada ${ada?.skor} · ${ada?.olay_sayisi} olay`);
  iddia("çok olaylı şoför düşük skor", (deniz?.skor ?? 100) < (ada?.skor ?? 0), `Deniz ${deniz?.skor} · ${deniz?.olay_sayisi} olay`);
  iddia("her satır kalibrasyon damgası taşıyor", son.every((r) => r.epok_at !== null), `${son.filter((r) => r.epok_at).length}/${son.length}`);

  // İkinci yazma AYNI satırı günceller (upsert), yenisini yazmaz.
  const oncekiSayi = snap.length;
  await donemiHesaplaVeYaz(new Date(), 0);
  const { count: sonrakiSayi } = await supabaseAdmin
    .from("sofor_skor_donem")
    .select("id", { count: "exact", head: true });
  iddia(
    "🔑 İKİNCİ HESAP AYNI SATIRI GÜNCELLER (seri sayımı şişmez)",
    sonrakiSayi === oncekiSayi,
    `${oncekiSayi} → ${sonrakiSayi} satır`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · ROZETLER — GERÇEK VERİDEN");

  const rozetTuru = await rozetleriDegerlendir(new Date());
  console.log(`  ── ROZET TURU: ${rozetTuru.aday} aday · ${rozetTuru.yazilan} yazıldı · ${rozetTuru.tekrar} tekrar · temiz dönem ${rozetTuru.temizDonem}`);
  iddia("rozet yazıldı", rozetTuru.yazilan > 0, `${rozetTuru.yazilan} rozet`);

  const { rozetler } = await rozetleriOku();
  const kodlar = [...new Set(rozetler.map((r) => r.rozet))];
  console.log(`  ── ROZETLER: ${rozetler.map((r) => `${r.workerId.slice(0, 2)}:${r.rozet}`).join(" · ")}`);
  iddia("🔑 SIFIR OLAY rozeti olaysız şoförde", rozetler.some((r) => r.workerId === ADA && r.rozet === "sifir_olay"), kodlar.join(" · "));
  iddia("  ay_iyi rozeti eşiği geçende", rozetler.some((r) => r.rozet === "ay_iyi"), `eşik ${ROZET_SKOR_ESIK}`);
  iddia("  ilk3 rozeti verildi", rozetler.some((r) => r.rozet === "ay_ilk3"), "var");
  const kanitli = rozetler.find((r) => r.rozet === "ay_iyi");
  iddia(
    "🔑 HER ROZET KANIT TAŞIYOR (hangi sayıdan çıktı)",
    Boolean(kanitli?.kanit?.skor) && kanitli?.kanit?.esik === ROZET_SKOR_ESIK,
    JSON.stringify(kanitli?.kanit)
  );

  const tur2 = await rozetleriDegerlendir(new Date());
  iddia(
    "🔑 İKİNCİ TUR AYNI ROZETİ TEKRAR VERMEDİ",
    tur2.yazilan === 0 && tur2.tekrar > 0,
    `${tur2.yazilan} yeni · ${tur2.tekrar} tekil indekse takıldı`
  );

  iddia(
    "🔑 SERİ ROZETİ 3 TEMİZ DÖNEMLE KAZANILABİLİR OLDU",
    rozetTuru.seriKazanilabilir && rozetTuru.temizDonem >= SERI_DONEM,
    `temiz dönem ${rozetTuru.temizDonem}/${SERI_DONEM}`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · LİDERLİK — İSİM GİZLİ / AÇIK");

  const gizli = await liderlikPanosu(BORA, (n) => `#${n}`);
  console.log(`  ── GİZLİ: ${gizli.siralı.map((r) => `${r.sira}.${r.ad}${r.ben ? "(ben)" : ""}`).join(" · ")}`);
  iddia("liderlik tablosu doldu", gizli.siralı.length >= 3, `${gizli.siralı.length} sıralı · ${gizli.skorsuz.length} skorsuz`);
  iddia(
    "🔑 İSİM KAPALIYKEN BAŞKALARI TAKMA ADLA",
    gizli.siralı.filter((r) => !r.ben).every((r) => /^#\d+$/.test(r.ad)),
    gizli.siralı.map((r) => r.ad).join(" · ")
  );
  iddia(
    "  şoför KENDİ adını görüyor",
    gizli.ben?.ad === "Bora Kaya",
    `${gizli.ben?.ad} · sıra ${gizli.ben?.sira} · skor ${gizli.ben?.skor}`
  );

  await odulAyariYaz({ isimGorunur: true, rozetAcik: true }, YONETICI);
  const acikPano = await liderlikPanosu(BORA, (n) => `#${n}`);
  console.log(`  ── AÇIK : ${acikPano.siralı.map((r) => `${r.sira}.${r.ad}`).join(" · ")}`);
  iddia(
    "🔑 İSİM AÇIKKEN GERÇEK ADLAR",
    acikPano.siralı.every((r) => !/^#\d+$/.test(r.ad)),
    acikPano.siralı.map((r) => r.ad).join(" · ")
  );
  await odulAyariYaz({ isimGorunur: false, rozetAcik: true }, YONETICI);

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · MOBİL UÇ — ŞOFÖR KENDİ SKORUNU GÖRÜYOR");

  const { GET } = await import("@/app/api/mobile/odul/route");
  const { mobilJeton } = await import("./_odul-jeton.mjs");
  const jeton = await mobilJeton(BORA);

  const istek = new Request("http://x/api/mobile/odul", { headers: { authorization: `Bearer ${jeton}` } });
  const yanit = await GET(istek);
  const govde = await yanit.json();
  console.log(`  ── MOBİL: ${yanit.status} · ben ${govde.ben?.ad} sıra ${govde.ben?.sira} skor ${govde.ben?.skor}`);
  iddia("mobil uç 200 döndü", yanit.status === 200 && govde.ok, `${yanit.status}`);
  iddia("🔑 ŞOFÖR KENDİ SKORUNU VE SIRASINI GÖRDÜ", govde.ben?.skor !== null && govde.ben?.sira >= 1, `sıra ${govde.ben?.sira} · skor ${govde.ben?.skor}`);
  iddia("  kendi adı açık", govde.ben?.ad === "Bora Kaya", String(govde.ben?.ad));
  iddia(
    "🔑 GÖVDE İSİM GİZLİYKEN BAŞKASININ workerId'sini TAŞIMIYOR",
    govde.siralama.filter((r) => !r.ben).every((r) => r.workerId === undefined),
    `${govde.siralama.filter((r) => r.workerId !== undefined).length} satırda kimlik var (yalnız ben olmalı)`
  );
  iddia("  seri durumu gövdede", govde.seri?.gerekenDonem === SERI_DONEM, JSON.stringify(govde.seri));
  /**
   * ⚠️ BOŞ GEÇMESİN: ilk koşumda tohumda hiç skorsuz şoför yoktu ve
   * `every` boş dizide true dönerek iddiayı geçirdi. Şimdi GERÇEK bir
   * skorsuz şoför var (Filiz: 30 günde 60 km) ve varlığı önce sınanıyor.
   */
  iddia(
    "🔑 SKORSUZ ŞOFÖR VAR VE AYRI LİSTEDE — SIFIR DEĞİL, SEBEP",
    govde.skorsuz.length > 0 &&
      govde.skorsuz.every((r) => r.skor === null && r.sira === null && r.kapi !== null),
    `${govde.skorsuz.length} skorsuz · sebepler: ${[...new Set(govde.skorsuz.map((r) => r.kapi))].join(",") || "—"}`
  );
  const filiz = govde.skorsuz.find((r) => r.ad !== undefined && r.kapi);
  iddia(
    "  kapı sayıyla açıklanıyor (ölçülen km · eşik km)",
    filiz?.km !== undefined && filiz?.esikKm !== undefined,
    `${filiz?.ad}: ${filiz?.km} km ölçüldü · eşik ${filiz?.esikKm} km · ${filiz?.kapi}`
  );
  iddia(
    "  skorsuz şoför SIRALAMAYA girmedi",
    !govde.siralama.some((r) => r.skor === null),
    `${govde.siralama.length} sıralı satırın hepsi skorlu`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · DÖNEM SONU ÖZETİ — YÖNETİCİ");

  const ozet = await donemOzeti();
  console.log(`  ── ÖDÜLLENDİR: ${ozet.odullendir.map((o) => `${o.ad} ${o.skor} [${o.rozet.join(",")}]`).join(" · ") || "yok"}`);
  console.log(`  ── DÜŞÜŞTE   : ${ozet.dususte.map((d) => `${d.ad} ${d.onceki}→${d.skor} (${d.fark})`).join(" · ") || "yok"}`);
  console.log(`  ── SKORSUZ   : ${ozet.skorsuz.map((s) => `${s.ad} [${s.kapi}]`).join(" · ") || "yok"}`);
  iddia("ödüllendirilecek listesi dolu", ozet.odullendir.length > 0, `${ozet.odullendir.length} kişi`);
  iddia(
    "🔑 YÖNETİCİ ÖZETİNDE DE SKORSUZ AYRI VE SEBEPLİ",
    ozet.skorsuz.length > 0 && ozet.skorsuz.every((s) => s.kapi !== null),
    ozet.skorsuz.map((s) => `${s.ad}[${s.kapi}]`).join(" · ") || "yok"
  );
  iddia(
    "  skorsuz şoför ÖDÜLLENDİR listesine girmedi",
    !ozet.odullendir.some((o) => o.workerId === FILIZ),
    `${ozet.odullendir.length} kişi`
  );
  iddia(
    "🔑 DÜŞÜŞTE OLAN YAKALANDI (Elif: son dönemde çok olay)",
    ozet.dususte.some((d) => d.workerId === ELIF),
    ozet.dususte.map((d) => d.ad).join(" · ") || "yok"
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · HAFTALIK AKSİYONA BAĞ");

  const { haftalikKuruKosum } = await import("@/lib/haftalik-aksiyon-db");
  const kuru = await haftalikKuruKosum(new Date());
  const enIyi = (kuru.secilen ?? []).concat(kuru.elenen ?? []).find((a) => a.kural === "ayin_en_iyisi");
  console.log(`  ── tarama: ${JSON.stringify(kuru.tarama?.ayin_en_iyisi ?? {})}`);
  iddia(
    "🔑 'AYIN EN İYİSİ' KALEMİ ÜRETİLDİ",
    Boolean(enIyi),
    enIyi ? `[${enIyi.oncelik}] ${enIyi.baslik}` : "üretilmedi"
  );
  if (enIyi) {
    iddia("  öznesi ŞOFÖR", Boolean(enIyi.workerId) && !enIyi.vehicleId, `worker=${enIyi.workerId?.slice(0, 8)}`);
    iddia("  kanıt ham sayı taşıyor", enIyi.kanit.olculen >= ROZET_SKOR_ESIK, JSON.stringify(enIyi.kanit));
    iddia("  hedef ekran ödül panosu", enIyi.hedefYol === "/admin/odul", enIyi.hedefYol);
  }

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
