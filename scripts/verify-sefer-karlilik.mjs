#!/usr/bin/env node
/**
 * SEFER BAZLI KÂRLILIK — KANIT (migration 085).
 *
 * Yığın: Docker Postgres 16 + PostgREST + proxy (docs/SEFER-KARLILIK.md §Prova).
 * Betik SAF katmanı değil, GERÇEK sunucu eylemlerini ve GERÇEK sorguları
 * koşturur: gelir sunucu eylemiyle yazılır, maliyet canlı odometre
 * satırlarından ölçülür, haftalık kural gerçek cron motorundan geçer.
 *
 * Kullanım:
 *   set -a; . <qa env>; set +a
 *   npm run verify:sefer-karlilik
 */
import {
  gelirEkle,
  gelirSil,
  getKarlilikPanosu,
  musteriKaydet,
  musteriSil,
  gelirDuzelt,
  seferOlculenMiktar,
} from "@/app/actions/karlilik";
import { seferKmOlc, zararEdenMusteriler } from "@/lib/karlilik-db";
import { gelirTutari, seferKarliligiHesapla, seferMaliyetiHesapla, eksendeTopla, uclar } from "@/lib/karlilik";
import { haftalikTuruUret } from "@/lib/haftalik-aksiyon-db";
import { supabaseAdmin } from "@/lib/supabase";

const YONETICI = "a0000000-0000-0000-0000-00000000000a";
const ALPEN = "d1000000-0000-0000-0000-0000000000d1";
const BODENSEE = "d2000000-0000-0000-0000-0000000000d2";
const OLCULEMEZ = "d3000000-0000-0000-0000-0000000000d3";
const X1 = "33333333-0000-0000-0000-000000000001"; // KISMİ: pencere var, odometre bayat
const X2 = "44444444-0000-0000-0000-000000000001"; // TAM ÖLÇÜLEMEZ: araç da pencere de yok

let dusen = 0;
const iddia = (b, k, kanit) => {
  console.log(`  ${k ? "✓" : "✗"} ${b}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (!k) dusen++;
};
const baslik = (s) => console.log(`\n═══ ${s} ═══`);
const eur = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(2)} €`);

async function kimlik(workerId, ad, isAdmin) {
  const { sealData } = await import("iron-session");
  process.env.QA_SESSION_COOKIE = await sealData(
    { worker_id: workerId, name: ad, phone: "+430000000101", is_admin: isAdmin },
    { password: process.env.SESSION_PASSWORD, ttl: 0 }
  );
}

async function main() {
  await kimlik(YONETICI, "QA Yonetici", true);

  // ══════════════════════════════════════════════════════════════════════
  baslik("1 · SAF KATMAN — tutar ve katkı payı aritmetiği");

  iddia("tutar = birim fiyat × miktar, 2 basamak", gelirTutari(1.85, 120) === 222, `1,85 × 120 = ${gelirTutari(1.85, 120)}`);
  iddia("yarım kuruş YUKARI yuvarlanır (Postgres round ile aynı)", gelirTutari(0.125, 1) === 0.13, `0,125 → ${gelirTutari(0.125, 1)}`);
  iddia("negatif girdi 0 döner (CHECK'e düşmeden)", gelirTutari(-5, 2) === 0, String(gelirTutari(-5, 2)));

  const m1 = seferMaliyetiHesapla({
    km: 120, kmDurum: "olculdu", saat: 4, saatTavanUygulandi: false,
    lPer100Km: 10, fuelEurPerL: 1.8, laborEurPerHour: 25,
  });
  iddia("yakıt = km × L/100km ÷ 100 × €/L", Math.abs(m1.yakit.eur - 21.6) < 1e-9, `120 km · 10 L/100 · 1,80 € → ${eur(m1.yakit.eur)}`);
  iddia("işçilik = saat × €/saat", m1.iscilik.eur === 100, `4 sa × 25 € → ${eur(m1.iscilik.eur)}`);
  iddia("🔑 SABİT GİDER HER ZAMAN 'atfedilemez' ve eur=null", m1.sabit.durum === "atfedilemez" && m1.sabit.eur === null, `${m1.sabit.durum} · ${m1.sabit.eur}`);
  iddia("atfedilen = yakıt + işçilik (sabit YOK)", Math.abs(m1.atfedilenEur - 121.6) < 1e-9, eur(m1.atfedilenEur));

  const m2 = seferMaliyetiHesapla({
    km: null, kmDurum: "kenar_bayat", saat: null, saatTavanUygulandi: false,
    lPer100Km: 10, fuelEurPerL: 1.8, laborEurPerHour: 25,
  });
  iddia("🔑 ÖLÇÜLEMEYEN KALEM null — SIFIR DEĞİL", m2.yakit.eur === null && m2.iscilik.eur === null && m2.atfedilenEur === null, `yakıt ${m2.yakit.eur} · işçilik ${m2.iscilik.eur} · toplam ${m2.atfedilenEur}`);

  const k1 = seferKarliligiHesapla(
    [{ id: "x", durakId: null, model: "sefer", birimFiyat: 200, miktar: 1, tutarEur: 200, miktarKaynak: "elle", aciklama: null }],
    m1
  );
  iddia("katkı payı = gelir − atfedilen", Math.abs(k1.katkiPayiEur - 78.4) < 1e-9, `200 − 121,60 = ${eur(k1.katkiPayiEur)}`);
  iddia("marj = katkı / gelir", Math.abs(k1.marj - 0.392) < 1e-9, `%${(k1.marj * 100).toFixed(1)}`);

  const yariOlculu = seferMaliyetiHesapla({
    km: 120, kmDurum: "olculdu", saat: null, saatTavanUygulandi: false,
    lPer100Km: 10, fuelEurPerL: 1.8, laborEurPerHour: 25,
  });
  const k2 = seferKarliligiHesapla(
    [{ id: "y", durakId: null, model: "sefer", birimFiyat: 200, miktar: 1, tutarEur: 200, miktarKaynak: "elle", aciklama: null }],
    yariOlculu
  );
  iddia("🔑 KISMİ ÖLÇÜM İŞARETLENİYOR (katkı payı olduğundan yüksek)", k2.eksikMaliyet === true, `katkı ${eur(k2.katkiPayiEur)} · eksik kalem ${yariOlculu.olculemeyenKalem}`);
  iddia("hiç ölçülemeyen seferde katkı payı null (0 değil)", seferKarliligiHesapla([], m2).katkiPayiEur === null, String(seferKarliligiHesapla([], m2).katkiPayiEur));

  const uc = uclar(
    eksendeTopla([
      { id: "a", ad: "A", k: k1 },
      { id: "b", ad: "B", k: seferKarliligiHesapla([], m1) },
    ])
  );
  iddia("🔑 'en zararlı' YALNIZ negatiflerden seçilir", uc.enZararli.every((s) => s.katkiPayiEur < 0), `${uc.enZararli.length} zararlı · ${uc.enKarli.length} kârlı`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("2 · SEFER KM'Sİ — GERÇEK ODOMETRE PENCERESİ");

  const { data: sefRows } = await supabaseAdmin
    .from("seferler")
    .select("id, vehicle_id, yolda_at, tamamlandi_at, musteri_id")
    .order("tarih", { ascending: false });
  const alpen1 = sefRows.find((s) => s.musteri_id === ALPEN);
  const olc = await seferKmOlc(alpen1.vehicle_id, alpen1.yolda_at, alpen1.tamamlandi_at);
  iddia("odometre farkından km ÖLÇÜLDÜ", olc.durum === "olculdu" && olc.km === 120, `${olc.km} km · uç sapması ${olc.basSapmaDk}/${olc.bitSapmaDk} dk`);

  const x1 = sefRows.find((s) => s.id === X1);
  const olcX = await seferKmOlc(x1.vehicle_id, x1.yolda_at, x1.tamamlandi_at);
  iddia("🔑 KENAR BAYAT → km null, sebebi KAYITLI", olcX.km === null && olcX.durum === "kenar_bayat", `${olcX.durum} · sapma ${olcX.basSapmaDk}/${olcX.bitSapmaDk} dk (eşik 15)`);

  const olcAracsiz = await seferKmOlc(null, alpen1.yolda_at, alpen1.tamamlandi_at);
  iddia("araç yoksa ayrı sebep döner", olcAracsiz.durum === "arac_yok", olcAracsiz.durum);
  const olcPencereSiz = await seferKmOlc(alpen1.vehicle_id, null, null);
  iddia("pencere yoksa ayrı sebep döner", olcPencereSiz.durum === "pencere_yok", olcPencereSiz.durum);

  // ══════════════════════════════════════════════════════════════════════
  baslik("3 · GELİR GİRİŞİ — GERÇEK SUNUCU EYLEMİ");

  const olculen = await seferOlculenMiktar(alpen1.id);
  iddia("form 'ölç' düğmesi km'yi ölçüyor", olculen.km === 120, `${olculen.km} km · ${olculen.saat} sa`);
  const olculenX = await seferOlculenMiktar(X1);
  iddia("🔑 ölçülemeyen seferde form 0 DÖNDÜRMEZ, null döner", olculenX.km === null, `km=${olculenX.km} · durum=${olculenX.kmDurum}`);

  // Alpen: 4 sefer × 2,50 €/km × 120 km = 300 € (KÂRLI)
  for (const s of sefRows.filter((r) => r.musteri_id === ALPEN)) {
    const r = await gelirEkle({ seferId: s.id, model: "km", birimFiyat: 2.5, miktar: 120, miktarKaynak: "olculdu" });
    if (!r.ok) iddia("Alpen geliri yazıldı", false, r.hata);
  }
  // Bodensee: 3 sefer × 100 € götürü (ZARARLI — 200 km maliyeti daha yüksek)
  for (const s of sefRows.filter((r) => r.musteri_id === BODENSEE)) {
    const r = await gelirEkle({ seferId: s.id, model: "sefer", birimFiyat: 100, miktar: 1 });
    if (!r.ok) iddia("Bodensee geliri yazıldı", false, r.hata);
  }
  // Ölçülemez Ltd: geliri var ama maliyeti ölçülemiyor
  await gelirEkle({ seferId: X1, model: "sefer", birimFiyat: 500, miktar: 1 });

  const { data: gelirRows } = await supabaseAdmin.from("sefer_gelirleri").select("*").order("created_at");
  iddia("8 gelir satırı yazıldı", gelirRows.length === 8, `${gelirRows.length} satır`);
  const kmSatiri = gelirRows.find((g) => g.model === "km");
  iddia("🔑 tutar ÜRETİLMİŞ kolondan geliyor (2,50 × 120)", Number(kmSatiri.tutar_eur) === 300, `${kmSatiri.tutar_eur} €`);
  iddia("miktar kaynağı 'olculdu' olarak saklandı", kmSatiri.miktar_kaynak === "olculdu", kmSatiri.miktar_kaynak);
  iddia("para birimi EUR", kmSatiri.para_birimi === "EUR", kmSatiri.para_birimi);

  const { error: yazHata } = await supabaseAdmin
    .from("sefer_gelirleri")
    .update({ tutar_eur: 999 })
    .eq("id", kmSatiri.id);
  iddia("🔑 tutar ELLE YAZILAMIYOR (üretilmiş kolon)", Boolean(yazHata), yazHata ? yazHata.code : "YAZILDI!");

  // ── DÜZELTME: birim fiyat değişince ÜRETİLMİŞ tutar da değişmeli.
  const duz = await gelirDuzelt(kmSatiri.id, { model: "km", birimFiyat: 3, miktar: 120, miktarKaynak: "olculdu" });
  const { data: duzeltilmis } = await supabaseAdmin.from("sefer_gelirleri").select("tutar_eur, created_at").eq("id", kmSatiri.id).single();
  iddia("gelir satırı DÜZELTİLEBİLİYOR", duz.ok && Number(duzeltilmis.tutar_eur) === 360, `300 € → ${duzeltilmis.tutar_eur} €`);
  iddia("  düzeltmede created_at izi KORUNDU (silinip yeniden yazılmadı)", duzeltilmis.created_at === kmSatiri.created_at, "aynı");
  await gelirDuzelt(kmSatiri.id, { model: "km", birimFiyat: 2.5, miktar: 120, miktarKaynak: "olculdu" });

  const kotuModel = await gelirEkle({ seferId: alpen1.id, model: "agirlik", birimFiyat: 1, miktar: 1 });
  iddia("desteklenmeyen tarife tabanı REDDEDİLDİ", !kotuModel.ok && kotuModel.hata === "model_gecersiz", kotuModel.ok ? "kabul etti!" : kotuModel.hata);

  // ══════════════════════════════════════════════════════════════════════
  baslik("4 · SEFER KÂRLILIĞI — HAM SAYILARLA");

  const pano = await getKarlilikPanosu();
  iddia("pano 9 tamamlanmış seferi taradı", pano.seferSayisi === 9, `${pano.seferSayisi} sefer · ${pano.gelirliSefer} gelirli`);

  const alpenSatir = pano.satirlar.find((r) => r.seferId === alpen1.id);
  const km = alpenSatir.kmOlcum.km;
  const bekYakit = (km * pano.oranlar.lPer100Km) / 100 * pano.oranlar.fuelEurPerL;
  const bekIscilik = 4 * pano.oranlar.laborEurPerHour;
  console.log(`  ── HAM: ${km} km · ${pano.oranlar.lPer100Km} L/100km · ${pano.oranlar.fuelEurPerL} €/L · ${pano.oranlar.laborEurPerHour} €/sa`);
  console.log(`     gelir ${eur(alpenSatir.karlilik.gelirEur)} · yakıt ${eur(alpenSatir.karlilik.maliyet.yakit.eur)} · işçilik ${eur(alpenSatir.karlilik.maliyet.iscilik.eur)} · KATKI ${eur(alpenSatir.karlilik.katkiPayiEur)}`);
  iddia("yakıt kalemi ham hesapla birebir", Math.abs(alpenSatir.karlilik.maliyet.yakit.eur - bekYakit) < 0.01, `${eur(alpenSatir.karlilik.maliyet.yakit.eur)} = ${eur(bekYakit)}`);
  iddia("işçilik kalemi ham hesapla birebir", Math.abs(alpenSatir.karlilik.maliyet.iscilik.eur - bekIscilik) < 0.01, `${eur(alpenSatir.karlilik.maliyet.iscilik.eur)} = ${eur(bekIscilik)}`);
  iddia(
    "katkı payı = gelir − (yakıt + işçilik)",
    Math.abs(alpenSatir.karlilik.katkiPayiEur - (300 - bekYakit - bekIscilik)) < 0.01,
    `${eur(alpenSatir.karlilik.katkiPayiEur)}`
  );

  // X1 — KISMİ ölçüm: pencere var (işçilik ölçülür), odometre bayat (yakıt ölçülemez).
  const xSatir = pano.satirlar.find((r) => r.seferId === X1);
  iddia("kısmi ölçümde yakıt null, işçilik ölçülü", xSatir.karlilik.maliyet.yakit.eur === null && xSatir.karlilik.maliyet.iscilik.eur !== null, `yakıt ${xSatir.karlilik.maliyet.yakit.eur} · işçilik ${eur(xSatir.karlilik.maliyet.iscilik.eur)}`);
  iddia("🔑 KISMİ ÖLÇÜM İŞARETLİ — katkı payı olduğundan yüksek", xSatir.karlilik.eksikMaliyet === true, `katkı ${eur(xSatir.karlilik.katkiPayiEur)} · eksik=${xSatir.karlilik.eksikMaliyet}`);
  iddia("  sebebi satırda duruyor", xSatir.kmOlcum.durum === "kenar_bayat", xSatir.kmOlcum.durum);

  // X2 — HİÇBİR kalem ölçülemiyor.
  const x2 = pano.satirlar.find((r) => r.seferId === X2);
  iddia("🔑 hiçbir kalemi ölçülemeyen seferde katkı payı null (0 DEĞİL)", x2.karlilik.katkiPayiEur === null && x2.karlilik.maliyet.atfedilenEur === null, `katkı=${x2.karlilik.katkiPayiEur} · atfedilen=${x2.karlilik.maliyet.atfedilenEur}`);
  iddia("  sebebi 'araç yok'", x2.kmOlcum.durum === "arac_yok", x2.kmOlcum.durum);

  // ══════════════════════════════════════════════════════════════════════
  baslik("5 · MÜŞTERİ BAZLI TOPLAM");

  const alpenTop = pano.musteri.find((m) => m.id === ALPEN);
  const bodTop = pano.musteri.find((m) => m.id === BODENSEE);
  const olcTop = pano.musteri.find((m) => m.id === OLCULEMEZ);
  console.log(`  ── ${alpenTop.ad}: ${alpenTop.seferSayisi} sefer · gelir ${eur(alpenTop.gelirEur)} · maliyet ${eur(alpenTop.maliyetEur)} · katkı ${eur(alpenTop.katkiPayiEur)}`);
  console.log(`  ── ${bodTop.ad}: ${bodTop.seferSayisi} sefer · gelir ${eur(bodTop.gelirEur)} · maliyet ${eur(bodTop.maliyetEur)} · katkı ${eur(bodTop.katkiPayiEur)}`);
  console.log(`  ── ${olcTop.ad}: ${olcTop.seferSayisi} sefer · gelir ${eur(olcTop.gelirEur)} · maliyetsiz sefer ${olcTop.maliyetsizSefer}`);

  iddia("Alpen 4 seferde KÂRLI", alpenTop.seferSayisi === 4 && alpenTop.katkiPayiEur > 0, eur(alpenTop.katkiPayiEur));
  iddia("Bodensee 3 seferde ZARARLI", bodTop.seferSayisi === 3 && bodTop.katkiPayiEur < 0, eur(bodTop.katkiPayiEur));
  iddia("müşteri geliri sefer gelirlerinin toplamı", Math.abs(alpenTop.gelirEur - 1200) < 0.01, `4 × 300 = ${eur(alpenTop.gelirEur)}`);
  iddia(
    "🔑 MALİYETİ HİÇ ÖLÇÜLEMEYEN SEFER geliri toplama GİRİYOR ama maliyeti 0 SAYILMIYOR",
    olcTop.maliyetsizSefer === 1 && olcTop.eksikMaliyetliSefer === 1,
    `gelir ${eur(olcTop.gelirEur)} · maliyet ${eur(olcTop.maliyetEur)} · maliyetsiz ${olcTop.maliyetsizSefer} · eksik ${olcTop.eksikMaliyetliSefer}`
  );
  iddia(
    "🔴 ÖLÇÜMÜ EKSİK MÜŞTERİ 'EN KÂRLI' SIRALAMASINA GİRMİYOR",
    !pano.enKarli.some((m) => m.id === OLCULEMEZ) && pano.ucDisiOlcumsuz === 1,
    `sıralama: ${pano.enKarli.map((m) => m.ad).join(" · ")} · eleneni ${pano.ucDisiOlcumsuz}`
  );
  iddia("araç ekseni de çalışıyor (2 araç + araçsız kova)", pano.arac.length === 3, pano.arac.map((a) => `${a.ad}:${a.katkiPayiEur.toFixed(0)}€`).join(" · "));
  iddia("şoför ekseni de çalışıyor", pano.sofor.length === 1, pano.sofor.map((a) => a.ad).join(" · "));
  iddia("araçsız sefer araç ekseninde 'araç yok' satırına düşüyor", pano.arac.some((a) => a.id === null), pano.arac.map((a) => a.ad).join(" · "));
  iddia("en zararlı listesinde Bodensee var", pano.enZararli.some((m) => m.id === BODENSEE), pano.enZararli.map((m) => m.ad).join(" · ") || "boş");
  iddia("en kârlı listesinde Alpen ilk sırada", pano.enKarli[0]?.id === ALPEN, pano.enKarli.map((m) => m.ad).join(" · "));

  // ══════════════════════════════════════════════════════════════════════
  baslik("6 · ATFEDİLEMEYEN MALİYET AÇIKÇA İŞARETLİ");

  iddia(
    "🔑 sabit gider AYRI kalemde, katkı payına DAHİL DEĞİL",
    pano.toplam.atfedilemezSabitEur !== null && pano.toplam.atfedilemezSabitEur > 0,
    `${eur(pano.toplam.atfedilemezSabitEur)} · ${pano.toplam.atfedilemezAracGun} araç-günü`
  );
  const beklenenSabit = pano.toplam.atfedilemezAracGun * pano.oranlar.vehicleEurPerDay;
  iddia("sabit gider = araç-günü × €/gün", Math.abs(pano.toplam.atfedilemezSabitEur - beklenenSabit) < 0.01, `${pano.toplam.atfedilemezAracGun} × ${pano.oranlar.vehicleEurPerDay} = ${eur(beklenenSabit)}`);
  iddia(
    "toplam katkı payı = gelir − atfedilen (sabit YOK)",
    Math.abs(pano.toplam.katkiPayiEur - (pano.toplam.gelirEur - pano.toplam.maliyetEur)) < 0.01,
    `${eur(pano.toplam.gelirEur)} − ${eur(pano.toplam.maliyetEur)} = ${eur(pano.toplam.katkiPayiEur)}`
  );
  iddia(
    "her sefer satırı sabit gideri 'atfedilemez' taşıyor",
    pano.satirlar.every((r) => r.karlilik.maliyet.sabit.durum === "atfedilemez" && r.karlilik.maliyet.sabit.eur === null),
    `${pano.satirlar.length}/${pano.satirlar.length} satır`
  );

  // ══════════════════════════════════════════════════════════════════════
  baslik("7 · HAFTALIK AKSİYONA DÜŞTÜ MÜ");

  const zarar = await zararEdenMusteriler(new Date());
  iddia("zarar eden müşteri bulundu", zarar.satirlar.length === 1 && zarar.satirlar[0].musteriId === BODENSEE, zarar.satirlar.map((z) => `${z.ad} ${z.katkiPayiEur.toFixed(0)}€`).join(" · ") || "yok");
  iddia(
    "🔑 MALİYETİ ÖLÇÜLEMEYEN MÜŞTERİ 'zararlı' SAYILMADI",
    !zarar.satirlar.some((z) => z.musteriId === OLCULEMEZ),
    `aday ${zarar.aday} müşteri`
  );

  const tur = await haftalikTuruUret(new Date());
  const kalem = (tur.secilen ?? []).find((a) => a.kural === "musteri_zarar");
  iddia("haftalık tura MÜŞTERİ ZARAR kalemi düştü", Boolean(kalem), kalem ? `[${kalem.oncelik}] ${kalem.baslik}` : (tur.secilen ?? []).map((a) => a.kural).join(",") || "kalem yok");
  if (kalem) {
    iddia("  öznesi MÜŞTERİ (şoför/araç değil)", kalem.musteriId === BODENSEE && !kalem.workerId && !kalem.vehicleId, `musteri=${kalem.musteriId?.slice(0, 8)}`);
    iddia("  kanıt ham sayıları taşıyor", kalem.kanit.olculen < 0 && kalem.kanit.esik === 0 && kalem.kanit.seferSayisi === 3, JSON.stringify(kalem.kanit));
    iddia("  🔑 gerekçe SABİT GİDERİN HARİÇ olduğunu SÖYLÜYOR", kalem.kanit.sabitGiderHaric === true && /sabit gider/i.test(kalem.gerekce), "gerekçede yazıyor");
    iddia("  hedef ekran kârlılık panosu", kalem.hedefYol === "/admin/karlilik", kalem.hedefYol);
  }

  const { data: yazilan } = await supabaseAdmin
    .from("haftalik_aksiyonlar")
    .select("kural, musteri_id, worker_id, vehicle_id")
    .eq("kural", "musteri_zarar");
  iddia("kalem musteri_id kolonuyla YAZILDI (085 indeksi)", yazilan.length === 1 && yazilan[0].musteri_id === BODENSEE, `${yazilan.length} satır`);

  // ══════════════════════════════════════════════════════════════════════
  baslik("8 · MÜŞTERİ CRUD — iki aşamalı silme");

  const yeni = await musteriKaydet({ ad: "QA Silinebilir" });
  iddia("müşteri eklendi", yeni.ok, yeni.ok ? "ok" : yeni.hata);
  const kopya = await musteriKaydet({ ad: "QA Silinebilir" });
  iddia("aynı ad İKİNCİ KEZ eklenemiyor", !kopya.ok && kopya.hata === "ad_zaten_var", kopya.ok ? "ekledi!" : kopya.hata);

  const { data: yeniRow } = await supabaseAdmin.from("musteriler").select("id").eq("ad", "QA Silinebilir").single();
  const silme1 = await musteriSil(yeniRow.id);
  iddia("seferi OLMAYAN müşteri GERÇEKTEN siliniyor", silme1.ok && silme1.pasiflesti === false, `pasiflesti=${silme1.pasiflesti}`);

  const silme2 = await musteriSil(BODENSEE);
  const { data: bodRow } = await supabaseAdmin.from("musteriler").select("aktif").eq("id", BODENSEE).single();
  iddia("🔑 seferi OLAN müşteri silinmiyor, PASİFLEŞİYOR", silme2.ok && silme2.pasiflesti === true && bodRow.aktif === false, `pasiflesti=${silme2.pasiflesti} · aktif=${bodRow.aktif}`);

  const { data: sefKaldi } = await supabaseAdmin.from("seferler").select("id").eq("musteri_id", BODENSEE);
  iddia("  geçmiş seferlerin müşteri bağı KOPMADI", sefKaldi.length === 3, `${sefKaldi.length} sefer`);
  await supabaseAdmin.from("musteriler").update({ aktif: true }).eq("id", BODENSEE);

  // ══════════════════════════════════════════════════════════════════════
  baslik("9 · DURAK DÜZEYİ GELİR (Ölçüm 4)");

  const { data: durak } = await supabaseAdmin
    .from("sefer_duraklari")
    .insert({ sefer_id: alpen1.id, sira: 1, ad: "QA Durak" })
    .select("id")
    .single();
  const dg = await gelirEkle({ seferId: alpen1.id, durakId: durak.id, model: "paket", birimFiyat: 1.2, miktar: 50 });
  iddia("durak düzeyinde gelir yazılabiliyor", dg.ok && dg.tutar === 60, eur(dg.tutar));

  const pano2 = await getKarlilikPanosu();
  const alpen2 = pano2.satirlar.find((r) => r.seferId === alpen1.id);
  iddia("sefer geliri = sefer düzeyi + durak düzeyi", alpen2.karlilik.gelirEur === 360, `300 + 60 = ${eur(alpen2.karlilik.gelirEur)}`);

  await supabaseAdmin.from("sefer_duraklari").delete().eq("id", durak.id);
  const pano3 = await getKarlilikPanosu();
  const alpen3 = pano3.satirlar.find((r) => r.seferId === alpen1.id);
  iddia(
    "🔑 DURAK SİLİNDİ → gelir satırı DURUYOR, toplam DEĞİŞMEDİ (para kazanılmıştır)",
    alpen3.karlilik.gelirEur === 360,
    eur(alpen3.karlilik.gelirEur)
  );
  const { data: kalanGelir } = await supabaseAdmin.from("sefer_gelirleri").select("durak_id").eq("model", "paket").single();
  iddia("  yalnız durak bağı koptu", kalanGelir.durak_id === null, String(kalanGelir.durak_id));

  // ══════════════════════════════════════════════════════════════════════
  baslik("10 · MEVCUT €/km MOTORU BOZULMADI");

  const { buildCostReport } = await import("@/lib/reports");
  const bit = new Date();
  const bas = new Date(bit.getTime() - 30 * 86_400_000);
  // buildCostReport yakıt girdisini DIŞARIDAN alır (buildFuelReport'un ölçümü).
  // QA yığınında yakıt raporu koşturulmuyor; ölçülemedi hâli geçiliyor.
  const yakitGirdi = { fleetLPer100Km: null, measuredLiters: null };
  const rapor = await buildCostReport({ start: bas, end: bit }, yakitGirdi);
  /**
   * ⚠️ BU BÖLÜM BOŞ GEÇMEMELİ. İlk koşumda tohumda hiç vardiya yoktu ve
   * rapor "0,00 = 0,00 + 0,00 + 0,00" ile GEÇTİ — hiçbir şey kanıtlamadan.
   * Paydaların gerçekten dolu olduğu ÖNCE sınanıyor.
   */
  iddia("maliyet raporu GERÇEK sayı üretiyor (boş iddia değil)", rapor.basis.totalShifts > 0 && rapor.basis.km > 0 && rapor.totals.totalEur > 0, `${rapor.basis.totalShifts} vardiya · ${rapor.basis.km.toFixed(0)} km · ${rapor.totals.totalEur.toFixed(2)} €`);
  iddia(
    "🔑 maliyet motoru YALNIZ time_entries paydalarını kullanıyor (sefer geliri onu etkilemiyor)",
    rapor.totals.totalEur === rapor.totals.fuelEur + rapor.totals.laborEur + rapor.totals.fixedEur,
    `${rapor.totals.totalEur.toFixed(2)} = ${rapor.totals.fuelEur.toFixed(2)} + ${rapor.totals.laborEur.toFixed(2)} + ${rapor.totals.fixedEur.toFixed(2)}`
  );
  iddia(
    "  €/km hâlâ km paydasından (gelirden bağımsız)",
    rapor.basis.km > 0 ? Math.abs(rapor.totals.eurPerKm - rapor.totals.totalEur / rapor.basis.km) < 1e-9 : rapor.totals.eurPerKm === null,
    rapor.totals.eurPerKm === null ? "km yok → null" : `${rapor.totals.eurPerKm.toFixed(3)} €/km`
  );

  // Gelir satırlarını sil ve raporun DEĞİŞMEDİĞİNİ ölç.
  const oncekiToplam = rapor.totals.totalEur;
  const { data: hepsi } = await supabaseAdmin.from("sefer_gelirleri").select("id");
  for (const g of hepsi) await gelirSil(g.id);
  const rapor2 = await buildCostReport({ start: bas, end: bit }, yakitGirdi);
  iddia(
    "🔑 TÜM GELİR SİLİNDİ → €/km motoru AYNI sayıyı üretti",
    oncekiToplam > 0 && Math.abs(rapor2.totals.totalEur - oncekiToplam) < 1e-9,
    `${oncekiToplam.toFixed(2)} € → ${rapor2.totals.totalEur.toFixed(2)} € · ${rapor2.totals.eurPerKm?.toFixed(3)} €/km`
  );

  console.log(`\n${dusen === 0 ? "✓ TÜM İDDİALAR GEÇTİ" : `✗ ${dusen} İDDİA DÜŞTÜ`}\n`);
  process.exit(dusen === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗ ÇÖKTÜ:", e);
  process.exit(1);
});
