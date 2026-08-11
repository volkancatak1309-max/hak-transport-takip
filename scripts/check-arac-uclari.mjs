#!/usr/bin/env node
/**
 * ARAÇ UÇLARI MUHAFIZI (U1-U5) — AĞ YOK, uygulamanın GERÇEK kodunu çalıştırır.
 *
 * NE ÇÖZÜYOR: bu beş ucun verdiği sözler tip sisteminden GÖRÜNMEZ. `motorDk`
 * tipi `number | null`dır; birisi `?? 0` yazdığı gün tsc susar, build geçer,
 * ekran "0 dk rölanti" yazar ve bu, "rölantiyi ölçemedik" ile aynı pikseldir.
 * Aynısı gün listesindeki boş günler, iz üzerindeki hız/kontak alanları ve
 * OLMAYAN hız limiti için de geçerli. Bu betik o sözleri sınar.
 *
 * NEDEN AĞ YOK: sözler SAF fonksiyonlarda yaşıyor (lib/vehicle-day.ts) ve
 * girdileri elde. Canlı veriye ihtiyaç duymadan kırılabilirler — bu yüzden
 * `npm run verify` zincirine giren ucuz bir denetim olabiliyorlar.
 * Canlıdaki karşılığı ayrı betiktir: `scripts/verify-arac-uclari.mjs`.
 *
 * ── GİRDİ UYDURMA DEĞİL ────────────────────────────────────────────────────
 * `IZ` ve `OLAYLAR` 10.08.2026'da canlı HAK61'den okundu (bir aracın
 * 07.08.2026 sabahı, 04:41-04:57). Plaka ve gerçek konum REPOYA YAZILMADI:
 * koordinatlar ilk noktaya göre farkları korunarak nötr bir başlangıca
 * (47.5000, 9.7000) taşındı — mesafe/hız/kontak ilişkileri birebir aynı,
 * aracın nerede olduğu bilgisi taşınmıyor.
 *
 * SENTETİK olan tek yer aşağıda `// SENTETİK:` ile işaretlidir ve sebebi
 * yazılıdır (canlı veride o durum HİÇ oluşmuyor → ölçülemezdi).
 *
 * Çalıştır:  npm run lint:arac-uclari
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  gecerliGun,
  gunDuraklari,
  gunMetrikleri,
  gunOlaylari,
  gunPenceresi,
  izGunleri,
  seyrelt,
  sonGunler,
  GUN_PENCERE_MAX,
} from "@/lib/vehicle-day";

const ROOT = process.cwd();
let gecen = 0;
const dusen = [];

function kontrol(baslik, kosul, kanit) {
  if (kosul) {
    gecen++;
    return;
  }
  dusen.push({ baslik, kanit });
}
const esit = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── ÖLÇÜLEN GİRDİ ──────────────────────────────────────────────────────────
// Canlı HAK61, 07.08.2026 04:41:34 → 04:45:02, 30 telemetri noktası.
// Koordinatlar nötr başlangıca taşındı (yukarıdaki gizlilik notu).
const IZ = [
  {vehicle_id: "olculen-arac",latitude: 47.5,longitude: 9.7,speed_kmh: 0,heading: 0,ignition_on: true,recorded_at: "2026-08-07T04:41:34+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.499727,longitude: 9.699857,speed_kmh: 9,heading: 131,ignition_on: true,recorded_at: "2026-08-07T04:41:52+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.499615,longitude: 9.700105,speed_kmh: 17,heading: 121,ignition_on: true,recorded_at: "2026-08-07T04:41:56+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.499565,longitude: 9.70032,speed_kmh: 20,heading: 111,ignition_on: true,recorded_at: "2026-08-07T04:41:59+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.499585,longitude: 9.700509,speed_kmh: 0,heading: 0,ignition_on: false,recorded_at: "2026-08-07T04:42:58+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.490267,longitude: 9.711927,speed_kmh: 56,heading: 136,ignition_on: false,recorded_at: "2026-08-07T04:43:44+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.489853,longitude: 9.711675,speed_kmh: 71,heading: 170,ignition_on: false,recorded_at: "2026-08-07T04:43:46+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.489705,longitude: 9.711329,speed_kmh: 68,heading: 208,ignition_on: false,recorded_at: "2026-08-07T04:43:47+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.489397,longitude: 9.71099,speed_kmh: 67,heading: 220,ignition_on: false,recorded_at: "2026-08-07T04:43:49+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.489055,longitude: 9.710375,speed_kmh: 66,heading: 232,ignition_on: true,recorded_at: "2026-08-07T04:43:51+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.48854,longitude: 9.709757,speed_kmh: 59,heading: 217,ignition_on: true,recorded_at: "2026-08-07T04:43:56+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.488173,longitude: 9.709537,speed_kmh: 49,heading: 200,ignition_on: true,recorded_at: "2026-08-07T04:43:59+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.487937,longitude: 9.709494,speed_kmh: 46,heading: 188,ignition_on: false,recorded_at: "2026-08-07T04:44:00+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.487807,longitude: 9.709562,speed_kmh: 44,heading: 178,ignition_on: false,recorded_at: "2026-08-07T04:44:02+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.487675,longitude: 9.70968,speed_kmh: 44,heading: 165,ignition_on: false,recorded_at: "2026-08-07T04:44:03+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.487225,longitude: 9.710039,speed_kmh: 58,heading: 163,ignition_on: false,recorded_at: "2026-08-07T04:44:06+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.486888,longitude: 9.710132,speed_kmh: 64,heading: 175,ignition_on: false,recorded_at: "2026-08-07T04:44:08+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.486535,longitude: 9.71006,speed_kmh: 69,heading: 189,ignition_on: false,recorded_at: "2026-08-07T04:44:10+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.485625,longitude: 9.709687,speed_kmh: 76,heading: 198,ignition_on: false,recorded_at: "2026-08-07T04:44:15+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.484713,longitude: 9.709212,speed_kmh: 77,heading: 198,ignition_on: false,recorded_at: "2026-08-07T04:44:20+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.483773,longitude: 9.708765,speed_kmh: 79,heading: 196,ignition_on: false,recorded_at: "2026-08-07T04:44:25+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.482735,longitude: 9.708389,speed_kmh: 90,heading: 191,ignition_on: false,recorded_at: "2026-08-07T04:44:30+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.481825,longitude: 9.708129,speed_kmh: 93,heading: 190,ignition_on: false,recorded_at: "2026-08-07T04:44:34+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.480862,longitude: 9.707899,speed_kmh: 100,heading: 188,ignition_on: false,recorded_at: "2026-08-07T04:44:38+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.479827,longitude: 9.70773,speed_kmh: 105,heading: 185,ignition_on: false,recorded_at: "2026-08-07T04:44:42+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.478733,longitude: 9.707602,speed_kmh: 111,heading: 184,ignition_on: false,recorded_at: "2026-08-07T04:44:46+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.477612,longitude: 9.707452,speed_kmh: 112,heading: 185,ignition_on: false,recorded_at: "2026-08-07T04:44:50+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.476468,longitude: 9.707304,speed_kmh: 114,heading: 184,ignition_on: false,recorded_at: "2026-08-07T04:44:54+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.475312,longitude: 9.707129,speed_kmh: 116,heading: 186,ignition_on: false,recorded_at: "2026-08-07T04:44:58+00:00"},
  {vehicle_id: "olculen-arac",latitude: 47.474137,longitude: 9.706889,speed_kmh: 118,heading: 188,ignition_on: false,recorded_at: "2026-08-07T04:45:02+00:00"},
];

// Aynı aracın aynı sabahı — 8 nokta olayı (biri overspeeding).
const OLAYLAR = [
  {id:"972982c4-edbf-41c5-9235-6d975a8eab33",event_type:"harsh_acceleration",event_value:null,latitude:47.456125,longitude:9.688742,speed_kmh:124,occurred_at:"2026-08-07T04:46:12+00:00"},
  {id:"88203f4e-426d-424b-b85c-1ede8e1f55e8",event_type:"harsh_acceleration",event_value:null,latitude:47.431448,longitude:9.686909,speed_kmh:124,occurred_at:"2026-08-07T04:47:34+00:00"},
  {id:"0a43deb9-a6db-423f-bb4d-6f1ee21c7dc2",event_type:"overspeeding",event_value:{speed:137},latitude:47.390583,longitude:9.647434,speed_kmh:137,occurred_at:"2026-08-07T04:50:08.01+00:00"},
  {id:"be998d36-2596-496e-8e63-22be7b4635eb",event_type:"harsh_acceleration",event_value:null,latitude:47.390583,longitude:9.647434,speed_kmh:137,occurred_at:"2026-08-07T04:50:08.02+00:00"},
  {id:"61b16890-de6b-40fe-a148-6f621e0bf855",event_type:"harsh_acceleration",event_value:null,latitude:47.34303,longitude:9.600854,speed_kmh:73,occurred_at:"2026-08-07T04:53:50+00:00"},
  {id:"d798e85b-5970-45c9-98ca-5f6bd7d2f578",event_type:"harsh_acceleration",event_value:null,latitude:47.31587,longitude:9.589072,speed_kmh:114,occurred_at:"2026-08-07T04:56:00+00:00"},
  {id:"0fb00139-d0ac-4254-a411-da00b5469429",event_type:"harsh_acceleration",event_value:null,latitude:47.309887,longitude:9.587705,speed_kmh:51,occurred_at:"2026-08-07T04:57:00+00:00"},
  {id:"270e770e-d256-420c-9ea1-57ff29641e5f",event_type:"harsh_braking",event_value:null,latitude:47.305387,longitude:9.587979,speed_kmh:18,occurred_at:"2026-08-07T04:57:35.02+00:00"},
];

// Canlı `idle_episodes` satırı (10.08.2026), konumu nötrlenmiş.
const EPIZOD = {
  id: "3c4060ab-1cb6-4524-81a8-d4dd32c28832",
  started_at: "2026-08-07T04:52:00+00:00",
  ended_at: "2026-08-07T04:53:00+00:00",
  last_seen_at: "2026-08-07T04:52:00+00:00",
  latitude: 47.4,
  longitude: 9.6,
};

// ══ 1 · GÜN AYRIŞTIRMA (U1-U5 ortak kapısı) ════════════════════════════════
for (const iyi of ["2026-08-10", "2026-01-01", "2026-12-31", "2024-02-29"]) {
  kontrol(`gecerliGun kabul: ${iyi}`, gecerliGun(iyi) === true);
}
for (const kotu of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-8-1", "10.08.2026", "", null, undefined, "2026-08-10T00:00:00Z"]) {
  kontrol(`gecerliGun RED: ${String(kotu)}`, gecerliGun(kotu) === false);
}

// ══ 2 · GÜN SINIRI DST-GÜVENLİ Mİ ══════════════════════════════════════════
// Bu üçü kırılırsa BÜTÜN gün eksenli uçlar (U1-U5) yanlış pencere okur.
const saat = (g) => {
  const p = gunPenceresi(g);
  return (new Date(p.bitis).getTime() - new Date(p.baslangic).getTime() + 1) / 3_600_000;
};
kontrol("normal gün 24 saat", saat("2026-08-10") === 24, `${saat("2026-08-10")} sa`);
kontrol("ilkbahar DST günü 23 saat", saat("2026-03-29") === 23, `${saat("2026-03-29")} sa`);
kontrol("sonbahar DST günü 25 saat", saat("2026-10-25") === 25, `${saat("2026-10-25")} sa`);
kontrol(
  "pencere sonu bir sonraki günün başına DEĞMİYOR",
  new Date(gunPenceresi("2026-08-10").bitis).getTime() + 1 ===
    new Date(gunPenceresi("2026-08-11").baslangic).getTime()
);
kontrol("geçersiz günde pencere null", gunPenceresi("2026-02-31") === null);

// ══ 3 · SON GÜNLER ═════════════════════════════════════════════════════════
const g14 = sonGunler(GUN_PENCERE_MAX, new Date("2026-08-10T23:50:00Z"));
kontrol("sonGunler 14 gün üretir", g14.length === 14);
kontrol("sonGunler yeniden eskiye", g14.every((g, i) => i === 0 || g14[i - 1] > g));
kontrol("sonGunler tekrarsız", new Set(g14).size === 14);
kontrol("gece yarısından sonra KİRACI günü kullanılır", g14[0] === "2026-08-11", g14[0]);
// DST günü atlanmıyor: 29.03 takvim günü listede yerini alır.
const gDst = sonGunler(3, new Date("2026-03-30T10:00:00Z"));
kontrol("DST günü takvimden düşmüyor", esit(gDst, ["2026-03-30", "2026-03-29", "2026-03-28"]), gDst.join(","));

// ══ 4 · U1 · VERİ OLAN GÜN LİSTESİ ═════════════════════════════════════════
const gunlerOlculen = izGunleri(IZ);
kontrol("izGunleri tek gün buldu", gunlerOlculen.length === 1 && gunlerOlculen[0].tarih === "2026-08-07");
kontrol("nokta sayısı doğru", gunlerOlculen[0].nokta === 30, String(gunlerOlculen[0].nokta));
kontrol("ilk/son doğru", gunlerOlculen[0].ilk === IZ[0].recorded_at && gunlerOlculen[0].son === IZ[29].recorded_at);
kontrol("boş izde gün yok", izGunleri([]).length === 0);
// SENTETİK: iki ayrı gün + sıralama. Tek günlük ölçülen dilim bunu gösteremez.
const ikiGun = izGunleri([
  { recorded_at: "2026-08-07T10:00:00+00:00" },
  { recorded_at: "2026-08-09T10:00:00+00:00" },
  { recorded_at: "2026-08-09T12:00:00+00:00" },
]);
kontrol("çok günde yeniden eskiye sıralı", esit(ikiGun.map((g) => g.tarih), ["2026-08-09", "2026-08-07"]));
kontrol("gün başına sayım ayrı", esit(ikiGun.map((g) => g.nokta), [2, 1]));
// Gün sınırında: Viyana 00:30 → BİR ÖNCEKİ UTC gününe ait, ama kiracı günü yeni.
const sinir = izGunleri([{ recorded_at: "2026-08-09T22:30:00+00:00" }]);
kontrol("gün anahtarı kiracı diliminde", sinir[0].tarih === "2026-08-10", sinir[0].tarih);

// ══ 5 · U2 · SEYRELTME ═════════════════════════════════════════════════════
kontrol("tavan altında dokunmaz", esit(seyrelt([1, 2, 3], 900), [1, 2, 3]));
kontrol("boş dizi boş kalır", esit(seyrelt([], 900), []));
const buyuk = Array.from({ length: 3055 }, (_, i) => i); // canlı ölçüm: 3055 nokta
const cizilen = seyrelt(buyuk, 900);
kontrol("900'e iniyor", cizilen.length === 900, String(cizilen.length));
kontrol("İLK nokta korunur", cizilen[0] === 0);
kontrol("SON nokta korunur", cizilen[899] === 3054);
kontrol("sıra bozulmuyor", cizilen.every((v, i) => i === 0 || cizilen[i - 1] < v));
kontrol("tam tavanda kopyalanır", seyrelt(buyuk, 3055).length === 3055);

// ══ 6 · U3 · OLAYLAR ═══════════════════════════════════════════════════════
const kalemler = gunOlaylari(OLAYLAR, [EPIZOD], 300);
kontrol("olay + epizod tek listede", kalemler.length === 9, String(kalemler.length));
kontrol(
  "saate göre sıralı",
  kalemler.every((k, i) => i === 0 || new Date(kalemler[i - 1].an) <= new Date(k.an))
);
const epKalem = kalemler.find((k) => k.tur === "idling");
kontrol("epizod araya doğru yerde girdi", kalemler.indexOf(epKalem) === 4, String(kalemler.indexOf(epKalem)));
kontrol("rölanti süresi = span + IDLE_TRIGGER_S", epKalem.sureMs === 60_000 + 300_000, String(epKalem.sureMs));
kontrol("kapanmamış epizod devamEdiyor", gunOlaylari([], [{ ...EPIZOD, ended_at: null }], 300)[0].devamEdiyor === true);
const os = kalemler.find((k) => k.tur === "overspeeding");
kontrol("overspeeding KRİTİK kademede", os.kademe === "kritik", os.kademe);
kontrol("aşırı hızda ARACIN hızı taşınıyor", os.hizKmh === 137, String(os.hizKmh));
kontrol("event_value ham geçiyor", esit(os.deger, { speed: 137 }));
kontrol("harsh_braking uyarı kademesinde", kalemler.find((k) => k.tur === "harsh_braking").kademe === "uyari");
// ⚠️ HIZ LİMİTİ: veride YOK. Uydurulmadığının muhafızı.
const limitAlanlari = ["hizLimiti", "limitKmh", "speedLimit", "limit"];
kontrol(
  "HİÇBİR kalemde hız limiti alanı YOK",
  kalemler.every((k) => limitAlanlari.every((a) => !(a in k))),
  limitAlanlari.join("/")
);
kontrol("konumsuz olay null konum verir", gunOlaylari([{ ...OLAYLAR[0], latitude: null }], [], 300)[0].konum === null);
// Aynı ana düşen iki olay: sıralama deterministik olmalı (id ile).
const esAnli = gunOlaylari(
  [
    { ...OLAYLAR[0], id: "bbb", occurred_at: "2026-08-07T05:00:00+00:00" },
    { ...OLAYLAR[1], id: "aaa", occurred_at: "2026-08-07T05:00:00+00:00" },
  ],
  [],
  300
);
kontrol("eş anlı olaylar deterministik sıralanır", esit(esAnli.map((k) => k.id), ["aaa", "bbb"]));

// ══ 7 · U4 · DURAKLAR ══════════════════════════════════════════════════════
const dur = gunDuraklari(IZ);
kontrol("ölçülen dilimde 1 sefer", dur.seferler.length === 1, String(dur.seferler.length));
kontrol("ölçülen dilimde durak YOK", dur.duraklar.length === 0, "başlangıçtaki duruş 3 dk'dan kısa");
kontrol("toplam sefer km ölçüldü", dur.toplamSeferKm === 3.33, String(dur.toplamSeferKm));
kontrol("eşikler yanıtta", dur.esikler.enAzDurusMs === 180_000 && dur.esikler.hareketHizKmh === 3);
kontrol("boş izde toplam km NULL", gunDuraklari([]).toplamSeferKm === null);
kontrol("tek noktalı izde toplam km NULL", gunDuraklari([IZ[0]]).toplamSeferKm === null);
// SENTETİK: 6 dakikalık gerçek bir duruş. Ölçülen 3,5 dakikalık dilimde
// nitelikli durak yok — eşiğin ÜSTÜ ancak böyle sınanabilir.
const durakli = [
  ...Array.from({ length: 13 }, (_, i) => ({
    vehicle_id: "x", latitude: 47.5, longitude: 9.7, speed_kmh: 0, heading: 0, ignition_on: true,
    recorded_at: new Date(Date.UTC(2026, 7, 7, 6, 0, i * 30)).toISOString(), // 30 sn arayla 6 dk
  })),
  { vehicle_id: "x", latitude: 47.51, longitude: 9.71, speed_kmh: 60, heading: 0, ignition_on: true,
    recorded_at: new Date(Date.UTC(2026, 7, 7, 6, 7, 0)).toISOString() },
];
const d2 = gunDuraklari(durakli);
kontrol("6 dakikalık duruş DURAK sayılır", d2.duraklar.length === 1, String(d2.duraklar.length));
kontrol("durak süresi 6 dakika", d2.duraklar[0].sureMs === 360_000, String(d2.duraklar[0].sureMs));
// Merkez ORTALAMADIR: 13 kez 9.7 toplanıp bölününce 9.700000000000001 çıkar.
// Kayan nokta toleransı bilinçli — eşitlik sınamak muhafızı yalancı yapardı.
kontrol(
  "durak merkezi taşınıyor",
  Math.abs(d2.duraklar[0].lat - 47.5) < 1e-9 && Math.abs(d2.duraklar[0].lng - 9.7) < 1e-9,
  `${d2.duraklar[0].lat},${d2.duraklar[0].lng}`
);
// SENTETİK: 2 dakikalık duruş (trafik ışığı) — durak SAYILMAMALI.
const isikli = Array.from({ length: 5 }, (_, i) => ({
  vehicle_id: "x", latitude: 47.5, longitude: 9.7, speed_kmh: 0, heading: 0, ignition_on: true,
  recorded_at: new Date(Date.UTC(2026, 7, 7, 6, 0, i * 30)).toISOString(), // 30 sn arayla 2 dk
}));
kontrol("2 dakikalık duruş durak DEĞİL", gunDuraklari(isikli).duraklar.length === 0);

// ══ 8 · U5 · METRİKLER — "hesaplanamayan sıfır değildir" ═══════════════════
const met = gunMetrikleri(IZ);
kontrol("ölçülen dilimde gpsKm", met.gpsKm === 3.33, String(met.gpsKm));
kontrol("ölçülen dilimde motorDk", met.motorDk === 2, String(met.motorDk));
kontrol("üç sebep de 'var'", esit(met.sebep, { motor: "var", gps: "var", rolanti: "var" }));
kontrol("nokta sayısı taşınıyor", met.noktaSayisi === 30);

const bos = gunMetrikleri([]);
kontrol("VERİ YOK → motorDk null", bos.motorDk === null);
kontrol("VERİ YOK → gpsKm null (0 DEĞİL)", bos.gpsKm === null);
kontrol("VERİ YOK → rolantiDk null", bos.rolantiDk === null);
kontrol("VERİ YOK → sebep veri_yok", esit(bos.sebep, { motor: "veri_yok", gps: "veri_yok", rolanti: "veri_yok" }));
const tek = gunMetrikleri([IZ[0]]);
kontrol("TEK NOKTA → hepsi null", tek.motorDk === null && tek.gpsKm === null && tek.rolantiDk === null);

// SENTETİK: kontak/hız kolonu null. CANLIDA ÖLÇÜLEMEZ — 10.08.2026 sayımı:
// son 7 günün 287.789 satırında `ignition_on` null 0, `speed_kmh` null 0.
// Kolon bir gün boşalırsa (yeni cihaz, yeni kurulum) bu kapı tutmalı.
const kontaksiz = IZ.map((r) => ({ ...r, ignition_on: null }));
const mk = gunMetrikleri(kontaksiz);
kontrol("KONTAK YOK → motorDk null", mk.motorDk === null);
kontrol("KONTAK YOK → rolantiDk null", mk.rolantiDk === null);
kontrol("KONTAK YOK → gpsKm YİNE ölçülür", mk.gpsKm === 3.33, String(mk.gpsKm));
kontrol("KONTAK YOK → sebep kontak_yok", mk.sebep.motor === "kontak_yok" && mk.sebep.rolanti === "kontak_yok");
const hizsiz = IZ.map((r) => ({ ...r, speed_kmh: null }));
const mh = gunMetrikleri(hizsiz);
kontrol("HIZ YOK → rolantiDk null", mh.rolantiDk === null);
kontrol("HIZ YOK → sebep hiz_yok", mh.sebep.rolanti === "hiz_yok");
kontrol("HIZ YOK → motor ÖLÇÜLÜR (kontağa bakar)", mh.motorDk !== null);

// SENTETİK: park hâlinde araç — kontak KAPALI, hiç hareket yok.
// Burada sıfır GERÇEK sıfırdır; null'a düşürmek de aynı derecede yanlış olurdu.
const park = Array.from({ length: 10 }, (_, i) => ({
  vehicle_id: "x", latitude: 47.5, longitude: 9.7, speed_kmh: 0, heading: 0, ignition_on: false,
  recorded_at: new Date(Date.UTC(2026, 7, 7, 3, i)).toISOString(),
}));
const mp = gunMetrikleri(park);
kontrol("PARK → motorDk GERÇEK 0 (null değil)", mp.motorDk === 0, String(mp.motorDk));
kontrol("PARK → gpsKm GERÇEK 0", mp.gpsKm === 0, String(mp.gpsKm));
kontrol("PARK → rolantiDk GERÇEK 0", mp.rolantiDk === 0, String(mp.rolantiDk));
kontrol("PARK → sebep hepsi 'var'", esit(mp.sebep, { motor: "var", gps: "var", rolanti: "var" }));

// ══ 9 · KAYNAK DENETİMİ — sözler dosyalarda duruyor mu ═════════════════════
const oku = (p) => readFileSync(path.join(ROOT, p), "utf8");
const UCLAR = [
  "app/api/mobile/vehicles/[id]/gunler/route.ts",
  "app/api/mobile/vehicles/[id]/rota/route.ts",
  "app/api/mobile/vehicles/[id]/olaylar/route.ts",
  "app/api/mobile/vehicles/[id]/duraklar/route.ts",
  "app/api/mobile/vehicles/[id]/metrikler/route.ts",
];
for (const u of UCLAR) {
  const src = oku(u);
  // Kapı: kardeş uç /vehicles/[id] ile AYNI katman. Gevşetilirse filo şefi
  // panelde giremediği veriyi mobilden görür.
  kontrol(`${path.basename(path.dirname(u))}: requireMobileAdmin kapısı`, src.includes("requireMobileAdmin("));
  // Saat dilimi kiracıdan gelir; dosyaya "Europe/…" yazılırsa ikinci kaynak doğar.
  kontrol(`${path.basename(path.dirname(u))}: saat dilimi sabitlenmemiş`, !/["'`]Europe\//.test(src));
  // Olmayan alanı üretme yasağı.
  kontrol(
    `${path.basename(path.dirname(u))}: hız limiti alanı üretilmemiş`,
    !/\b(hizLimiti|limitKmh|speedLimit|speed_limit)\b\s*:/.test(src)
  );
}
// U2'nin dayandığı düzeltme: iz üzerinden hız ve kontak ARTIK atılmıyor.
const rh = oku("lib/route-history.ts");
kontrol("RoutePoint speed alanı taşıyor", /speed\?:\s*number/.test(rh));
kontrol("RoutePoint ignition alanı taşıyor", /ignition\?:\s*boolean/.test(rh));
kontrol("cihaz rotası speed_kmh'yi map'liyor", /speed:\s*r\.speed_kmh/.test(rh));
kontrol("cihaz rotası ignition_on'u map'liyor", /ignition:\s*r\.ignition_on/.test(rh));
// 11.08.2026: gün ±1 gün UTC parantezinde değil KESİN kiracı penceresinde
// okunuyor. Parantez geri gelirse aynı sonuç için 2,7× fazla satır okunur
// (canlı ölçüm: 10.954 ↔ 4.113 satır, 2.180 ms ↔ 686 ms).
kontrol("rota kesin kiracı-gün penceresi kullanıyor", /gunPenceresi\(date\)/.test(rh));
kontrol("±1 gün parantezi geri gelmemiş", !/setUTCDate\(/.test(rh));
// Saf katman gerçekten saf mı — muhafızın çalışabilmesinin ön koşulu.
const vd = oku("lib/vehicle-day.ts");
// İMPORT satırına bak, metne değil: dosyanın kendi yorumları "supabaseAdmin"
// kelimesini geçiriyor ve düz `includes` bunu sızıntı sanmıştı.
kontrol("lib/vehicle-day.ts server-only DEĞİL", !/^\s*import\s+["']server-only["']/m.test(vd));
kontrol("lib/vehicle-day.ts supabase içe aktarmıyor", !/^\s*import\s.*@\/lib\/supabase["']/m.test(vd));
kontrol(
  "lib/vehicle-day.ts telemetry'yi YALNIZ tip olarak alır",
  !/^\s*import\s+(?!type\b)[^;]*@\/lib\/telemetry["']/m.test(vd)
);

// ── Sonuç ──────────────────────────────────────────────────────────────────
if (dusen.length === 0) {
  console.log(`✓ araç uçları muhafızı: ${gecen} denetim geçti (U1-U5 + kaynak).`);
  process.exit(0);
}
console.error(`\n✗ ARAÇ UÇLARI MUHAFIZI — ${dusen.length}/${gecen + dusen.length} denetim düştü:\n`);
for (const d of dusen) console.error(`  · ${d.baslik}${d.kanit ? `   [${d.kanit}]` : ""}`);
console.error(`
  Bu denetimler uçların SÖZLERİDİR:
    · ölçülemeyen sayı null döner, sıfır yazılmaz
    · veri olmayan gün listeye girmez, ölçülemeyen gün de gizlenmez
    · izde hız ve kontak taşınır (lib/route-history.ts)
    · hız limiti diye bir alan ÜRETİLMEZ — veride yok
    · gün sınırı kiracı saat diliminde, DST-güvenli
    · beş ucun kapısı requireMobileAdmin
`);
process.exit(1);
