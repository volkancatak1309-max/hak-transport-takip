/**
 * TAKOGRAF ARŞİVİ DOĞRULAMASI (migration 091).
 *
 * QA harness'ında koşar: Docker Postgres + PostgREST + gerçek Storage şimi +
 * okuyucu servisi. ÜRETİMDE ÇALIŞTIRMAYIN — betik yazma yapar.
 *
 *   ENV_FILE=<scratchpad>/.env.takoqa \
 *   TAKOGRAF_DDD=<scratchpad>/tacho/ddd \
 *   node --import ./scripts/ts-server.mjs scripts/verify-takograf.mjs
 *
 * ═══ NE KANITLIYOR ═══
 *
 *   A. Saf katman: tür tahmini, yükleme denetimi, "ölçülemedi ≠ 0"
 *   B. Şema: üç tablo, veri kategorileri, ÖZEL kova
 *   C. 🔴 DOSYA SİLİNEMEZ — ayrıştırılamamış olan bile (HK091)
 *   D. 🔴 KİMLİK DEĞİŞMEZ — sha256/ad/bayt/depo yolu (HK091)
 *   E. sha256 UNIQUE: aynı dosya ikinci kez kaydedilmez
 *   F. 🔑 ARŞİV ÖNCE: servis erişilemezken bile dosya arşivde ve indirilebilir
 *   G. Servis REDDEDERSE dosya yine duruyor ve indirilebilir
 *   H. 🔑 BAYT BAYT AYNI: indirilenin sha256'sı yüklenenle birebir
 *   I. Uçtan uca gerçek .ddd: satırlar yazıldı, sayılar ölçüldü
 *   J. reddedildi ≠ erişilemedi (401/5xx bizim hatamız, dosyanın değil)
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";

import {
  EN_BUYUK_BAYT,
  depoYolu,
  faaliyetKodu,
  faaliyetToplami,
  kimlikKisalt,
  muhurKodu,
  muhurTonu,
  muhurUyarisiGerekli,
  sayaclar,
  slotKodu,
  sureBicim,
  turTahmin,
  yuklemeDenetle,
} from "@/lib/takograf";
import {
  ayristirVeYaz,
  dosya,
  dosyaYukle,
  dosyalar,
  faaliyetler,
  indirmeBaglantisi,
  kimlikEtiketi,
  olaylar,
} from "@/lib/takograf-db";
import { servisAyristir, servisSagligi } from "@/lib/takograf-servis";
import { supabaseAdmin } from "@/lib/supabase";

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
const sha = (b) => createHash("sha256").update(b).digest("hex");

const DDD = process.env.TAKOGRAF_DDD ?? "";
const oku = (ad) => {
  const y = join(DDD, ad);
  return existsSync(y) ? new Uint8Array(readFileSync(y)) : null;
};

async function main() {
  // ── A. SAF KATMAN ──────────────────────────────────────────────────────
  baslik("A · SAF KATMAN");

  iddia("turTahmin: 0x76 → vu", turTahmin(new Uint8Array([0x76, 0x01])) === "vu");
  iddia("turTahmin: 0x00 0x02 → kart", turTahmin(new Uint8Array([0x00, 0x02])) === "kart");
  iddia("turTahmin: boş → vu (fail-safe)", turTahmin(new Uint8Array([])) === "vu");

  iddia("yuklemeDenetle: .ddd + makul boyut kabul", yuklemeDenetle("a.ddd", 1000) === null);
  iddia("yuklemeDenetle: .DDD büyük harf kabul", yuklemeDenetle("A.DDD", 1000) === null);
  iddia("yuklemeDenetle: .pdf ret", yuklemeDenetle("a.pdf", 1000) === "uzanti_yanlis");
  iddia("yuklemeDenetle: 0 bayt ret", yuklemeDenetle("a.ddd", 0) === "bos_dosya");
  iddia(
    "yuklemeDenetle: 5 MB + 1 ret",
    yuklemeDenetle("a.ddd", EN_BUYUK_BAYT + 1) === "cok_buyuk",
    `sınır ${EN_BUYUK_BAYT} bayt`
  );
  iddia("yuklemeDenetle: tam 5 MB kabul", yuklemeDenetle("a.ddd", EN_BUYUK_BAYT) === null);

  iddia("sureBicim(275) = 4:35", sureBicim(275) === "4:35");
  iddia("🔑 sureBicim(null) = null — ölçülemedi 0 DEĞİL", sureBicim(null) === null);
  iddia("sureBicim(0) = 0:00 — gerçekten sıfır olan sıfır kalır", sureBicim(0) === "0:00");

  const toplam = faaliyetToplami([
    { faaliyet: "surus", sureDk: 60 },
    { faaliyet: "surus", sureDk: null },
    { faaliyet: "mola", sureDk: 30 },
    { faaliyet: "bilinmiyor", sureDk: null },
  ]);
  iddia("faaliyetToplami: sürüş 60", toplam.kirilim.surus === 60);
  iddia(
    "🔑 ölçülemeyen satır AYRI sayılır, toplama 0 olarak girmez",
    toplam.olculemeyen === 2 && toplam.kirilim.mola === 30,
    `ölçülemeyen=${toplam.olculemeyen}`
  );

  iddia("faaliyetKodu: DRIVING → surus", faaliyetKodu("DRIVING") === "surus");
  iddia("faaliyetKodu: BREAK_REST → mola", faaliyetKodu("BREAK_REST") === "mola");
  iddia("🔑 faaliyetKodu: tanınmayan → bilinmiyor (satır DÜŞMEZ)", faaliyetKodu("ZZZ") === "bilinmiyor");
  iddia("faaliyetKodu: undefined → bilinmiyor", faaliyetKodu(undefined) === "bilinmiyor");
  iddia("slotKodu: CO_DRIVER_SLOT → yardimci", slotKodu("CO_DRIVER_SLOT") === "yardimci");
  iddia("slotKodu: DRIVER_SLOT → surucu", slotKodu("DRIVER_SLOT") === "surucu");

  iddia("🔑 muhurKodu FAIL-CLOSED: tanınmayan → denenmedi", muhurKodu("evet") === "denenmedi");
  iddia("muhurKodu: dogrulandi korunur", muhurKodu("dogrulandi") === "dogrulandi");
  iddia("muhurUyarisiGerekli: yalnız dogrulanamadi", muhurUyarisiGerekli("dogrulanamadi") === true);
  iddia(
    "🔑 'denenmedi' uyarı ÜRETMEZ — denenmedi ≠ doğrulanamadı",
    muhurUyarisiGerekli("denenmedi") === false && muhurTonu("denenmedi") === "notr"
  );

  iddia("kimlikKisalt: uzun kimlik kırpılır", kimlikKisalt("123456789012") === "123456…9012");
  iddia("kimlikKisalt: null → null", kimlikKisalt(null) === null);
  const yol = depoYolu(new Date("2026-08-26T10:00:00Z"), "abc");
  iddia("depoYolu: yyyy/mm/<id>.ddd", yol === "2026/08/abc.ddd", yol);

  const say = sayaclar([
    { muhurDurumu: "dogrulandi", ayristirmaDurumu: "tamam" },
    { muhurDurumu: "dogrulanamadi", ayristirmaDurumu: "tamam" },
    { muhurDurumu: "denenmedi", ayristirmaDurumu: "basarisiz" },
  ]);
  iddia(
    "sayaclar: süzgeç şeridi sayıları",
    say.tumu === 3 && say.dogrulanamadi === 1 && say.ayristirilamadi === 1,
    JSON.stringify(say)
  );

  // ── B. ŞEMA ────────────────────────────────────────────────────────────
  baslik("B · ŞEMA (091 QA veritabanında)");

  const { satirlar: mevcut, tabloYok } = await dosyalar(5);
  iddia("takograf_dosyalari okunabiliyor", tabloYok === false, `${mevcut.length} satır`);

  for (const t of ["takograf_faaliyetleri", "takograf_olaylari"]) {
    const { error } = await supabaseAdmin.from(t).select("id").limit(1);
    iddia(`${t} var`, !error, error?.message ?? "");
  }

  const { data: kat } = await supabaseAdmin
    .from("veri_kategorileri")
    .select("tablo_adi, kategori")
    .like("tablo_adi", "takograf%");
  iddia(
    "🔑 üç takograf tablosu da veri_kategorileri'nde ve YASAL ZORUNLU",
    (kat ?? []).length === 3 && (kat ?? []).every((k) => k.kategori === "yasal_zorunlu"),
    (kat ?? []).map((k) => `${k.tablo_adi}=${k.kategori}`).join(" · ")
  );

  // ── C+D+E+F+G+H+I. UÇTAN UCA ───────────────────────────────────────────
  baslik("C-I · UÇTAN UCA");

  const { data: w } = await supabaseAdmin.from("workers").select("id, name").limit(1);
  const yukleyen = w?.[0]?.id ?? null;
  iddia("yükleyen için worker var", Boolean(yukleyen));
  if (!yukleyen) return;

  const gercek = oku("vu-004-full.ddd");
  iddia("örnek .ddd bulundu", Boolean(gercek), gercek ? `${gercek.length} bayt` : DDD);
  if (!gercek) return;

  // Her koşuda AYRI dosya olsun diye sona koşu damgası (sha256 UNIQUE).
  const damga = randomUUID().replace(/-/g, "").slice(0, 16);
  const benzersiz = (b) => {
    const x = new Uint8Array(b.length + 8);
    x.set(b);
    x.set(Buffer.from(damga, "hex"), b.length);
    return x;
  };

  const saglik = await servisSagligi();
  iddia("okuyucu servisi ayakta", saglik.ayakta, saglik.sebep ?? process.env.TAKOGRAF_URL ?? "");

  // ── I. Gerçek dosya, servis ÇALIŞIRKEN ────────────────────────────────
  const A = benzersiz(gercek);
  const aSha = sha(Buffer.from(A));
  const r1 = await dosyaYukle({ ad: "vu-004-full.ddd", baytlar: A, yukleyenWorkerId: yukleyen });
  iddia("yükleme başarılı", r1.ok === true, r1.ok ? r1.id : JSON.stringify(r1));
  if (!r1.ok) return;

  const d1 = await dosya(r1.id);
  iddia("satır okunuyor", Boolean(d1));
  iddia("tür ilk bayttan doğru yazıldı", d1?.tur === "vu", String(d1?.tur));
  iddia("ayrıştırma tamam", d1?.ayristirmaDurumu === "tamam", String(d1?.ayristirmaDurumu));
  iddia(
    "mühür servisten geldi ve fail-closed kümede",
    ["dogrulandi", "dogrulanamadi", "denenmedi"].includes(d1?.muhurDurumu ?? ""),
    `${d1?.muhurDurumu} · ${String(d1?.muhurSebep).slice(0, 48)}`
  );
  iddia("sha256 kaydedildi", d1?.sha256 === aSha, `${String(d1?.sha256).slice(0, 12)}…`);

  const f1 = await faaliyetler(r1.id, 5000);
  const o1 = await olaylar(r1.id, 2000);
  iddia("faaliyet satırları yazıldı", f1.length > 0, `${f1.length} satır`);
  iddia("olay satırları yazıldı", o1.length > 0, `${o1.length} satır`);

  const zamanli = f1.filter((x) => x.baslangic).length;
  const sureli = f1.filter((x) => x.sureDk !== null).length;
  iddia(
    "🔴 faaliyet satırlarında ZAMAN var",
    zamanli === f1.length,
    `${zamanli}/${f1.length} başlangıçlı · ${sureli}/${f1.length} süreli`
  );
  const t1 = faaliyetToplami(f1.map((x) => ({ faaliyet: x.faaliyet, sureDk: x.sureDk })));
  console.log(
    `      → sürüş ${sureBicim(t1.kirilim.surus)} · iş ${sureBicim(t1.kirilim.is)} · ` +
      `mola ${sureBicim(t1.kirilim.mola)} · ölçülemeyen ${t1.olculemeyen}`
  );
  iddia("kimlik etiketi üretiliyor", kimlikEtiketi(d1) !== undefined, String(kimlikEtiketi(d1)));

  // ── H. BAYT BAYT AYNI ─────────────────────────────────────────────────
  const url = await indirmeBaglantisi(d1.depoYolu, 60);
  iddia("indirme bağlantısı üretildi", Boolean(url));
  if (url) {
    const cevap = await fetch(url);
    const geri = Buffer.from(await cevap.arrayBuffer());
    iddia(
      "🔑 İNDİRİLEN DOSYA BAYT BAYT AYNI",
      sha(geri) === aSha && geri.length === A.length,
      `${geri.length} bayt · sha ${sha(geri).slice(0, 12)}…`
    );
  }

  // ── E. sha256 UNIQUE ──────────────────────────────────────────────────
  const r2 = await dosyaYukle({ ad: "kopya.ddd", baytlar: A, yukleyenWorkerId: yukleyen });
  iddia(
    "🔑 aynı dosya İKİNCİ kez kaydedilmez",
    r2.ok === false && r2.hata === "zaten_yuklu",
    r2.ok ? "KABUL EDİLDİ" : `${r2.hata} · mevcut=${String(r2.mevcutId).slice(0, 8)}`
  );
  iddia("ikinci yükleme mevcut kaydı işaret ediyor", r2.ok === false && r2.mevcutId === r1.id);

  // ── D. KİMLİK DEĞİŞMEZ ────────────────────────────────────────────────
  const degismezAlanlar = [
    ["sha256", "0".repeat(64)],
    ["dosya_adi", "baska.ddd"],
    ["bayt", 1],
    ["depo_yolu", "x/y.ddd"],
  ];
  for (const [alan, deger] of degismezAlanlar) {
    const { error } = await supabaseAdmin
      .from("takograf_dosyalari")
      .update({ [alan]: deger })
      .eq("id", r1.id);
    iddia(
      `🔴 ${alan} DEĞİŞTİRİLEMEZ`,
      Boolean(error),
      String(error?.message ?? "DEĞİŞTİ!").slice(0, 60)
    );
  }
  const sonra = await dosya(r1.id);
  iddia("reddedilen güncellemeler satırı bozmadı", sonra?.sha256 === aSha && sonra?.bayt === A.length);

  // Ayrıştırma alanları GÜNCELLENEBİLİR olmalı — yoksa yeniden okuma çalışmaz.
  const { error: yenidenHata } = await supabaseAdmin
    .from("takograf_dosyalari")
    .update({ ayristirma_hata: "qa-deneme" })
    .eq("id", r1.id);
  iddia("ayrıştırma alanları güncellenebilir (yeniden okuma için)", !yenidenHata, yenidenHata?.message ?? "");

  // ── C. SİLİNEMEZ ──────────────────────────────────────────────────────
  const { error: silHata } = await supabaseAdmin.from("takograf_dosyalari").delete().eq("id", r1.id);
  iddia("🔴 DOSYA SİLİNEMEZ", Boolean(silHata), String(silHata?.message ?? "SİLİNDİ!").slice(0, 60));
  iddia("silme denemesinden sonra satır YERİNDE", Boolean(await dosya(r1.id)));

  // ── F. ARŞİV ÖNCE: servis ERİŞİLEMEZ ──────────────────────────────────
  baslik("F · SERVİS ERİŞİLEMEZKEN");
  const gercekUrl = process.env.TAKOGRAF_URL;
  process.env.TAKOGRAF_URL = "http://127.0.0.1:1"; // kapalı port
  const B = benzersiz(new Uint8Array([...gercek, 0x01]));
  const bSha = sha(Buffer.from(B));
  const r3 = await dosyaYukle({ ad: "servis-yok.ddd", baytlar: B, yukleyenWorkerId: yukleyen });
  iddia("🔑 servis yokken bile YÜKLEME BAŞARILI", r3.ok === true, r3.ok ? "" : JSON.stringify(r3));
  if (r3.ok) {
    const d3 = await dosya(r3.id);
    iddia(
      "🔑 durum 'bekliyor' — 'basarisiz' DEĞİL (dosya suçlanmadı)",
      d3?.ayristirmaDurumu === "bekliyor",
      String(d3?.ayristirmaDurumu)
    );
    const u3 = await indirmeBaglantisi(d3.depoYolu, 60);
    const g3 = u3 ? Buffer.from(await (await fetch(u3)).arrayBuffer()) : Buffer.alloc(0);
    iddia("🔑 ayrıştırılamamış dosya YİNE indirilebiliyor ve aynı", sha(g3) === bSha, `${g3.length} bayt`);

    const { error: sil3 } = await supabaseAdmin.from("takograf_dosyalari").delete().eq("id", r3.id);
    iddia("🔴 AYRIŞTIRILAMAMIŞ dosya da SİLİNEMEZ", Boolean(sil3), String(sil3?.message ?? "SİLİNDİ!").slice(0, 50));

    // Yeniden okuma: bekliyor → tamam
    process.env.TAKOGRAF_URL = gercekUrl;
    await ayristirVeYaz(r3.id, B);
    const d3b = await dosya(r3.id);
    iddia(
      "🔑 servis dönünce yeniden okuma bekliyor → tamam",
      d3b?.ayristirmaDurumu === "tamam",
      String(d3b?.ayristirmaDurumu)
    );
  }
  process.env.TAKOGRAF_URL = gercekUrl;

  // ── G. SERVİS REDDEDERSE ──────────────────────────────────────────────
  baslik("G · SERVİS REDDEDERSE (bozuk dosya)");
  const C = benzersiz(new Uint8Array(Buffer.from("bu bir takograf dosyasi degil".repeat(40))));
  const cSha = sha(Buffer.from(C));
  const r4 = await dosyaYukle({ ad: "bozuk.ddd", baytlar: C, yukleyenWorkerId: yukleyen });
  iddia("bozuk dosya da KABUL EDİLİR (arşiv önce)", r4.ok === true, r4.ok ? "" : JSON.stringify(r4));
  if (r4.ok) {
    const d4 = await dosya(r4.id);
    iddia(
      "🔑 bozuk dosya 'basarisiz' — kalıcı ret, sonsuz yeniden deneme yok",
      d4?.ayristirmaDurumu === "basarisiz",
      `${d4?.ayristirmaDurumu} · ${String(d4?.ayristirmaHata).slice(0, 46)}`
    );
    iddia("mühür 'denenmedi' kaldı (fail-closed)", d4?.muhurDurumu === "denenmedi", String(d4?.muhurDurumu));
    const u4 = await indirmeBaglantisi(d4.depoYolu, 60);
    const g4 = u4 ? Buffer.from(await (await fetch(u4)).arrayBuffer()) : Buffer.alloc(0);
    iddia("🔑 OKUNAMAYAN dosya da indirilebiliyor ve aynı", sha(g4) === cSha, `${g4.length} bayt`);
  }

  // ── J. reddedildi ≠ erisilemedi ───────────────────────────────────────
  baslik("J · İKİ BAŞARISIZLIK TÜRÜ AYRI");
  const sahte = (kod) =>
    new Promise((coz) => {
      const s = http.createServer((_q, y) => {
        y.writeHead(kod, { "content-type": "application/json" });
        y.end(JSON.stringify({ hata: `qa-${kod}` }));
      });
      s.listen(0, "127.0.0.1", () => coz(s));
    });

  for (const [kod, beklenen, neden] of [
    [400, "reddedildi", "dosya bozuk — yeniden deneme işe yaramaz"],
    [422, "reddedildi", "içerik tanınmadı"],
    [401, "erisilemedi", "🔑 yanlış sır BİZİM hatamız, dosya suçlanmaz"],
    [403, "erisilemedi", "yetki bizim tarafımızda"],
    [500, "erisilemedi", "servis çöktü — dosya sağlam olabilir"],
    [502, "erisilemedi", "ağ katmanı"],
  ]) {
    const s = await sahte(kod);
    process.env.TAKOGRAF_URL = `http://127.0.0.1:${s.address().port}`;
    const r = await servisAyristir(new Uint8Array([0x76]));
    iddia(`HTTP ${kod} → ${beklenen}`, r.ok === false && r.tur === beklenen, neden);
    s.close();
  }
  process.env.TAKOGRAF_URL = gercekUrl;

  const eski = process.env.TAKOGRAF_SECRET;
  delete process.env.TAKOGRAF_SECRET;
  const rY = await servisAyristir(new Uint8Array([0x76]));
  iddia(
    "sır tanımsızsa 'erisilemedi' (dosya suçlanmaz)",
    rY.ok === false && rY.tur === "erisilemedi" && rY.hata === "servis_yapilandirilmadi"
  );
  process.env.TAKOGRAF_SECRET = eski;
}

await main();

console.log(`\n${"─".repeat(62)}`);
console.log(`  ${gecti} geçti · ${kaldi} kaldı`);
if (kaldi > 0) {
  console.log(`\n  KALAN İDDİALAR:`);
  for (const h of hatalar) console.log(`    · ${h}`);
  process.exit(1);
}
console.log(`  ✓ TAKOGRAF ARŞİVİ DOĞRULANDI`);
