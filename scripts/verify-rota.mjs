#!/usr/bin/env node
/**
 * ROTA OPTİMİZASYONU — DOĞRULAMA (Faz 1).
 *
 * ⚠️ HİÇBİR GERÇEK VERİTABANINA DOKUNMAZ: `ts-server-kuru.mjs` ile koşar —
 * `@/lib/supabase` bir kayıt cihazına (scripts/supabase-mock.mjs) dönüşür,
 * env sahte değerlerle doldurulur. Betik ilk satırda şimin devrede olduğunu
 * doğrular, değilse DURUR.
 *
 *   A  saf hesap: polyline, saat, zaman çizelgesi, parmak izi, tam sıra
 *   B  çekirdek + sahte sağlayıcı: sıralama, pencere, kapanmış durak,
 *      yerleştirilemeyen durak, tutarsız cevap, harita kapsamı, istek sayısı
 *   C  VROOM + OSRM sağlayıcısı — yerel SAHTE motor sunucusuna karşı
 *   D  Google sağlayıcısı — istek kurucu, cevap okuyucu, parçalama, JWT, jeton
 *   E  sağlayıcı fabrikası — env kuralları (https + sır, sahte üretimde yok)
 *   F  sunucu eylemleri — kapı, kapsam, kota, hata hâlleri, Uygula, kayıt
 *   G  rota vekili — kimlik, dar kapı, gövde sınırı, log'da koordinat yok
 *   H  (isteğe bağlı) GERÇEK motor: ROTA_CANLI_VROOM_URL + ROTA_CANLI_OSRM_URL
 *
 * Kullanım:  npm run verify:rota
 *   canlı motorla: ROTA_CANLI_VROOM_URL=http://127.0.0.1:13000 \
 *                  ROTA_CANLI_OSRM_URL=http://127.0.0.1:15000 npm run verify:rota
 *   (SSH tüneli: ssh -N -L 13000:127.0.0.1:3000 -L 15000:127.0.0.1:5000 root@<sunucu>)
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const KOK = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const KAPALI_MOD = process.argv.includes("--modul-kapali");

// Modül bayrağı lib/tenant.ts YÜKLENİRKEN okunuyor — içe aktarmadan ÖNCE.
if (!KAPALI_MOD) process.env.ROTA_OPTIMIZASYONU = "true";
else delete process.env.ROTA_OPTIMIZASYONU;
for (const k of ["ROTA_SAGLAYICI", "ROTA_VROOM_URL", "ROTA_OSRM_URL", "ROTA_SERVIS_SIRRI", "ROTA_YEDEK", "GOOGLE_ROTA_ANAHTARI", "GOOGLE_HARITA_KOSULU", "VERCEL_ENV"]) {
  delete process.env[k];
}

const { supabaseAdmin } = await import("@/lib/supabase");
if (!supabaseAdmin.__MOCK__) {
  console.error("✗ Sahte supabase devrede DEĞİL — betik DURDU (gerçek bir kuruluma yazmamak için).");
  process.exit(1);
}

let dusen = 0;
let gecen = 0;
function iddia(baslik, kosul, kanit) {
  console.log(`  ${kosul ? "✓" : "✗"} ${baslik}${kanit !== undefined ? "  —  " + kanit : ""}`);
  if (kosul) gecen++;
  else dusen++;
}
const bolum = (s) => console.log(`\n═══ ${s} ═══`);

// ── sahte veritabanı yönlendiricisi ─────────────────────────────────────────
let durum = {};
globalThis.__SENARYO__ = (c) => {
  const f = (op, kolon) => c.filters.find((x) => x[0] === op && x[1] === kolon)?.[2];
  switch (c.table) {
    case "seferler":
      return { data: durum.sefer?.id === f("eq", "id") ? durum.sefer : null, error: null };
    case "sefer_duraklari":
      return { data: (durum.duraklar ?? []).filter((d) => d.sefer_id === f("eq", "sefer_id")), error: null };
    case "geofences": {
      if (c.secim?.includes("archived_at")) {
        return { data: (durum.bolgeler ?? []).find((z) => z.id === f("eq", "id")) ?? null, error: null };
      }
      const ids = f("in", "id") ?? [];
      return { data: (durum.bolgeler ?? []).filter((z) => ids.includes(z.id)), error: null };
    }
    case "tenant_settings":
      return { data: null, error: null };
    case "login_attempts":
      if (c.op === "select") return durum.kotaOku ?? { data: null, error: null };
      if (c.op === "upsert") {
        (durum.kotaYaz ??= []).push(c.payload);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    case "audit_log":
      if (c.op === "insert") (durum.kayit ??= []).push(c.payload);
      return { data: null, error: null };
    case "rpc:sefer_duraklari_sirala": {
      (durum.rpc ??= []).push(c.payload);
      const sira = c.payload.p_ids;
      durum.duraklar = durum.duraklar.map((d) => ({ ...d, sira: sira.indexOf(d.id) + 1 }));
      return { data: sira.length, error: null };
    }
    case "workers":
      // getManagedFleet tek satır ister; kapsamın NULL-filo eki liste ister.
      return { data: c.secim?.includes("managed_fleet") ? (durum.sef ?? null) : [], error: null };
    case "vehicles":
      return { data: durum.sefAraclari ?? [], error: null };
    default:
      return { data: null, error: null };
  }
};
const cagrilar = (tablo) => (globalThis.__CAGRILAR__ ?? []).filter((c) => c.table === tablo);
const sifirla = () => {
  globalThis.__CAGRILAR__ = [];
  durum = {};
};

// ── ortak veri: Vorarlberg, kasıtlı kötü sıra ─────────────────────────────
const SEFER = "5e000000-0000-4000-8000-000000000001";
const SOFOR = "50000000-0000-4000-8000-000000000001";
const YONETICI = "a0000000-0000-4000-8000-00000000000a";
const DEPO = "de000000-0000-4000-8000-000000000001";
const NOKTA = [
  ["Feldkirch", 47.2381, 9.598],
  ["Bregenz", 47.5031, 9.7471],
  ["Götzis", 47.3336, 9.6403],
  ["Hard", 47.4893, 9.6869],
  ["Rankweil", 47.2716, 9.642],
  ["Lauterach", 47.4776, 9.7314],
  ["Hohenems", 47.3666, 9.6886],
  ["Wolfurt", 47.4654, 9.7495],
];
const durakId = (i) => `d0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
function durakSatirlari(ek = {}) {
  return NOKTA.map(([ad, lat, lng], i) => ({
    id: durakId(i),
    sefer_id: SEFER,
    sira: i + 1,
    ad,
    zone_id: null,
    adres: `${ad}, Vorarlberg`,
    latitude: lat,
    longitude: lng,
    yaricap_m: 150,
    pencere_bas: null,
    pencere_bit: null,
    tahmini_sure_dk: 10,
    notlar: null,
    durum: "bekliyor",
    atlama_sebep: null,
    varildi_at: null,
    tamamlandi_at: null,
    atlandi_at: null,
    varis_kaynak: null,
    created_at: "2026-10-03T06:00:00Z",
    ...(ek[i] ?? {}),
  }));
}
const seferSatiri = (ek = {}) => ({
  id: SEFER,
  tarih: "2026-10-05",
  worker_id: SOFOR,
  vehicle_id: null,
  zone_id: null,
  paket_hedef: null,
  notlar: null,
  durum: "atandi",
  atandi_at: "2026-10-03T06:00:00Z",
  kabul_at: null,
  yolda_at: null,
  tamamlandi_at: null,
  iptal_at: null,
  vardi_at: null,
  paket_gerceklesen: null,
  created_by: YONETICI,
  created_at: "2026-10-03T06:00:00Z",
  ...ek,
});

// ══════════════════════════════════════════════════════════════════════════
if (KAPALI_MOD) {
  // Alt süreç: yalnız modül kapısı. Bayrak YOK → hiçbir sorgu atılmamalı.
  const { sealData } = await import("iron-session");
  const { sessionOptions } = await import("@/lib/session");
  process.env.QA_SESSION_COOKIE = await sealData(
    { worker_id: YONETICI, name: "QA", phone: "+430000000000", is_admin: true },
    { password: sessionOptions.password, ttl: 0 }
  );
  process.env.ROTA_SAGLAYICI = "sahte";
  const { rotaOner, rotaUygula } = await import("@/app/actions/rota");
  const { rotaYetenegi } = await import("@/lib/rota/saglayici");
  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari() };
  const r = await rotaOner(SEFER, { baslangic: "sonraki", bitis: "acik", hareket: "08:00" });
  const u = await rotaUygula(SEFER, [durakId(0)], "x");
  console.log(
    JSON.stringify({
      oner: r.ok ? "ok" : r.hata,
      uygula: u.ok ? "ok" : u.hata,
      yetenek: rotaYetenegi(),
      sorgu: (globalThis.__CAGRILAR__ ?? []).length,
    })
  );
  process.exit(0);
}

const { polylineCoz, polylineKodla, polylineBirlestir } = await import("@/lib/rota/polyline");
const plan = await import("@/lib/rota/plan");
const { SahteSaglayici } = await import("@/lib/rota/sahte");
const { SaglayiciHatasi } = await import("@/lib/rota/tipler");

// ══════════════════════════════════════════════════════════════════════════
bolum("A · SAF HESAP");
{
  const g = polylineCoz("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  iddia(
    "polyline: Google'ın belgelediği örnek çözülüyor",
    JSON.stringify(g) === JSON.stringify([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]),
    JSON.stringify(g)
  );
  const pts = [[47.2381, 9.598], [47.5031, 9.7471], [47.3336, 9.6403]];
  iddia("polyline: kodla → çöz gidiş-dönüş", JSON.stringify(polylineCoz(polylineKodla(pts))) === JSON.stringify(pts));
  const birlesik = polylineCoz(polylineBirlestir([polylineKodla(pts.slice(0, 2)), polylineKodla(pts.slice(1))]));
  iddia("polyline: parçalar birleşimde ikilenmiyor", birlesik.length === 3, `${birlesik.length} nokta`);

  iddia("saatSn: 09:30 → 34200", plan.saatSn("09:30") === 34200);
  iddia("saatSn: 09:30:15 → 34215 (DB time biçimi)", plan.saatSn("09:30:15") === 34215);
  iddia("saatSn: geçersiz → null", plan.saatSn("25:00") === null && plan.saatSn("abc") === null && plan.saatSn(null) === null);
  iddia("snSaat: 34200 → 09:30", plan.snSaat(34200) === "09:30");

  // Çizelge: başlangıç durağı + 2 durak + dönüş; pencere beklemesi ve gecikme.
  const d = (id, sira, servisSn, pencere) => ({
    id, ad: id, sira, konum: { lat: 47, lng: 9 }, servisSn, pencere,
    pencereMetin: pencere ? { bas: pencere.bas !== null ? plan.snSaat(pencere.bas) : null, bit: pencere.bit !== null ? plan.snSaat(pencere.bit) : null } : null,
  });
  const anMs = (sn) => Date.UTC(2026, 9, 5) + sn * 1000;
  const p = plan.programHesapla({
    anMs,
    hareketSn: 8 * 3600,
    baslangicDuragi: d("A", 1, 600, null),
    sira: [d("B", 2, 300, { bas: 9 * 3600, bit: null }), d("C", 3, 300, { bas: null, bit: 9 * 3600 + 600 })],
    bacaklar: [
      { mesafeM: 10_000, sureSn: 900 },
      { mesafeM: 5_000, sureSn: 600 },
      { mesafeM: 12_000, sureSn: 1200 },
    ],
    bitisVar: true,
    geometri: null,
  });
  // 08:00 A varış, 08:10 çıkış; B'ye 08:25 varış → 09:00'a kadar 35 dk bekleme; 09:05 çıkış;
  // C'ye 09:15 varış, pencere 09:10'da kapandı → 5 dk geç; 09:20 çıkış; dönüş 20 dk → 09:40.
  iddia("çizelge: B'de 35 dk bekleme", p.duraklar[1].beklemeSn === 35 * 60, `${p.duraklar[1].beklemeSn / 60} dk`);
  iddia("çizelge: C 5 dk geç", p.duraklar[2].gecikmeSn === 5 * 60, `${p.duraklar[2].gecikmeSn / 60} dk`);
  iddia("çizelge: toplam 1 sa 40 dk (sürüş + servis + bekleme)", p.ozet.toplamSn === 100 * 60, `${p.ozet.toplamSn / 60} dk`);
  iddia("çizelge: 27 km, 1 geç durak", p.ozet.mesafeM === 27_000 && p.ozet.gecikenDurak === 1);
  iddia("çizelge: başlangıç durağı işaretli", p.duraklar[0].baslangicDuragi === true && p.duraklar[1].baslangicDuragi === false);
  let firladi = false;
  try {
    plan.programHesapla({ anMs, hareketSn: 0, baslangicDuragi: null, sira: [d("X", 1, 0, null)], bacaklar: [], bitisVar: false, geometri: null });
  } catch (e) {
    firladi = e instanceof SaglayiciHatasi;
  }
  iddia("çizelge: eksik bacak sayısı SESSİZ geçmiyor", firladi);

  const tumu = [
    { id: "a", sira: 1, durum: "tamamlandi" },
    { id: "b", sira: 2, durum: "bekliyor" },
    { id: "c", sira: 3, durum: "atlandi" },
    { id: "d", sira: 4, durum: "bekliyor" },
  ];
  iddia("tam sıra: kapanmış duraklar başta, şimdiki sıralarıyla", plan.tamSira(tumu, ["d", "b"]).join("") === "acdb");
  const iz1 = plan.parmakIziMetni(tumu);
  const iz2 = plan.parmakIziMetni([...tumu].reverse());
  const iz3 = plan.parmakIziMetni(tumu.map((x) => (x.id === "b" ? { ...x, pencere_bit: "12:00:00" } : x)));
  iddia("parmak izi: satır sırasından bağımsız, pencere değişince değişiyor", iz1 === iz2 && iz1 !== iz3);
}

// ══════════════════════════════════════════════════════════════════════════
bolum("B · ÇEKİRDEK + SAHTE SAĞLAYICI");
const sahte = new SahteSaglayici();
const cekDurak = (id, ad, lat, lng, sira, servisSn = 300, pencere = null) => ({
  id, ad, sira, konum: { lat, lng }, servisSn, pencere,
  pencereMetin: pencere ? { bas: pencere.bas !== null ? plan.snSaat(pencere.bas) : null, bit: pencere.bit !== null ? plan.snSaat(pencere.bit) : null } : null,
});
const anMs0 = (sn) => Date.UTC(2026, 9, 5, 22) + sn * 1000;
{
  // Bir doğru üzerinde 8 nokta, karışık sırada. Başlangıç batı ucu.
  const sirali = Array.from({ length: 8 }, (_, i) => cekDurak(`p${i}`, `P${i}`, 47.40, 9.60 + i * 0.02, i + 1));
  const karisik = [3, 7, 1, 5, 0, 6, 2, 4].map((i) => sirali[i]);
  const r = await plan.rotaCekirdegi(sahte, {
    anMs: anMs0, hareketSn: 8 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.40, lng: 9.58 }, ad: "Depo" },
    donus: false, siralanacak: karisik,
  });
  iddia("doğru üzerindeki noktalar soldan sağa sıralandı", r.ok && r.bekleyenSira.join(",") === "p0,p1,p2,p3,p4,p5,p6,p7", r.ok ? r.bekleyenSira.join(",") : r.hata);
  iddia("önerilen yol kısaldı", r.ok && r.sonra.ozet.mesafeM < r.once.ozet.mesafeM, r.ok ? `${(r.once.ozet.mesafeM / 1000).toFixed(1)} → ${(r.sonra.ozet.mesafeM / 1000).toFixed(1)} km` : "");
  iddia("sahte sağlayıcıda dış istek yok", r.ok && r.rotaIstegi === 0);

  // Başlangıç = sıradaki durak: ilk durak yerinde kalmalı.
  const r2 = await plan.rotaCekirdegi(sahte, {
    anMs: anMs0, hareketSn: 8 * 3600,
    baslangic: { tur: "durak", durak: karisik[0] },
    donus: true, siralanacak: karisik.slice(1),
  });
  iddia("başlangıç durağı sabit ve ilk sırada", r2.ok && r2.bekleyenSira[0] === karisik[0].id && r2.sonra.duraklar[0].baslangicDuragi);
  iddia("başlangıca dönüş bacağı sayıldı", r2.ok && r2.sonra.ozet.toplamSn > r2.sonra.ozet.surusSn - 1);

  // Pencere: doğu ucundaki durak 08:30'a kadar ziyaret edilmeli → ilk gidilmeli.
  const pencereli = sirali.map((d) => (d.id === "p7" ? { ...d, pencere: { bas: null, bit: 8 * 3600 + 30 * 60 }, pencereMetin: { bas: null, bit: "08:30" } } : d));
  const r3 = await plan.rotaCekirdegi(sahte, {
    anMs: anMs0, hareketSn: 8 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.40, lng: 9.58 }, ad: "Depo" },
    donus: false, siralanacak: pencereli,
  });
  iddia("pencereli durak öne alındı ve zamanında", r3.ok && r3.bekleyenSira[0] === "p7" && r3.sonra.ozet.gecikenDurak === 0, r3.ok ? `${r3.bekleyenSira[0]}, geç=${r3.sonra.ozet.gecikenDurak}` : "");

  // Sıra aynıysa ikinci yol hesabı ATILMAZ.
  let hesap = 0;
  const sayan = { ...sahte, kod: "sahte", ad: "say", haritaSerbest: true, maliyetUsd: () => 0,
    sirala: (p) => sahte.sirala(p),
    rotaHesapla: (n) => { hesap++; return sahte.rotaHesapla(n); } };
  await plan.rotaCekirdegi(sayan, {
    anMs: anMs0, hareketSn: 8 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.40, lng: 9.58 }, ad: "Depo" },
    donus: false, siralanacak: sirali,
  });
  iddia("zaten en iyi sırada: yol hesabı TEK kez", hesap === 1, `${hesap} hesap`);

  // Yerleştirilemeyen durak: ilk turda "atanamayan" → pencere gevşetilip yeniden.
  let tur = 0;
  const sert = { kod: "sahte", ad: "sert", haritaSerbest: true, maliyetUsd: () => 0,
    rotaHesapla: (n) => sahte.rotaHesapla(n),
    sirala: async (p) => {
      tur++;
      if (tur === 1) return { sira: p.duraklar.slice(1).map((d) => d.id), atanamayan: [p.duraklar[0].id] };
      iddia("ikinci turda yalnız yerleşmeyenin penceresi kaldırıldı", p.duraklar[0].pencere === null && p.duraklar[1].pencere !== null);
      return sahte.sirala(p);
    } };
  const sertDuraklar = sirali.slice(0, 4).map((d) => ({ ...d, pencere: { bas: 0, bit: 60 }, pencereMetin: { bas: "00:00", bit: "00:01" } }));
  const r4 = await plan.rotaCekirdegi(sert, {
    anMs: anMs0, hareketSn: 8 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.40, lng: 9.58 }, ad: "Depo" },
    donus: false, siralanacak: sertDuraklar,
  });
  iddia("yerleşmeyen durak DÜŞMEDİ, gevşetildi ve geç işaretlendi", r4.ok && r4.bekleyenSira.length === 4 && r4.gevsetilen.length === 1 && r4.sonra.ozet.gecikenDurak >= 1, r4.ok ? `gevşetilen=${r4.gevsetilen.length}, geç=${r4.sonra.ozet.gecikenDurak}` : "");
  iddia("maliyet için iki tur sayıldı", r4.ok && r4.siralananDurak === 8, r4.ok ? `${r4.siralananDurak}` : "");

  // Tutarsız cevap (ikilenen kimlik) → reddedilir.
  const bozuk = { ...sert, sirala: async (p) => ({ sira: [p.duraklar[0].id, p.duraklar[0].id], atanamayan: [] }) };
  let hataTuru = null;
  try {
    await plan.rotaCekirdegi(bozuk, { anMs: anMs0, hareketSn: 0, baslangic: { tur: "nokta", konum: { lat: 47.4, lng: 9.58 }, ad: "D" }, donus: false, siralanacak: sirali.slice(0, 3) });
  } catch (e) {
    hataTuru = e.tur;
  }
  iddia("ikilenen/eksik kimlikli cevap REDDEDİLDİ", hataTuru === "gecersiz_cevap", hataTuru);

  // Harita kapsamı: yapışma 3,4 km → durak adıyla harita_disi.
  const uzak = { ...sert, rotaHesapla: async (n) => ({ ...(await sahte.rotaHesapla(n)), yapismaM: n.map((_, i) => (i === 2 ? 3380 : 4)) }) };
  const r5 = await plan.rotaCekirdegi(uzak, { anMs: anMs0, hareketSn: 0, baslangic: { tur: "nokta", konum: { lat: 47.4, lng: 9.58 }, ad: "D" }, donus: false, siralanacak: sirali.slice(0, 3) });
  iddia("kapsam dışı nokta adıyla raporlandı", !r5.ok && r5.hata === "harita_disi" && r5.duraklar.join() === "P1", r5.ok ? "ok" : r5.duraklar.join());
}

// ══════════════════════════════════════════════════════════════════════════
bolum("C · VROOM + OSRM SAĞLAYICISI (yerel sahte motor)");
const { VroomSaglayici, vroomIstegi } = await import("@/lib/rota/vroom");
{
  const gelen = [];
  const motor = http.createServer((req, res) => {
    let govde = "";
    req.on("data", (p) => (govde += p));
    req.on("end", () => {
      gelen.push({ yontem: req.method, yol: req.url, yetki: req.headers.authorization ?? null, govde });
      const yaz = (kod, j) => {
        res.writeHead(kod, { "Content-Type": "application/json" });
        res.end(JSON.stringify(j));
      };
      if (req.url.startsWith("/yetkisiz")) return yaz(401, { hata: "yetkisiz" });
      if (req.method === "POST") {
        const j = JSON.parse(govde);
        if (j.jobs.length === 99) return yaz(400, { code: 2, error: "Invalid input" });
        const ters = [...j.jobs].reverse();
        return yaz(200, { code: 0, routes: [{ steps: [{ type: "start" }, ...ters.map((x) => ({ type: "job", id: x.id })), { type: "end" }] }], unassigned: [] });
      }
      const koord = decodeURIComponent(req.url.split("/driving/")[1].split("?")[0]).split(";");
      if (koord.length === 3 && koord[2].startsWith("0.")) return yaz(400, { code: "NoRoute", message: "Impossible route" });
      return yaz(200, {
        code: "Ok",
        routes: [{ geometry: "_p~iF~ps|U_ulLnnqC", legs: koord.slice(1).map(() => ({ distance: 1000, duration: 120 })) }],
        waypoints: koord.map((_, i) => ({ distance: i === 1 ? 7 : 2 })),
      });
    });
  });
  await new Promise((ok) => motor.listen(0, "127.0.0.1", ok));
  const taban = `http://127.0.0.1:${motor.address().port}`;
  const v = new VroomSaglayici({ vroomUrl: `${taban}/`, osrmUrl: taban, sir: "yerel-sir" });

  const p = {
    anMs: anMs0, baslangic: { lat: 47.4125, lng: 9.7417 }, bitis: { lat: 47.4125, lng: 9.7417 }, hareketSn: 28800,
    duraklar: [
      { id: "x1", konum: { lat: 47.3336, lng: 9.6403 }, servisSn: 300, pencere: null },
      { id: "x2", konum: { lat: 47.4268, lng: 9.6589 }, servisSn: 600.4, pencere: { bas: 32400, bit: 39600 } },
      { id: "x3", konum: { lat: 47.4654, lng: 9.7495 }, servisSn: 0, pencere: { bas: null, bit: 36000 } },
    ],
  };
  const g = vroomIstegi(p);
  iddia("VROOM isteği: [boylam, enlem] sırası", g.vehicles[0].start[0] === 9.7417 && g.jobs[0].location[0] === 9.6403);
  iddia("VROOM isteği: dönüş = end, hareket = time_window başı", g.vehicles[0].end?.[1] === 47.4125 && g.vehicles[0].time_window[0] === 28800);
  iddia("VROOM isteği: servis tamsayı sn, pencereler", g.jobs[1].service === 600 && JSON.stringify(g.jobs[1].time_windows) === "[[32400,39600]]" && g.jobs[2].time_windows[0][0] === 0 && !("time_windows" in g.jobs[0]));
  const s = await v.sirala(p);
  iddia("VROOM cevabı kimliklere eşlendi", s.sira.join() === "x3,x2,x1" && s.atanamayan.length === 0, s.sira.join());
  iddia("vekil sırrı Bearer olarak gitti", gelen[0]?.yetki === "Bearer yerel-sir");
  const h = await v.rotaHesapla([p.baslangic, ...p.duraklar.map((d) => d.konum)]);
  iddia("OSRM: bacaklar + yapışma + geometri", h.bacaklar.length === 3 && h.yapismaM?.[1] === 7 && h.geometri?.length > 0 && h.istekSayisi === 1);
  iddia("OSRM isteği koordinatı [boylam,enlem] ve overview=simplified", gelen[1]?.yol.startsWith("/route/v1/driving/9.7417,47.4125;") && gelen[1].yol.includes("overview=simplified"));

  const tur = async (fn) => { try { await fn(); return "geçti"; } catch (e) { return e.tur ?? String(e); } };
  iddia("401 → yetkisiz", (await tur(() => new VroomSaglayici({ vroomUrl: `${taban}/yetkisiz`, osrmUrl: taban, sir: null }).sirala(p))) === "yetkisiz");
  iddia("VROOM code 2 → reddedildi", (await tur(() => v.sirala({ ...p, duraklar: Array.from({ length: 99 }, (_, i) => ({ id: `z${i}`, konum: { lat: 47, lng: 9 }, servisSn: 0, pencere: null })) }))) === "reddedildi");
  iddia("OSRM NoRoute → reddedildi", (await tur(() => v.rotaHesapla([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 0.5, lng: 0.5 }]))) === "reddedildi");
  iddia("kapalı port → erisilemedi", (await tur(() => new VroomSaglayici({ vroomUrl: "http://127.0.0.1:9/", osrmUrl: "http://127.0.0.1:9", sir: null }).sirala(p))) === "erisilemedi");
  motor.close();
}

// ══════════════════════════════════════════════════════════════════════════
bolum("D · GOOGLE SAĞLAYICISI (ağ yok — istek kurucu, okuyucu, JWT)");
const google = await import("@/lib/rota/google");
const oauth = await import("@/lib/rota/google-oauth");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = {
  type: "service_account",
  project_id: "galzura-rota-test",
  client_email: "rota@galzura-rota-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
{
  const p = {
    anMs: (sn) => Date.UTC(2026, 9, 5, 22) + sn * 1000,
    baslangic: { lat: 47.41, lng: 9.74 }, bitis: null, hareketSn: 8 * 3600,
    duraklar: [
      { id: "g1", konum: { lat: 47.33, lng: 9.64 }, servisSn: 300, pencere: { bas: 9 * 3600, bit: 11 * 3600 } },
      { id: "g2", konum: { lat: 47.46, lng: 9.75 }, servisSn: 600, pencere: null },
      { id: "g3", konum: { lat: 47.49, lng: 9.69 }, servisSn: 60, pencere: { bas: null, bit: 7 * 3600 } },
    ],
  };
  const g = google.googleSiralamaIstegi(p);
  const sh = g.model.shipments;
  iddia("RO isteği: etiket = durak kimliği, süre 'Ns'", sh[0].label === "g1" && sh[1].deliveries[0].duration === "600s");
  iddia("RO isteği: pencere RFC3339 (duvar saatiyle)", sh[0].deliveries[0].timeWindows[0].startTime === new Date(p.anMs(9 * 3600)).toISOString());
  iddia("RO isteği: geçmişte kalan pencere gönderilmedi (doğrulama hatası olmasın)", !("timeWindows" in sh[2].deliveries[0]));
  iddia("RO isteği: maliyet tanımlı (yoksa tüm çözümler eşit sayılır)", g.model.vehicles[0].costPerHour > 0 && !("endLocation" in g.model.vehicles[0]));
  const c = google.googleSiralamaCevabi(p, { routes: [{ visits: [{ shipmentLabel: "g2", shipmentIndex: 1 }, {}, { shipmentIndex: 2 }] }] });
  iddia("RO cevabı: proto3'te yazılmayan shipmentIndex=0 doğru okundu", c.sira.join() === "g2,g1,g3", c.sira.join());
  const parca = google.rotaParcalari(Array.from({ length: 60 }, (_, i) => i));
  iddia("Routes: 60 nokta → 27+27+8, uçlar paylaşılıyor", parca.map((x) => x.length).join() === "27,27,8" && parca[1][0] === 26 && parca[2][0] === 52);

  iddia("servis hesabı: düz JSON çözülüyor", oauth.servisHesabiCoz(JSON.stringify(SA))?.project_id === "galzura-rota-test");
  iddia("servis hesabı: base64 çözülüyor", oauth.servisHesabiCoz(Buffer.from(JSON.stringify(SA)).toString("base64"))?.client_email === SA.client_email);
  iddia("servis hesabı: API anahtarı (AIza…) REDDEDİLİYOR", oauth.servisHesabiCoz("AIzaSyD-ornek-anahtar") === null);
  const sa = oauth.servisHesabiCoz(JSON.stringify(SA));
  const jwt = oauth.jwtImzala(sa, oauth.CLOUD_PLATFORM, 1_800_000_000);
  const [b, i, imza] = jwt.split(".");
  const dogru = createVerify("RSA-SHA256").update(`${b}.${i}`).verify(publicKey, Buffer.from(imza.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  const iddialar = JSON.parse(Buffer.from(i, "base64").toString());
  iddia("JWT RS256 imzası açık anahtarla doğrulandı", dogru);
  iddia("JWT iddiaları: iss/scope/aud/exp", iddialar.iss === SA.client_email && iddialar.scope === oauth.CLOUD_PLATFORM && iddialar.aud === "https://oauth2.googleapis.com/token" && iddialar.exp - iddialar.iat === 3600);

  // Ağ taklidi: jeton bir kez alınır; Routes 3 parçada.
  const asil = globalThis.fetch;
  const istekler = [];
  globalThis.fetch = async (url, init) => {
    istekler.push({ url: String(url), govde: init?.body ? String(init.body) : "" });
    const json = (j) => new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
    if (String(url).includes("oauth2")) return json({ access_token: "jeton-1", expires_in: 3600 });
    const g2 = JSON.parse(init.body);
    const n = g2.intermediates.length + 1;
    return json({ routes: [{ legs: Array.from({ length: n }, () => ({ distanceMeters: 500, duration: "60s" })), polyline: { encodedPolyline: polylineKodla([[47, 9], [47.01, 9.01]]) } }] });
  };
  try {
    oauth.jetonOnbelleginiDusur();
    const gs = new google.GoogleSaglayici(sa, false);
    const h = await gs.rotaHesapla(Array.from({ length: 60 }, (_, k) => ({ lat: 47 + k * 0.001, lng: 9.6 })));
    const tokenIstegi = istekler.filter((x) => x.url.includes("oauth2")).length;
    iddia("Routes: 59 bacak birleşti, 3 istek, jeton TEK kez", h.bacaklar.length === 59 && h.istekSayisi === 3 && tokenIstegi === 1, `${h.bacaklar.length} bacak, ${h.istekSayisi} istek, ${tokenIstegi} jeton`);
    iddia("Google maliyet tahmini liste fiyatı (20 durak + 2 istek = 0,22 $)", gs.maliyetUsd({ siralananDurak: 20, rotaIstegi: 2 }) === 0.22);
    iddia("Google haritası EEA kararı olmadan KAPALI", gs.haritaSerbest === false);
  } finally {
    globalThis.fetch = asil;
  }
}

// ══════════════════════════════════════════════════════════════════════════
bolum("E · SAĞLAYICI FABRİKASI (env kuralları)");
const { rotaSaglayicilari } = await import("@/lib/rota/saglayici");
{
  const env = (o) => {
    for (const k of ["ROTA_SAGLAYICI", "ROTA_VROOM_URL", "ROTA_OSRM_URL", "ROTA_SERVIS_SIRRI", "ROTA_YEDEK", "GOOGLE_ROTA_ANAHTARI", "GOOGLE_HARITA_KOSULU", "VERCEL_ENV"]) delete process.env[k];
    Object.assign(process.env, o);
    return rotaSaglayicilari();
  };
  let s = env({});
  iddia("env yok → birincil yok (\"Rota servisi tanımlı değil\")", s.birincil === null && s.sebep === "vroom_adresi_yok");
  s = env({ ROTA_VROOM_URL: "http://rota.galzura.com/vroom", ROTA_OSRM_URL: "http://rota.galzura.com/osrm", ROTA_SERVIS_SIRRI: "s".repeat(40) });
  iddia("uzak adres düz http → KURULMAZ", s.birincil === null && s.sebep === "vroom_https_degil");
  s = env({ ROTA_VROOM_URL: "https://rota.galzura.com/vroom", ROTA_OSRM_URL: "https://rota.galzura.com/osrm" });
  iddia("uzak https ama sır yok → KURULMAZ", s.birincil === null && s.sebep === "vroom_sir_yok");
  s = env({ ROTA_VROOM_URL: "https://rota.galzura.com/vroom", ROTA_OSRM_URL: "https://rota.galzura.com/osrm", ROTA_SERVIS_SIRRI: "s".repeat(40) });
  iddia("uzak https + sır → VROOM birincil, harita serbest", s.birincil?.kod === "vroom" && s.birincil.haritaSerbest === true);
  s = env({ ROTA_VROOM_URL: "http://127.0.0.1:13000", ROTA_OSRM_URL: "http://127.0.0.1:15000" });
  iddia("loopback (SSH tüneli) → sırsız kurulur", s.birincil?.kod === "vroom");
  s = env({ ROTA_SAGLAYICI: "sahte", VERCEL_ENV: "production" });
  iddia("sahte sağlayıcı ÜRETİMDE kurulmaz", s.birincil === null && s.sebep === "sahte_uretimde_kapali");
  s = env({ ROTA_SAGLAYICI: "sahte", VERCEL_ENV: "preview" });
  iddia("sahte sağlayıcı önizlemede kurulur", s.birincil?.kod === "sahte");
  s = env({ ROTA_YEDEK: "google", ROTA_VROOM_URL: "http://127.0.0.1:13000", ROTA_OSRM_URL: "http://127.0.0.1:15000" });
  iddia("yedek istendi ama anahtar yok → yedek PASİF", s.birincil?.kod === "vroom" && s.yedek === null);
  s = env({ ROTA_YEDEK: "google", GOOGLE_ROTA_ANAHTARI: JSON.stringify(SA), ROTA_VROOM_URL: "http://127.0.0.1:13000", ROTA_OSRM_URL: "http://127.0.0.1:15000" });
  iddia("yedek + anahtar → Google yedek, harita KAPALI (EEA kararı yok)", s.yedek?.kod === "google" && s.yedek.haritaSerbest === false);
  s = env({ ROTA_YEDEK: "google", GOOGLE_ROTA_ANAHTARI: JSON.stringify(SA), GOOGLE_HARITA_KOSULU: "eea" });
  iddia("VROOM yok + yedek var → Google tek başına birincil, EEA ile harita açık", s.birincil?.kod === "google" && s.birincil.haritaSerbest === true && s.yedek === null);
  env({});
}

// ══════════════════════════════════════════════════════════════════════════
bolum("F · SUNUCU EYLEMLERİ (sahte DB, gerçek kapılar)");
const { sealData } = await import("iron-session");
const { sessionOptions } = await import("@/lib/session");
const { rotaOner, rotaUygula } = await import("@/app/actions/rota");
const kimlik = async (workerId, isAdmin) => {
  process.env.QA_SESSION_COOKIE = await sealData(
    { worker_id: workerId, name: "QA", phone: "+430000000000", is_admin: isAdmin },
    { password: sessionOptions.password, ttl: 0 }
  );
};
const AYAR = { baslangic: "sonraki", bitis: "acik", hareket: "08:00" };
{
  await kimlik(YONETICI, true);

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari() };
  let r = await rotaOner(SEFER, AYAR);
  iddia("sağlayıcı tanımsız → servis_yok, DB'ye tek sorgu yok", !r.ok && r.hata === "servis_yok" && (globalThis.__CAGRILAR__ ?? []).length === 0, r.ok ? "ok" : r.hata);

  process.env.ROTA_SAGLAYICI = "sahte";

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari({ 0: { durum: "tamamlandi" } }) };
  r = await rotaOner(SEFER, AYAR);
  const k = durum.kayit?.[0];
  iddia("başarılı öneri", r.ok, r.ok ? `${(r.oneri.once.ozet.mesafeM / 1000).toFixed(1)} → ${(r.oneri.sonra.ozet.mesafeM / 1000).toFixed(1)} km` : r.hata);
  if (r.ok) {
    iddia("kapanmış durak yeni sırada başta", r.oneri.yeniSira[0] === durakId(0) && r.oneri.sabitDurak === 1);
    iddia("sıradaki bekleyen durak (Bregenz) başlangıç olarak sabit", r.oneri.yeniSira[1] === durakId(1));
    iddia("kötü sıra iyileşti: km ve süre azaldı", r.oneri.fark.mesafeM > 0 && r.oneri.fark.toplamSn > 0, `−${(r.oneri.fark.mesafeM / 1000).toFixed(1)} km, −${Math.round(r.oneri.fark.toplamSn / 60)} dk`);
    iddia("öneri sırayı DEĞİŞTİRMEDİ (rpc yok)", cagrilar("rpc:sefer_duraklari_sirala").length === 0);
    iddia("sahte sağlayıcıda harita verisi var (OSM türevi değil ama lisanssız)", r.oneri.harita !== null && r.oneri.harita.noktalar.length === 7);
    const iz = r.oneri.parmakIzi;
    const u1 = await rotaUygula(SEFER, r.oneri.yeniSira, "bayat-iz");
    iddia("Uygula: bayat parmak izi → degisti, yazma yok", !u1.ok && u1.hata === "degisti" && cagrilar("rpc:sefer_duraklari_sirala").length === 0);
    const karisik = [...r.oneri.yeniSira.slice(1), r.oneri.yeniSira[0]];
    const u2 = await rotaUygula(SEFER, karisik, iz);
    iddia("Uygula: kapanmış durağı araya taşıyan liste → gecersiz", !u2.ok && u2.hata === "gecersiz");
    const u3 = await rotaUygula(SEFER, r.oneri.yeniSira, iz);
    const rpc = durum.rpc?.[0];
    iddia("Uygula: TAM liste tek rpc ile yazıldı", u3.ok && rpc?.p_sefer === SEFER && rpc.p_ids.join() === r.oneri.yeniSira.join());
  }
  iddia("çağrı kaydı: audit_log, sayılar var, ad/koordinat YOK", k?.action === "rota_optimizasyonu" && k.target === `sefer:${SEFER}` && k.meta.durak === 7 && k.meta.saglayici === "sahte" && k.meta.sonuc === "ok" && !JSON.stringify(k).includes("Feldkirch") && !JSON.stringify(k).includes("47.2"), JSON.stringify(k?.meta));
  iddia("kota: login_attempts 'rota:gunluk' 1'e yazıldı, kilit null", durum.kotaYaz?.[0]?.identifier === "rota:gunluk" && durum.kotaYaz[0].attempts === 1 && durum.kotaYaz[0].locked_until === null);

  // Depodan çıkıp depoya dönen tur: bütün bekleyen duraklar sıralanır.
  const depo = { id: DEPO, name: "Wolfurt Depo", center_lat: 47.45576, center_lng: 9.74036, active: true, archived_at: null };
  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari(), bolgeler: [depo] };
  r = await rotaOner(SEFER, { baslangic: DEPO, bitis: "donus", hareket: "07:30" });
  iddia(
    "depodan başlayan, depoya dönen öneri: 8 durağın hepsi sıralandı",
    r.ok && r.oneri.ayar.baslangicAd === "Wolfurt Depo" && r.oneri.yeniSira.length === 8 && r.oneri.harita?.bitis?.lat === 47.45576 && r.oneri.sonra.duraklar.every((d) => !d.baslangicDuragi),
    r.ok ? `${(r.oneri.once.ozet.mesafeM / 1000).toFixed(1)} → ${(r.oneri.sonra.ozet.mesafeM / 1000).toFixed(1)} km` : r.hata
  );
  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari(), bolgeler: [{ ...depo, archived_at: "2026-09-01T00:00:00Z" }] };
  r = await rotaOner(SEFER, { baslangic: DEPO, bitis: "acik", hareket: "07:30" });
  iddia("arşivlenmiş başlangıç bölgesi → gecersiz, kota düşülmedi", !r.ok && r.hata === "gecersiz" && cagrilar("login_attempts").length === 0);

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari({ 2: { durum: "tamamlandi" }, 3: { durum: "atlandi", atlama_sebep: "kapalı" }, 4: { durum: "varildi" }, 5: { durum: "tamamlandi" }, 6: { durum: "tamamlandi" }, 7: { durum: "tamamlandi" } }) };
  r = await rotaOner(SEFER, AYAR);
  iddia("2 bekleyen durak → az_durak, kota DÜŞÜLMEDİ", !r.ok && r.hata === "az_durak" && cagrilar("login_attempts").length === 0, r.ok ? "ok" : r.hata);

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari({ 3: { latitude: null, longitude: null } }) };
  r = await rotaOner(SEFER, AYAR);
  iddia("koordinatsız durak → konumsuz + adı, kota DÜŞÜLMEDİ", !r.ok && r.hata === "konumsuz" && r.duraklar?.join() === "Hard" && cagrilar("login_attempts").length === 0, r.ok ? "ok" : `${r.hata} ${r.duraklar}`);

  sifirla();
  durum = { sefer: seferSatiri({ durum: "tamamlandi" }), duraklar: durakSatirlari() };
  r = await rotaOner(SEFER, AYAR);
  iddia("kapanmış sefer → sefer_kapali", !r.ok && r.hata === "sefer_kapali");

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari() };
  r = await rotaOner(SEFER, { baslangic: "sonraki", bitis: "acik", hareket: "8 sabah" });
  iddia("geçersiz saat → gecersiz", !r.ok && r.hata === "gecersiz");

  sifirla();
  durum = {
    sefer: seferSatiri(),
    duraklar: durakSatirlari(),
    kotaOku: { data: { attempts: 100, first_attempt_at: new Date().toISOString() }, error: null },
  };
  r = await rotaOner(SEFER, AYAR);
  iddia("günlük tavan dolu → kota_doldu (100), sağlayıcı/kayıt YOK", !r.ok && r.hata === "kota_doldu" && r.limit === 100 && !durum.kayit && !durum.kotaYaz, r.ok ? "ok" : r.hata);

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari(), kotaOku: { data: null, error: { code: "57014", message: "timeout" } } };
  r = await rotaOner(SEFER, AYAR);
  iddia("sayaç okunamadı → kota_okunamadi (HATA = KAPALI)", !r.ok && r.hata === "kota_okunamadi");

  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari(), kotaOku: { data: { attempts: 100, first_attempt_at: "2026-01-01T00:00:00Z" }, error: null } };
  r = await rotaOner(SEFER, AYAR);
  iddia("dünkü dolu sayaç bugün sıfırlandı", r.ok && durum.kotaYaz?.[0]?.attempts === 1);

  // Birincil ulaşılamıyor, yedek yok → servis_hatasi + kayıt + sıra değişmedi.
  process.env.ROTA_SAGLAYICI = "vroom";
  process.env.ROTA_VROOM_URL = "http://127.0.0.1:9/";
  process.env.ROTA_OSRM_URL = "http://127.0.0.1:9";
  sifirla();
  durum = { sefer: seferSatiri(), duraklar: durakSatirlari() };
  r = await rotaOner(SEFER, AYAR);
  iddia("servis ulaşılamıyor → servis_hatasi, sıra değişmedi", !r.ok && r.hata === "servis_hatasi" && cagrilar("rpc:sefer_duraklari_sirala").length === 0, r.ok ? "ok" : r.hata);
  iddia("başarısız çağrı da kaydedildi", durum.kayit?.[0]?.meta?.sonuc === "hata:erisilemedi", durum.kayit?.[0]?.meta?.sonuc);

  // Günlük gizliliği: hata metni koordinat taşısa bile (fetch "Failed to parse
  // URL …", VROOM "Unfound route(s) from location [lon,lat]") Vercel günlüğüne
  // koordinat YAZILMAZ.
  {
    const asilFetch = globalThis.fetch;
    const asilHata = console.error;
    const yazilan = [];
    globalThis.fetch = async (url) => {
      throw new TypeError(`Failed to parse URL from ${String(url)}`);
    };
    console.error = (...a) => yazilan.push(a.join(" "));
    try {
      sifirla();
      durum = { sefer: seferSatiri(), duraklar: durakSatirlari() };
      r = await rotaOner(SEFER, AYAR);
    } finally {
      globalThis.fetch = asilFetch;
      console.error = asilHata;
    }
    const satir = yazilan.find((s) => s.startsWith("[rota]")) ?? "";
    iddia(
      "hata günlüğünde koordinat YOK (URL maskeli)",
      !r.ok && r.hata === "servis_hatasi" && /driving\/…/.test(satir) && !/\d\.\d{3,}/.test(satir),
      satir.slice(0, 110)
    );
  }

  // Yedek Google: birincil düşer → yedek konuşur, harita lisans gereği YOK.
  process.env.ROTA_YEDEK = "google";
  process.env.GOOGLE_ROTA_ANAHTARI = JSON.stringify(SA);
  const asil = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const json = (j) => new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.includes("oauth2")) return json({ access_token: "jeton-2", expires_in: 3600 });
    if (u.includes("optimizeTours")) {
      const g = JSON.parse(init.body);
      return json({ routes: [{ visits: [...g.model.shipments].reverse().map((s) => ({ shipmentLabel: s.label })) }] });
    }
    if (u.includes("computeRoutes")) {
      const g = JSON.parse(init.body);
      return json({ routes: [{ legs: Array.from({ length: g.intermediates.length + 1 }, () => ({ distanceMeters: 2000, duration: "180s" })), polyline: { encodedPolyline: "_p~iF~ps|U" } }] });
    }
    return asil(url, init);
  };
  try {
    oauth.jetonOnbelleginiDusur();
    sifirla();
    durum = { sefer: seferSatiri(), duraklar: durakSatirlari() };
    r = await rotaOner(SEFER, AYAR);
    iddia("birincil düştü → yedek Google konuştu", r.ok && r.oneri.saglayici.kod === "google" && r.oneri.saglayici.yedekKullanildi, r.ok ? r.oneri.saglayici.kod : r.hata);
    iddia("Google sonucu: harita YOK, geometri gövdede YOK (EEA kararı yok)", r.ok && r.oneri.harita === null && r.oneri.sonra.geometri === null && r.oneri.once.geometri === null);
    iddia("yedek çağrısının maliyeti kayıtta", durum.kayit?.[0]?.meta?.saglayici === "google" && durum.kayit[0].meta.yedek === true && durum.kayit[0].meta.maliyetUsd > 0, JSON.stringify(durum.kayit?.[0]?.meta));
  } finally {
    globalThis.fetch = asil;
    for (const k of ["ROTA_YEDEK", "GOOGLE_ROTA_ANAHTARI", "ROTA_VROOM_URL", "ROTA_OSRM_URL"]) delete process.env[k];
    process.env.ROTA_SAGLAYICI = "sahte";
  }

  // KAPSAM: filo şefi başka filonun seferine dokunamaz.
  await kimlik("c0000000-0000-4000-8000-00000000000c", false);
  sifirla();
  durum = {
    sefer: seferSatiri(),
    duraklar: durakSatirlari(),
    sef: { managed_fleet: "mavi", is_active: true },
    sefAraclari: [{ id: "v1", assigned_worker_id: "baska-sofor" }],
  };
  r = await rotaOner(SEFER, AYAR);
  iddia("filo şefi kendi filosu dışındaki sefere → kapsam_disi", !r.ok && r.hata === "kapsam_disi" && cagrilar("login_attempts").length === 0, r.ok ? "ok" : r.hata);
  const u4 = await rotaUygula(SEFER, durakSatirlari().map((d) => d.id), "x");
  iddia("filo şefi Uygula da yapamıyor", !u4.ok && u4.hata === "kapsam_disi");
  await kimlik(YONETICI, true);

  // MODÜL KAPALI — ayrı süreçte (bayrak yükleme anında okunuyor).
  const alt = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./scripts/ts-server-kuru.mjs", "scripts/verify-rota.mjs", "--modul-kapali"],
    { cwd: KOK, encoding: "utf8", env: { ...process.env, ROTA_OPTIMIZASYONU: "" } }
  );
  let kapali = null;
  try {
    kapali = JSON.parse(alt.stdout.trim().split(/\r?\n/).pop());
  } catch {
    /* aşağıda düşer */
  }
  iddia(
    "modül kapalı → öneri ve Uygula reddedildi, yetenek null, DB'ye tek sorgu yok",
    kapali?.oner === "modul_kapali" && kapali?.uygula === "modul_kapali" && kapali?.yetenek === null && kapali?.sorgu === 0,
    JSON.stringify(kapali) ?? alt.stderr.slice(0, 200)
  );
}

// ══════════════════════════════════════════════════════════════════════════
bolum("G · ROTA VEKİLİ (servis/rota-vekil)");
{
  const VEKIL = path.join(KOK, "servis", "rota-vekil", "rota-vekil.mjs");
  const sirsiz = spawnSync(process.execPath, [VEKIL], { encoding: "utf8", env: { PATH: process.env.PATH, ROTA_VEKIL_SIRRI: "kisa" }, timeout: 10_000 });
  iddia("sır kısa/yoksa vekil BAŞLAMIYOR", sirsiz.status !== 0 && /BAŞLAMAZ/.test(sirsiz.stderr));

  const gelen = [];
  const ust = http.createServer((req, res) => {
    let g = "";
    req.on("data", (p) => (g += p));
    req.on("end", () => {
      gelen.push({ m: req.method, yol: req.url, uzunluk: g.length, yetki: req.headers.authorization ?? null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: req.method === "POST" ? 0 : "Ok" }));
    });
  });
  await new Promise((ok) => ust.listen(0, "127.0.0.1", ok));
  const ustTaban = `http://127.0.0.1:${ust.address().port}`;
  const port = 18000 + Math.floor(Math.random() * 1000);
  const SIR = "v".repeat(48);
  const vekil = spawn(process.execPath, [VEKIL], {
    env: { PATH: process.env.PATH, ROTA_VEKIL_SIRRI: SIR, ROTA_VEKIL_PORT: String(port), VROOM_HEDEF: ustTaban, OSRM_HEDEF: ustTaban },
  });
  let log = "";
  vekil.stdout.on("data", (p) => (log += p));
  await new Promise((ok) => {
    const t = setInterval(() => {
      if (log.includes("rota-vekil")) {
        clearInterval(t);
        ok();
      }
    }, 50);
  });
  const taban = `http://127.0.0.1:${port}`;
  const ist = (yol, o = {}) => fetch(`${taban}${yol}`, o).then(async (r) => ({ kod: r.status, j: await r.json().catch(() => null) }));
  const yetki = { Authorization: `Bearer ${SIR}` };
  const koord = "/osrm/route/v1/driving/9.7417,47.4125;9.7471,47.5031";
  try {
    iddia("/health sırsız 200", (await ist("/health")).kod === 200);
    iddia("sırsız /vroom → 401", (await ist("/vroom", { method: "POST", body: "{}" })).kod === 401);
    iddia("yanlış sır → 401", (await ist("/vroom", { method: "POST", body: "{}", headers: { Authorization: `Bearer ${"x".repeat(48)}` } })).kod === 401);
    const govde = '{"vehicles":[],"jobs":[]}';
    const v = await ist("/vroom", { method: "POST", body: govde, headers: { ...yetki, "Content-Type": "application/json" } });
    iddia("doğru sır → VROOM'a iletildi, gövde aynen", v.kod === 200 && gelen.at(-1)?.yol === "/" && gelen.at(-1).uzunluk === govde.length, `${gelen.at(-1)?.uzunluk} bayt`);
    iddia("vekil sırrı motora SIZMADI", gelen.at(-1)?.yetki === null);
    const o = await ist(`${koord}?overview=false`, { headers: yetki });
    iddia("OSRM route iletildi (önek soyuldu)", o.kod === 200 && gelen.at(-1)?.yol === "/route/v1/driving/9.7417,47.4125;9.7471,47.5031?overview=false");
    iddia("OSRM izinsiz servis (match) → 404", (await ist("/osrm/match/v1/driving/1,2;3,4", { headers: yetki })).kod === 404);
    iddia("OSRM izinsiz parametre → 400", (await ist(`${koord}?hints=x`, { headers: yetki })).kod === 400);
    iddia("tanımsız yol → 404", (await ist("/", { headers: yetki })).kod === 404);
    const once = gelen.length;
    const buyuk = await ist("/vroom", { method: "POST", body: "x".repeat(1_100_000), headers: yetki }).catch(() => ({ kod: "baglanti_kesildi" }));
    const ayakta = (await ist("/health")).kod === 200;
    iddia("1 MB üstü gövde motora İLETİLMEDİ, vekil ayakta", gelen.length === once && ayakta, `cevap=${buyuk.kod}`);
    await new Promise((ok) => setTimeout(ok, 100));
    iddia("vekil günlüğünde koordinat YOK", log.includes('"yol":"/osrm/route"') && !log.includes("47.4125") && !log.includes("9.7417"));
  } finally {
    vekil.kill();
    ust.close();
  }
}

// ══════════════════════════════════════════════════════════════════════════
const CANLI_VROOM = process.env.ROTA_CANLI_VROOM_URL;
const CANLI_OSRM = process.env.ROTA_CANLI_OSRM_URL;
if (CANLI_VROOM && CANLI_OSRM) {
  bolum("H · GERÇEK MOTOR (VROOM + OSRM)");
  const v = new VroomSaglayici({ vroomUrl: CANLI_VROOM, osrmUrl: CANLI_OSRM, sir: process.env.ROTA_CANLI_SIR || null });
  const anMs = (sn) => Date.UTC(2026, 9, 5, 22) + sn * 1000;
  const kotu = NOKTA.map(([ad, lat, lng], i) => cekDurak(`c${i}`, ad, lat, lng, i + 1, 600));
  let t = Date.now();
  const r = await plan.rotaCekirdegi(v, {
    anMs, hareketSn: 8 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.45576, lng: 9.74036 }, ad: "Wolfurt depo" },
    donus: true, siralanacak: kotu,
  });
  const sure1 = Date.now() - t;
  iddia(
    "8 duraklı kötü sıra (Vorarlberg) gerçek motorda iyileşti",
    r.ok && r.sonra.ozet.mesafeM < r.once.ozet.mesafeM,
    r.ok
      ? `${(r.once.ozet.mesafeM / 1000).toFixed(1)} km / ${Math.round(r.once.ozet.toplamSn / 60)} dk → ${(r.sonra.ozet.mesafeM / 1000).toFixed(1)} km / ${Math.round(r.sonra.ozet.toplamSn / 60)} dk · ${sure1} ms · sıra: ${r.sonra.duraklar.map((d) => d.ad).join(" → ")}`
      : r.hata
  );
  /**
   * 50 durak — GERÇEKÇİ noktalar: Rheintal'ın Avusturya yakasında tohumlu
   * rastgele adaylar, OSRM /nearest ile en yakın araç yoluna oturtuluyor ve
   * yalnız 300 m'den yakın olanlar alınıyor.
   *
   * ⚠️ Ölçülen ders (03.10.2026): ham rastgele kutunun 7/50 noktası "harita
   * dışı" çıktı — hepsi Avusturya'da ama Bodensee'nin içinde ya da dağlık
   * arazide (Fraxern, Schuttannen), en yakın araç yolu 1,0-2,1 km. Kapı doğru
   * çalışıyordu; teslimat durağı bir yola bağlıdır, test verisi de öyle olmalı.
   */
  let tohum = 7;
  const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
  const elli = [];
  for (let deneme = 0; elli.length < 50 && deneme < 400; deneme++) {
    const lat = 47.28 + rnd() * 0.24;
    const lng = 9.67 + rnd() * 0.13;
    const n = await (await fetch(`${CANLI_OSRM.replace(/\/+$/, "")}/nearest/v1/driving/${lng.toFixed(6)},${lat.toFixed(6)}?number=1`, {
      headers: process.env.ROTA_CANLI_SIR ? { Authorization: `Bearer ${process.env.ROTA_CANLI_SIR}` } : {},
    })).json();
    const w = n.waypoints?.[0];
    if (w && w.distance < 300) elli.push(cekDurak(`r${elli.length}`, `R${elli.length}`, w.location[1], w.location[0], elli.length + 1, 300));
  }
  t = Date.now();
  const r50 = await plan.rotaCekirdegi(v, {
    anMs, hareketSn: 7 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.45576, lng: 9.74036 }, ad: "Wolfurt depo" },
    donus: true, siralanacak: elli,
  });
  const sure50 = Date.now() - t;
  iddia(
    "50 durak gerçek motorda çözüldü",
    r50.ok && r50.bekleyenSira.length === 50,
    r50.ok ? `${(r50.once.ozet.mesafeM / 1000).toFixed(1)} → ${(r50.sonra.ozet.mesafeM / 1000).toFixed(1)} km · ${sure50} ms` : `${r50.hata}: ${r50.duraklar.join(", ")}`
  );
  const disari = await plan.rotaCekirdegi(v, {
    anMs, hareketSn: 8 * 3600,
    baslangic: { tur: "nokta", konum: { lat: 47.45576, lng: 9.74036 }, ad: "Wolfurt depo" },
    donus: false,
    siralanacak: [kotu[1], cekDurak("lindau", "Lindau (DE)", 47.546, 9.6844, 9), kotu[3]],
  });
  iddia("Avusturya dışı durak (Lindau) harita_disi ile yakalandı", !disari.ok && disari.duraklar.includes("Lindau (DE)"), disari.ok ? "ok" : disari.duraklar.join());
} else {
  console.log("\n(H · gerçek motor atlandı — ROTA_CANLI_VROOM_URL / ROTA_CANLI_OSRM_URL tanımsız)");
}

console.log(`\n${dusen === 0 ? "✓" : "✗"} ${gecen}/${gecen + dusen} iddia`);
process.exit(dusen === 0 ? 0 : 1);
