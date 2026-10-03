#!/usr/bin/env node
/**
 * SESLİ ASİSTAN — ÖZET + ÖNBELLEK BİRİM DENETİMİ (Faz 1c, 03.10.2026). Ağ ve veritabanı YOK.
 *
 * Araçların modele verdiği özetler (`lib/asistan-sesli-ozet.ts`) ve araç önbelleği
 * (`lib/asistan-sesli-onbellek.ts`) GERÇEK modüllerle, örnek uç gövdeleriyle sınanır:
 *   • yer adı: bölge içi (iç içede en küçüğü) → en yakın bölge ≤ 10 km → adres yok;
 *     koordinat çıktıya HİÇ girmez;
 *   • aksiyon özeti: mobil Aksiyon Merkezi kademeleri (belge türü kalan günden), alarm
 *     kademeleri, en çok 3 tür, tavan dışı belge kalemi, alarm okunamazsa "ölçülemedi";
 *   • geçmiş gün: vardiyasız / sıfır km / ölçülemeyen km, liste kesilince null;
 *   • tarih: dün/bugün/yarın, ay ve yıl sınırı, takvimde olmayan gün;
 *   • önbellek: 60 sn ömür, uçuştaki isteği paylaşma, hata saklanmaz, kimliksiz çağrı
 *     saklanmaz, ön ısıtmanın tazeleme eşiği;
 *   • Faz 2a sınırları (`lib/asistan-sesli-sinir.ts`): imzalı oturum jetonu (kurcalama,
 *     başka kullanıcı, süre), sunucu saniyesi (kırpma, geri gitmeme), gün/ay sayımı (kapalı,
 *     canlı, ölü oturum), sınır kararı ve maliyet tabanı.
 *
 * `ts-server-kuru` ile koşar (server-only şimi + sahte env); veritabanına bağlanmaz.
 * Kullanım: npm run lint:asistan-sesli-ozet
 */
import {
  aksiyonOzeti,
  bolgeListesi,
  gecmisGunOzeti,
  gunCoz,
  hareketDurumu,
  yerBul,
} from "../lib/asistan-sesli-ozet.ts";
import { onbellekli, onbellegiBosalt } from "../lib/asistan-sesli-onbellek.ts";
import {
  etkinSaniye,
  jetonCoz,
  jetonDurumu,
  jetonImzala,
  kayitMaliyeti,
  maliyetTabani,
  nabizSaniyesi,
  sinirKarari,
} from "../lib/asistan-sesli-sinir.ts";

let dusen = 0;
let gecen = 0;
function esit(ad, gercek, beklenen) {
  const a = JSON.stringify(gercek);
  const b = JSON.stringify(beklenen);
  if (a === b) gecen++;
  else {
    dusen++;
    console.log(`  ✗ ${ad}\n      beklenen: ${b}\n      gelen:    ${a}`);
  }
}
function dogru(ad, kosul, ayrinti = "") {
  if (kosul) gecen++;
  else {
    dusen++;
    console.log(`  ✗ ${ad} ${ayrinti}`);
  }
}

// ── yer adı ─────────────────────────────────────────────────────────────────
const bolgeGovdesi = {
  bolgeler: [
    { ad: "Depo Nord", kategori: "depot", lat: 48.25, lng: 16.4, yaricapM: 300, aktif: true, archivedAt: null },
    { ad: "Depo Nord Rampa", kategori: "depot", lat: 48.25, lng: 16.4, yaricapM: 80, aktif: true, archivedAt: null },
    { ad: "Kunde Simmering", kategori: "customer", lat: 48.17, lng: 16.42, yaricapM: 150, aktif: true, archivedAt: null },
    { ad: "Eski Depo", kategori: "depot", lat: 48.3, lng: 16.3, yaricapM: 500, aktif: true, archivedAt: "2026-09-01T00:00:00Z" },
    { ad: "Pasif Bölge", kategori: "restricted", lat: 48.21, lng: 16.37, yaricapM: 5000, aktif: false, archivedAt: null },
    { ad: "Koordinatsız", kategori: "customer", lat: null, lng: 16.3, yaricapM: 100, aktif: true, archivedAt: null },
  ],
};
const bolgeler = bolgeListesi(bolgeGovdesi);
esit("bölge listesi: arşivli, pasif, koordinatsız elenir", bolgeler.map((b) => b.ad), ["Depo Nord", "Depo Nord Rampa", "Kunde Simmering"]);
esit("bölge içi → iç içede en küçüğü", yerBul({ lat: 48.25, lng: 16.4 }, bolgeler), { tur: "bolgede", ad: "Depo Nord Rampa", kategori: "depot" });
esit("bölge içi (yalnız dıştaki)", yerBul({ lat: 48.2515, lng: 16.4 }, bolgeler).ad, "Depo Nord");
const yakin = yerBul({ lat: 48.188, lng: 16.42 }, bolgeler); // Kunde Simmering'in ~2 km kuzeyi
esit("yakında → en yakın bölge ve km", [yakin.tur, yakin.ad], ["yakininda", "Kunde Simmering"]);
dogru("yakında mesafe ~2 km", typeof yakin.mesafeKm === "number" && yakin.mesafeKm > 1.8 && yakin.mesafeKm < 2.2, JSON.stringify(yakin));
esit("10 km dışı → adres yok", yerBul({ lat: 47.8, lng: 16.0 }, bolgeler), { tur: "adres_yok" });
esit("konum yok", yerBul(null, bolgeler), { tur: "konum_yok" });
esit("bölgeler okunamadı → adres yok", yerBul({ lat: 48.25, lng: 16.4 }, null), { tur: "adres_yok" });
dogru("çıktıda koordinat yok", !/lat|lng|48\.25|16\.4/.test(JSON.stringify([yakin, yerBul({ lat: 48.25, lng: 16.4 }, bolgeler)])));

// ── harita şeridi ────────────────────────────────────────────────────────────
esit("2 sa+ sinyal → sinyal yok", hareketDurumu({ sonSinyalMs: 3 * 3600_000, durum: "sevkiyatta" }), "sinyal_yok");
esit("sevkiyatta → yolda", hareketDurumu({ sonSinyalMs: 60_000, durum: "sevkiyatta" }), "yolda");
esit("molada → duruyor", hareketDurumu({ sonSinyalMs: 60_000, durum: "molada" }), "duruyor");

// ── tarih ───────────────────────────────────────────────────────────────────
esit("varsayılan bugün", gunCoz({}, "2026-10-03"), { ok: true, tarih: "2026-10-03", bugun: "2026-10-03" });
esit("dün", gunCoz({ gun: "dun" }, "2026-10-03").tarih, "2026-10-02");
esit("yarın", gunCoz({ gun: "yarin" }, "2026-10-03").tarih, "2026-10-04");
esit("ay sınırı", gunCoz({ gun: "dun" }, "2026-10-01").tarih, "2026-09-30");
esit("yıl sınırı", gunCoz({ gun: "dun" }, "2027-01-01").tarih, "2026-12-31");
esit("açık tarih gün'ü ezer", gunCoz({ gun: "dun", tarih: "2026-09-15" }, "2026-10-03").tarih, "2026-09-15");
esit("takvimde olmayan gün", gunCoz({ tarih: "2026-02-30" }, "2026-10-03").ok, false);
esit("bozuk biçim", gunCoz({ tarih: "15.09.2026" }, "2026-10-03").ok, false);

// ── aksiyon özeti ───────────────────────────────────────────────────────────
const pano = {
  uyari: {
    toplam: 24,
    tur: { overLimit: 2, silent: 10, inspection: 3, workOrder: 4, undelivered: 5 },
    kirpildi: false,
    kalemler: [
      { tur: "overLimit", sofor: "Anna", id: "x1" },
      { tur: "silent", plaka: "W-GF-101", saat: 30, id: "x2" },
      { tur: "inspection", plaka: "W-GF-102", kalanGun: -2, id: "x3" },
      { tur: "inspection", plaka: "W-GF-103", kalanGun: 5, id: "x4" },
      { tur: "inspection", plaka: "W-GF-104", kalanGun: 10, id: "x5" },
    ],
  },
  dtcAracSayisi: 1,
  onayBekleyen: { izin: 2 },
  ertelemeToplam: 1,
  kapsam: { isChief: false },
};
const alarm = { turDagilim: { overspeeding: 20, harsh_braking: 7, idling: 30, yeni_tur: 1 } };
const ak = aksiyonOzeti(pano, alarm);
esit("kritik = overLimit 2 + silent 10 + geçmiş muayene 1 + dtc 1 + hız 20", ak.ozet.kritik, 34);
esit("uyarı = yaklaşan muayene 2 + iş emri 4 + sert fren 7 + tanınmayan 1", ak.ozet.uyari, 14);
esit("rutin = teslim edilemeyen 5 + rölanti 30", ak.ozet.rutin, 35);
esit("en çok 3 tür (rutin hariç)", ak.ozet.enCokTurler, [
  { ad: "speeding", kademe: "kritik", adet: 20 },
  { ad: "no signal for 24+ hours", kademe: "kritik", adet: 10 },
  { ad: "harsh braking", kademe: "uyari", adet: 7 },
]);
esit("onay + erteleme aynen", [ak.ozet.onayBekleyenIzin, ak.ozet.ertelenen], [2, 1]);
esit("kritik kalemler: overLimit, silent, geçmiş muayene", ak.kritikKalemler.map((k) => k.ad), [
  "daily working-time limit exceeded",
  "no signal for 24+ hours",
  "vehicle inspection due",
]);
dogru("özette kod yok (overspeeding)", !JSON.stringify(ak.ozet.enCokTurler).includes("overspeeding"));
const alarmsiz = aksiyonOzeti(pano, null);
esit("alarm okunamadı → ölçülemedi, alarmlar sayılmaz", [alarmsiz.ozet.alarmlar, alarmsiz.ozet.kritik], ["olculemedi", 14]);
const tavanli = aksiyonOzeti(
  { ...pano, uyari: { ...pano.uyari, tur: { inspection: 25 }, kalemler: Array.from({ length: 20 }, (_, i) => ({ tur: "inspection", kalanGun: i - 3 })) } },
  alarm
);
esit("tavan dışı belge kalemi ölçülemiyor", tavanli.ozet.kademesiOlculemeyen, 5);

// ── geçmiş gün ──────────────────────────────────────────────────────────────
const filo = {
  page: { total: 4 },
  araclar: [
    { id: "a", plaka: "W-GF-101", durum: "aktif" },
    { id: "b", plaka: "W-GF-102", durum: "aktif" },
    { id: "c", plaka: "W-GF-103", durum: "bakimda" },
    { id: "d", plaka: "W-GF-113", durum: "aktif" },
  ],
};
const vardiya = {
  page: { total: 4 },
  vardiyalar: [
    { aracId: "a", km: 120 },
    { aracId: "a", km: null },
    { aracId: "b", km: 0 },
    { aracId: null, km: 15 },
  ],
};
const gg = gecmisGunOzeti("2026-10-02", filo, vardiya, undefined);
esit("geçmiş gün sayıları", gg.ozet, {
  toplamArac: 4,
  vardiyaAcilanArac: 2,
  vardiyaAcilmayanArac: 2,
  vardiyaliAmaSifirKm: 1,
  vardiyaSayisi: 4,
});
esit("vardiyasız araçlar", gg.vardiyaAcilmayanlar.satirlar.map((x) => x.plaka), ["W-GF-103", "W-GF-113"]);
esit("sıfır km (ölçülmüş)", gg.vardiyaliAmaSifirKm, ["W-GF-102"]);
esit("km: ölçülen toplanır, ölçülemeyen sayılır", gg.vardiyaAcilanlar.satirlar[0], {
  plaka: "W-GF-101",
  vardiya: 2,
  km: 120,
  kmOlculemeyenVardiya: 1,
});
const kesik = gecmisGunOzeti("2026-10-02", filo, { ...vardiya, page: { total: 300 } }, undefined);
esit("vardiya listesi kesik → çalışmayan ölçülemez", [kesik.ozet.vardiyaAcilmayanArac, kesik.vardiyaAcilmayanlar, kesik.eksik], [
  null,
  null,
  "vardiya_listesi_kirpildi",
]);
esit("plaka süzgeci", gecmisGunOzeti("2026-10-02", filo, vardiya, "113").vardiyaAcilmayanlar.satirlar.map((x) => x.plaka), ["W-GF-113"]);

// ── önbellek ────────────────────────────────────────────────────────────────
{
  onbellegiBosalt();
  let calisma = 0;
  const uret = async () => {
    calisma++;
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, n: calisma };
  };
  const tamam = (s) => s.ok;
  const [a, b] = await Promise.all([onbellekli("k1", uret, tamam), onbellekli("k1", uret, tamam)]);
  esit("uçuştaki istek paylaşılır (tek hesap)", [calisma, a.durum, b.durum, b.deger.n], [1, "yok", "ucusta", 1]);
  const c = await onbellekli("k1", uret, tamam);
  esit("60 sn içinde bellekten", [calisma, c.durum], [1, "taze"]);
  const d = await onbellekli("k1", uret, tamam, 0);
  esit("ön ısıtma eşiği (0 ms) → yeniden hesap", [calisma, d.durum], [2, "yok"]);
  const e = await onbellekli("k2", uret, tamam);
  esit("başka kullanıcı anahtarı ayrı", [calisma, e.durum], [3, "yok"]);

  let hataSayisi = 0;
  const hatali = async () => {
    hataSayisi++;
    return { ok: false };
  };
  await onbellekli("k3", hatali, tamam);
  await onbellekli("k3", hatali, tamam);
  esit("hata saklanmaz", hataSayisi, 2);

  let atilan = 0;
  const atan = async () => {
    atilan++;
    throw new Error("uç düştü");
  };
  for (let i = 0; i < 2; i++) await onbellekli("k4", atan, tamam).catch(() => {});
  esit("istisna saklanmaz, uçuş temizlenir", atilan, 2);

  let kimliksiz = 0;
  const say = async () => ({ ok: true, n: ++kimliksiz });
  await onbellekli(null, say, tamam);
  await onbellekli(null, say, tamam);
  esit("kimliksiz çağrı önbelleğe girmez", kimliksiz, 2);
}

// ── Faz 2a sınırları ────────────────────────────────────────────────────────
{
  const SIR = "a".repeat(64);
  const AN = Date.parse("2026-10-03T10:00:00Z");
  const j = { k: "kayit-1", w: "isci-1", b: AN, s: 600 };
  const jeton = jetonImzala(j, SIR);
  esit("jeton: imzala → çöz aynı", jetonCoz(jeton, SIR), j);
  const [govde, imza] = jeton.split(".");
  const kurcali = Buffer.from(JSON.stringify({ ...j, s: 6000 })).toString("base64url");
  esit("jeton: gövde kurcalanırsa reddedilir", jetonCoz(kurcali + "." + imza, SIR), null);
  esit("jeton: başka sırla reddedilir", jetonCoz(jeton, "b".repeat(64)), null);
  esit("jeton: bozuk biçim", [jetonCoz("x", SIR), jetonCoz(govde + "." + imza + ".fazla", SIR), jetonCoz(42, SIR)], [null, null, null]);
  esit("jeton: başka kullanıcı", jetonDurumu(j, "isci-2", AN), "baska_kullanici");
  esit("jeton: süre içinde", jetonDurumu(j, "isci-1", AN + 599_000), "gecerli");
  esit("jeton: 30 sn tolerans", jetonDurumu(j, "isci-1", AN + 625_000), "gecerli");
  esit("jeton: tolerans sonrası doldu", jetonDurumu(j, "isci-1", AN + 631_000), "suresi_doldu");

  esit("saniye: geçen süre", nabizSaniyesi(j, AN + 120_400, 0), 120);
  esit("saniye: sınırla kırpılır", nabizSaniyesi(j, AN + 900_000, 0), 600);
  esit("saniye: geri gitmez", nabizSaniyesi(j, AN + 60_000, 200), 200);

  const iso = (ms) => new Date(ms).toISOString();
  esit("etkin: kapalı oturum → yazılan", etkinSaniye({ basladi_at: iso(AN - 900_000), son_nabiz_at: iso(AN - 700_000), bitti_at: iso(AN - 700_000), saniye: 190 }, AN), 190);
  esit("etkin: canlı oturum → geçen süre", etkinSaniye({ basladi_at: iso(AN - 300_000), son_nabiz_at: iso(AN - 10_000), bitti_at: null, saniye: 285 }, AN), 300);
  esit("etkin: ölü, atış almış → yazılan", etkinSaniye({ basladi_at: iso(AN - 3_600_000), son_nabiz_at: iso(AN - 3_400_000), bitti_at: null, saniye: 200 }, AN), 200);
  esit("etkin: ölü, hiç atış yok → tam sınır (temkinli)", etkinSaniye({ basladi_at: iso(AN - 3_600_000), son_nabiz_at: null, bitti_at: null, saniye: 0 }, AN), 600);

  const temel = { gunSn: 0, aySn: 0, kiraciAyUsd: 0, butceUsd: 25, acikOturumVar: false };
  esit("sınır: boş → 10 dk", sinirKarari(temel), { izin: true, kalanSn: 600 });
  esit("sınır: gün kalanı 10 dk'dan az → kalan gün", sinirKarari({ ...temel, gunSn: 1000 }), { izin: true, kalanSn: 200 });
  esit("sınır: ay kalanı belirleyici", sinirKarari({ ...temel, aySn: 3500 }), { izin: true, kalanSn: 100 });
  esit("sınır: gün doldu (30 sn altı)", sinirKarari({ ...temel, gunSn: 1180 }), { izin: false, engel: "gun_siniri" });
  esit("sınır: ay doldu", sinirKarari({ ...temel, aySn: 3600 }), { izin: false, engel: "ay_siniri" });
  esit("sınır: bütçe doldu", sinirKarari({ ...temel, kiraciAyUsd: 25 }), { izin: false, engel: "butce" });
  esit("sınır: açık oturum önce", sinirKarari({ ...temel, acikOturumVar: true, kiraciAyUsd: 99 }), { izin: false, engel: "oturum_acik" });

  esit("maliyet: Live 0,05 $/dk", maliyetTabani("live", "gpt-live-1", 600), 0.5);
  esit("maliyet: Realtime 2.1 tabanı", Math.round(maliyetTabani("realtime", "gpt-realtime-2.1", 600) * 1000) / 1000, 0.54);
  esit("maliyet: mini tabanı", Math.round(maliyetTabani("realtime", "gpt-realtime-2.1-mini", 600) * 1000) / 1000, 0.15);
  esit("maliyet: istemci düşük bildirirse taban", kayitMaliyeti(0.5, 0.01), 0.5);
  esit("maliyet: istemci yüksekse istemci", kayitMaliyeti(0.5, 0.8), 0.8);
  esit("maliyet: istemci 5 $ ile kırpılır", kayitMaliyeti(0.1, 999), 5);
  esit("maliyet: geçersiz istemci değeri → taban", kayitMaliyeti(0.2, "abc"), 0.2);
}

if (dusen > 0) {
  console.log(`\n✗ SESLİ ASİSTAN ÖZET/ÖNBELLEK — ${dusen} denetim düştü (${gecen} geçti).\n`);
  process.exit(1);
}
console.log(`✓ sesli asistan özet + önbellek + sınır: ${gecen} denetim geçti.`);
