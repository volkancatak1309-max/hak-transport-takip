#!/usr/bin/env node
/**
 * TESLİMAT KANITI UCU MUHAFIZI — kaynak denetimi (Faz C-2).
 *
 * ═══ NE KORUYOR ═══
 *
 * Bu turun üç sözü var; üçü de SESSİZCE bozulabilir:
 *
 * 1. **KURAL ÇEKİRDEKTE.** Panel (`app/actions/teslimat.ts`) ve mobil uçlar
 *    aynı `lib/teslimat-db.ts` fonksiyonlarını çağırıyor. Bir yüzeye
 *    "hızlıca" kopyalanan imzalama ya da yazma, diğeri düzeltilirken unutulur
 *    ve iki ekran aynı kanıta farklı bakar. Bu depoda o hata bir kez yaşandı
 *    (`app/api/mobile/_rapor/csv.ts` başlığı: FUEL_ENABLED ↔ EXPORT_ENABLED).
 *
 * 2. **KANIT DEĞİŞMEZ.** `teslimatlar` ve `teslimat_fotograflari` üzerinde
 *    UPDATE yolu yoktur (iptal hariç). Taslak tablosu bunun İSTİSNASI DEĞİL,
 *    KAPSAMI DIŞIDIR: taslak delil değildir. Uçların ham kanıt tablolarına
 *    dokunması, o ayrımı ikinci bir yerde yeniden doğurur.
 *
 * 3. **SONUÇ SESSİZCE DÜŞMEZ.** 109 uygulanmamışsa kanıt ucu `ozellik_kapali`
 *    demek zorunda. `sonuc`u atlayıp yazmak, "teslim edilemedi"yi sessizce
 *    "teslim edildi" diye kaydetmek olurdu.
 *
 * Kullanım: npm run lint:teslimat-kaniti
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => {
  const tam = path.join(ROOT, p);
  if (!existsSync(tam)) {
    console.error(`✗ dosya yok: ${p}`);
    process.exit(1);
  }
  return readFileSync(tam, "utf8");
};

let dusen = 0;
const kontrol = (ad, kosul, kanit) => {
  if (!kosul) {
    dusen++;
    console.log(`  ✗ ${ad}${kanit ? "  —  " + kanit : ""}`);
  }
};

const KANIT = "app/api/mobile/sefer/[id]/duraklar/[durakId]/kanit/route.ts";
const FOTO = "app/api/mobile/sefer/[id]/duraklar/[durakId]/foto/route.ts";
const PANEL = "app/actions/teslimat.ts";
const CEKIRDEK = "lib/teslimat-db.ts";
const MIGRATION = "db/migrations/109_teslimat_sonuc_ve_taslak.sql";

const kanit = oku(KANIT);
const foto = oku(FOTO);
const panel = oku(PANEL);
const cekirdek = oku(CEKIRDEK);
const migration = oku(MIGRATION);

// ══ 1 · KAPILAR ═══════════════════════════════════════════════════════════
// POST ve GET aynı kapıdan geçer; sahiplik `sefer.worker_id` ile denetlenir.
// Yönetici muafiyeti YALNIZ `is_admin`e bağlı olmalı — gövdeden gelen bir
// iddiaya değil.
kontrol("POST requireMobileWorker", /POST[\s\S]{0,400}?requireMobileWorker\(/.test(kanit));
kontrol("GET requireMobileWorker", /export async function GET[\s\S]{0,400}?requireMobileWorker\(/.test(kanit));
kontrol("sahiplik sefer.worker_id ile", /sefer\.worker_id !== worker\.id/.test(kanit));
kontrol("403 sefer_sizin_degil", /sefer_sizin_degil/.test(kanit));
kontrol(
  "yönetici muafiyeti YALNIZ is_admin'den",
  /worker\.is_admin === true/.test(kanit) && !/govde\.(isAdmin|yonetici)/.test(kanit)
);
kontrol("kapanmış seferde 409 sefer_kapali", /ACIK_DURUMLAR[\s\S]{0,200}?sefer_kapali/.test(kanit));

// ══ 2 · KURAL ÇEKİRDEKTE ══════════════════════════════════════════════════
// Uçlar ham tabloya DOKUNMAZ: tablo adları route dosyalarında hiç geçmemeli.
for (const tablo of ["teslimatlar", "teslimat_fotograflari", "teslimat_taslak_dosyalari"]) {
  kontrol(`kanıt ucu \`${tablo}\` tablosuna doğrudan dokunmuyor`, !kanit.includes(`"${tablo}"`));
  kontrol(`foto ucu \`${tablo}\` tablosuna doğrudan dokunmuyor`, !foto.includes(`"${tablo}"`));
}
kontrol("kanıt ucu çekirdekten besleniyor", /from "@\/lib\/teslimat-db"/.test(kanit));
kontrol("foto ucu çekirdekten besleniyor", /from "@\/lib\/teslimat-db"/.test(foto));
kontrol("panel AYNI çekirdeği kullanıyor", /from "@\/lib\/teslimat-db"/.test(panel));
for (const fn of [
  "createTeslimat",
  "addTeslimatFoto",
  "getTeslimatByDurak",
  "imzaliKanitlar",
  "createTaslak",
  "getTaslaklar",
  "deleteTaslaklar",
  "listTaslakByDurak",
]) {
  kontrol(`${fn} yalnız çekirdekte tanımlı`, new RegExp(`export async function ${fn}\\b`).test(cekirdek));
  kontrol(`${fn} uçta yeniden tanımlanmamış`, !new RegExp(`function ${fn}\\b`).test(kanit + foto));
}

// ══ 3 · İMZALAMA TEK YERDE ════════════════════════════════════════════════
// 🔴 EN KOLAY BOZULAN SÖZ. `imzali()` eskiden panelin ÖZEL yardımcısıydı;
// mobil uç eklenirken kopyalansaydı iki yüzey aynı kanıta farklı alanlarla
// bakardı ve TTL'i biri değiştirdiğinde öteki geride kalırdı.
kontrol("imzaliKanitlar çekirdekte EXPORT", /export async function imzaliKanitlar\b/.test(cekirdek));
kontrol("panel imzaliKanitlar'ı ÇAĞIRIYOR", /imzaliKanitlar\(/.test(panel));
kontrol("kanıt ucu imzaliKanitlar'ı ÇAĞIRIYOR", /imzaliKanitlar\(/.test(kanit));
kontrol(
  "panelde özel imzalama yardımcısı KALMADI",
  !/async function imzali\s*\(/.test(panel),
  "app/actions/teslimat.ts içinde yeniden doğmuş"
);
kontrol(
  "panel fotoğrafı kendi imzalamıyor",
  !/signedReceiptUrls\(/.test(panel),
  "imzalama çekirdeğe taşındı, panelde çağrı kalmamalı"
);

// ══ 4 · SONUÇ SESSİZCE DÜŞMEZ ═════════════════════════════════════════════
// 109 yoksa insert 42703 verir ve uç bunu `ozellik_kapali` diye SÖYLER.
// `sonuc`u koşulsuz göndermek ya da hiç göndermemek, iki ayrı sessiz kusur.
kontrol("çekirdek sonuc'u YALNIZ verildiyse gönderiyor", /\.\.\.\(g\.sonuc \?/.test(cekirdek));
kontrol("kolon_yok ayrı bir sebep", /kolon_yok/.test(cekirdek));
kontrol("uç kolon_yok → ozellik_kapali 109", /kolon_yok[\s\S]{0,120}?migration: "109"/.test(kanit));
kontrol(
  "sonuc listesi TEK KAYNAK (TESLIMAT_SONUCLARI)",
  /export const TESLIMAT_SONUCLARI/.test(cekirdek) && /TESLIMAT_SONUCLARI/.test(kanit)
);
kontrol(
  "uç sonuc dizgesini elle yazmıyor",
  !/\["teslim",\s*"teslim_edilemedi"\]/.test(kanit),
  "liste çekirdekten gelmeli"
);

// ══ 5 · SEBEP ZORUNLULUĞU İKİ KATMANDA ════════════════════════════════════
// Uç 400 döner (kullanıcı hangi alanın yanlış olduğunu okusun), DB 23514 ile
// tutar (uç atlansa bile). Biri olmadan öteki eksik: yalnız DB olsaydı
// kullanıcı 503 görürdü, yalnız uç olsaydı panel/başka yol delerdi.
kontrol("uç: sebep_gerekli 400", /sebep_gerekli/.test(kanit));
kontrol("uç: sebep_gereksiz 400", /sebep_gereksiz/.test(kanit));
kontrol("migration: teslimat_sebep_butun CHECK", /teslimat_sebep_butun/.test(migration));
kontrol("migration: teslimat_sonuc_gecerli CHECK", /teslimat_sonuc_gecerli/.test(migration));

// ══ 6 · 23514 → 400, 503 DEĞİL ════════════════════════════════════════════
// `teslimatlar`da üç metin CHECK'i var; uç onları insert'ten ÖNCE ölçmezse
// istemcinin gövde hatası sunucu arızası gibi görünür.
kontrol("uç aliciAd tavanını (80) denetliyor", /enCok: 80|80,/.test(kanit) && /aliciAd/.test(kanit));
kontrol("uç not tavanını (500) denetliyor", /500/.test(kanit));
kontrol("uç sebep tavanını (300) denetliyor", /300/.test(kanit));

// ══ 7 · DEĞİŞMEZLİK TETİKLEYİCİSİ YENİ KOLONLARI SAYIYOR ══════════════════
// 🔴 082'nin yazılı kuralı: "yeni bir kolon eklendiğinde tetikleyici onu
// SAYMAZSA, o kolon kanıtın DEĞİŞTİRİLEBİLİR tek alanı olur."
const tetikleyici = migration.slice(migration.indexOf("function public.teslimat_degismez"));
for (const kolon of ["sonuc", "sebep", "durak_id", "worker_id", "imza_yol"]) {
  kontrol(
    `değişmezlik tetikleyicisi \`${kolon}\` kolonunu sayıyor`,
    new RegExp(`new\\.${kolon}\\s+is distinct from`).test(tetikleyici)
  );
}
kontrol(
  "iptal_eden bir kez yazılıp DONUYOR",
  /old\.iptal_eden is not null and new\.iptal_eden is distinct from old\.iptal_eden/.test(tetikleyici),
  "koşulsuz yazılırsa iptal yolu kırılır, hiç yazılmazsa aktör damgası değişir"
);
kontrol(
  "iptal_at/iptal_sebep HÂLÂ yazılabilir (iptal yolu)",
  !/new\.iptal_at\s+is distinct from/.test(tetikleyici),
  "iptal yolunun kendisi kapanmış"
);

// ══ 8 · TASLAK KANITIN YERİNE GEÇMİYOR ════════════════════════════════════
// Taslak yolu AÇIK RIZAYLA seçilir; bayrak yoksa foto ucunun eski 409'u durur.
kontrol("foto ucunda taslak bayrağı var", /taslakIstendi/.test(foto));
kontrol(
  "bayrak YOKKEN eski 409 kanit_yok korunuyor",
  /!bulundu\.teslimat[\s\S]{0,200}?"kanit_yok"/.test(foto)
);
kontrol("taslak sahipliği SORGUDA süzülüyor", /\.eq\("durak_id"[\s\S]{0,120}?\.eq\("worker_id"/.test(cekirdek));
kontrol("eksik/yabancı taslak → istek reddediliyor", /tamamMi/.test(kanit) && /taslak_yok/.test(kanit));
// ⚠️ Yorum metnine değil, TETİKLEYİCİ İFADESİNE bakıyor: dosya taslağın neden
// değişebilir olduğunu uzun uzun anlatıyor ve "değişmez" sözcüğü orada da
// geçiyor. Aranan şey `create trigger … on public.teslimat_taslak_dosyalari`.
kontrol(
  "taslak tablosunda değişmezlik tetikleyicisi YOK (bilerek)",
  !/create trigger[\s\S]{0,300}?on public\.teslimat_taslak_dosyalari/i.test(migration)
);

// ══ 9 · FOTOĞRAF TAVANI ═══════════════════════════════════════════════════
// Şemada tavan YOK (ölçüldü) — tek bekçi uygulama katmanı.
kontrol("foto tavanı 5 ve uçta", /FOTO_TAVAN = 5/.test(kanit));
kontrol("tavan aşımı 400 foto_tavan", /foto_tavan/.test(kanit));

// ══ 10 · SESSİZ EKSİK YASAK ═══════════════════════════════════════════════
// Kanıt yazıldıktan sonra bir fotoğraf bağlanamazsa geri alınamaz (kanıt
// değişmez). Yanıt SAYIYI söylemek zorunda.
kontrol("bağlanan/düşen fotoğraf sayısı yanıtta", /bagli:/.test(kanit) && /dusen:/.test(kanit));
kontrol("durum ilerlemediyse yanıt SÖYLÜYOR", /durumIlerledi/.test(kanit) && /durumSebep/.test(kanit));

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ TESLİMAT KANITI MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log("✓ teslimat kanıtı: kapılar · çekirdek · değişmezlik · taslak ayrımı yerinde.");
