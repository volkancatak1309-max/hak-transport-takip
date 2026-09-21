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

/**
 * KAYNAKTAN YORUMLARI SÖKER — dize sabitleri KORUNUR.
 *
 * ═══ 🔴 NEDEN BİR TOKENİZER, NEDEN REGEX DEĞİL ═══
 *
 * Bu muhafızın ilk hâli ham metne bakıyordu ve MUTASYONLA ÖLÇÜLDÜ (21.09.2026,
 * deponun aynası üzerinde) — üç ayrı yoldan yeşile boyanabiliyordu:
 *
 *   B) Kapı AÇILIR (`yoneticiMuaf: false` → `true`), yanına
 *      `// eskiden yoneticiMuaf: false idi` yorumu bırakılır → muhafız YEŞİL.
 *      Yani kuralı anlatan bir cümle, kuralın yerine geçiyordu.
 *   L) Metin tavanı denetimlerinin TAMAMI silinir, üstlerindeki blok yorum
 *      kalır → üç denetimden ikisi YEŞİL.
 *   K) `const KABUL = "image/*";` gibi SIRADAN bir MIME dizesi, naif yorum
 *      sökücüde SAHTE BİR BLOK YORUM açıp kapının tamamını görünmez yapıyordu.
 *
 * Bir muhafızın en kötü hâli yanlış alarm değil, SESSİZ GEÇMEKTİR. Kaynak bu
 * yüzden tek geçişte taranıyor ve dize durumları da izleniyor — ama YALNIZ
 * yorum kaçırmamak için.
 *
 * ⚠️ DİZELER SİLİNMİYOR ve bu bilinçli: bu depoda kuralların çoğu dize
 * sabitidir (`"sefer_sizin_degil"`, `"kanit_var"`, `from "@/lib/teslimat-db"`).
 * Dizeleri atan bir sökücü, denetimlerin yarısını kör ederdi — mutasyon K'yi
 * kapatırken B'den daha büyük bir delik açmak olurdu.
 */
function kodu(kaynak) {
  let cikti = "";
  let d = "kod"; // kod | satir | blok | tek | cift | sablon
  for (let i = 0; i < kaynak.length; i++) {
    const c = kaynak[i];
    const s2 = kaynak.slice(i, i + 2);
    if (d === "kod") {
      if (s2 === "//") { d = "satir"; i++; continue; }
      if (s2 === "/*") { d = "blok"; i++; continue; }
      if (c === "'") d = "tek";
      else if (c === '"') d = "cift";
      else if (c === "`") d = "sablon";
      cikti += c;
      continue;
    }
    if (d === "satir") { if (c === "\n") { d = "kod"; cikti += c; } continue; }
    if (d === "blok") { if (s2 === "*/") { d = "kod"; i++; } continue; }
    // ── dize içi: karakterler KORUNUYOR, yalnız kapanış aranıyor ──
    cikti += c;
    if (c === "\\") { cikti += kaynak[i + 1] ?? ""; i++; continue; }
    if ((d === "tek" && c === "'") || (d === "cift" && c === '"') || (d === "sablon" && c === "`")) {
      d = "kod";
    }
  }
  return cikti;
}

/**
 * Bir `export async function AD(...)` gövdesini süslü parantez sayarak çıkarır.
 *
 * ⚠️ ÖLÇÜLDÜ (mutasyon C): `POST[\s\S]*?yoneticiMuaf:\s*false` deseni POST'un
 * GÖVDESİNE KAPALI DEĞİLDİ — dosyanın sonuna eklenen sıradan bir handler'daki
 * `yoneticiMuaf: false` literali, POST kapısı AÇILMIŞ olmasına rağmen iddiayı
 * karşılıyordu. Gövde sınırı tahmin edilmemeli, SAYILMALI.
 */
function fnGovdesi(kod, ad) {
  const m = new RegExp(`export async function ${ad}\\b`).exec(kod);
  if (!m) return "";

  /**
   * ⚠️ GÖVDE SÜSLÜSÜ, PARAMETRE SÜSLÜSÜ DEĞİL. İlk denemede `indexOf("{")`
   * kullanıldı ve imzadaki DESTRUCTURING'i yakaladı:
   *   `export async function POST(req: NextRequest, { params }: Yol) {`
   *                                                 ↑ ilk süslü bu
   * Gövde sanılan şey `{ params }` oluyordu ve iki denetim sessizce düşüyordu.
   * Bu yüzden önce parametre parantezi KAPATILIYOR, gövde ondan sonra aranıyor.
   */
  const parenBas = kod.indexOf("(", m.index);
  if (parenBas < 0) return "";
  let pDerinlik = 0;
  let parenBit = -1;
  for (let i = parenBas; i < kod.length; i++) {
    if (kod[i] === "(") pDerinlik++;
    else if (kod[i] === ")") {
      pDerinlik--;
      if (pDerinlik === 0) {
        parenBit = i;
        break;
      }
    }
  }
  if (parenBit < 0) return "";

  const bas = kod.indexOf("{", parenBit);
  if (bas < 0) return "";
  let derinlik = 0;
  for (let i = bas; i < kod.length; i++) {
    if (kod[i] === "{") derinlik++;
    else if (kod[i] === "}") {
      derinlik--;
      if (derinlik === 0) return kod.slice(bas, i + 1);
    }
  }
  return kod.slice(bas);
}

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

/**
 * ⚠️ BUNDAN SONRAKİ TÜM DENETİMLER `kodu(...)` ÜZERİNDE ÇALIŞIR.
 *
 * Ham metin üzerinde çalışan bir denetim, kuralı ANLATAN bir yorumla tatmin
 * olur ve kapı açıkken yeşil kalır (mutasyon B/L, ölçüldü). Yorumlar ve dize
 * sabitleri burada bir kez sökülüyor; aşağıdaki hiçbir satır ham kaynağı
 * görmüyor.
 */
const kKod = kodu(kanit);
const fKod = kodu(foto);
const pKod = kodu(panel);
const cKod = kodu(cekirdek);

// Fonksiyon gövdeleri SAYILARAK çıkarılıyor — `[\s\S]*?` bir gövdenin
// sınırını bilmez (mutasyon C).
const POST_GOVDE = fnGovdesi(kKod, "POST");
const GET_GOVDE = fnGovdesi(kKod, "GET");

// ══ 1 · KAPILAR ═══════════════════════════════════════════════════════════
kontrol("POST gövdesi bulunabildi", POST_GOVDE.length > 0, "fnGovdesi boş döndü");
kontrol("GET gövdesi bulunabildi", GET_GOVDE.length > 0, "fnGovdesi boş döndü");
kontrol("POST requireMobileWorker", /requireMobileWorker\(/.test(POST_GOVDE));
kontrol("GET requireMobileWorker", /requireMobileWorker\(/.test(GET_GOVDE));
kontrol("sahiplik sefer.worker_id ile", /sefer\.worker_id !== worker\.id/.test(kKod));
kontrol("403 sefer_sizin_degil", /sefer_sizin_degil/.test(kKod));
kontrol("kapanmış seferde 409 sefer_kapali", /ACIK_DURUMLAR[\s\S]{0,200}?sefer_kapali/.test(kKod));

// ══ 1b · 🔴 YAZMADA YÖNETİCİ MUAFİYETİ YOK (Volkan kararı 21.09.2026) ══════
// Kanıtı yalnız seferin şoförü bırakır. Bu kapının sessizce gevşemesi, kanıdın
// `worker_id`sini yöneticinin kimliğine çevirir ve foto ucunun
// `kanit_senin_degil` kapısı yüzünden SEFERİN ŞOFÖRÜNÜ kendi teslimatından
// kilitler (ölçüldü). POST ve GET AYRI AYRI, kendi gövdelerinde denetleniyor.
kontrol(
  "kapı yönetici muafiyetini AÇIK BİR BAYRAKLA taşıyor",
  /yoneticiMuaf/.test(kKod),
  "muafiyet bayrağı kalkmış — yazma/okuma farkı görünmez oldu"
);
kontrol(
  "POST gövdesinde yoneticiMuaf: false",
  /yoneticiMuaf:\s*false/.test(POST_GOVDE) && !/yoneticiMuaf:\s*true/.test(POST_GOVDE),
  "🔴 yazmada yönetici muafiyeti AÇILMIŞ"
);
kontrol(
  "GET gövdesinde yoneticiMuaf: true",
  /yoneticiMuaf:\s*true/.test(GET_GOVDE) && !/yoneticiMuaf:\s*false/.test(GET_GOVDE),
  "okuma yöneticiye kapanmış"
);
kontrol(
  "muafiyet YALNIZ bayrak + is_admin ile çözülüyor",
  /yoneticiMuaf && worker\.is_admin === true/.test(kKod) && !/govde\.(isAdmin|yonetici)/.test(kKod)
);
kontrol(
  "foto ucunun TASLAK yolu is_admin OKUMUYOR",
  !/is_admin/.test(fKod),
  "🔴 taslak kapısı kanıt kapısından gevşek — reddedilen kişi dosyayı yine de sokar"
);
kontrol(
  "taslak yolu da sefer.worker_id ile kapalı",
  /sefer\.worker_id !== a\.worker\.id/.test(fKod)
);

// ══ 1c · PANELİN YAZMA KAPISI DA AYNI CÜMLE ═══════════════════════════════
// 🔴 Karar panelin kuralından geliyor; muhafız yalnız mobili sabitlerse panel
// sessizce gevşeyebilir ve iki yüzey aynı soruya farklı cevap verir.
kontrol(
  "panel kanıt eylemi de sahipliğe bakıyor",
  /sefer\.worker_id !== session\.worker_id/.test(pKod),
  "app/actions/teslimat.ts yazma kapısı değişmiş"
);
kontrol(
  "panel kanıt yazmada is_admin muafiyeti YOK",
  !/is_admin/.test(pKod.slice(0, pKod.indexOf("export async function getSoforTeslimatlari"))),
  "🔴 panelde yazma tarafına yönetici muafiyeti girmiş"
);

// ══ 1d · ŞOFÖR DEĞİŞİMİ KANIDI KOPARAMAZ (arka kapı) ══════════════════════
// 🔴 ÖLÇÜLDÜ: `PATCH /sefer/[id]` gövdesindeki `soforId` kanıt sorulmadan
// şoförü değiştirebiliyordu — yönetici seferi kendine devredip kanıt yazıp
// geri devredebilirdi. İki adımda delinebilen bir kapı, kapı değildir.
const seferPatch = kodu(oku("app/api/mobile/sefer/[id]/route.ts"));
kontrol(
  "şoför değişimi geçerli kanıdı SORUYOR",
  /seferdeGecerliKanitVarMi\(/.test(seferPatch),
  "🔴 arka kapı açık — kanıt varken şoför değiştirilebiliyor"
);
kontrol("şoför değişimi 409 kanit_var ile reddediliyor", /"kanit_var"/.test(seferPatch));
kontrol(
  "seferdeGecerliKanitVarMi yalnız çekirdekte",
  /export async function seferdeGecerliKanitVarMi\b/.test(cKod)
);

// ══ 2 · KURAL ÇEKİRDEKTE ══════════════════════════════════════════════════
// Uçlar ham tabloya DOKUNMAZ: tablo adları route dosyalarında hiç geçmemeli.
for (const tablo of ["teslimatlar", "teslimat_fotograflari", "teslimat_taslak_dosyalari"]) {
  kontrol(`kanıt ucu \`${tablo}\` tablosuna doğrudan dokunmuyor`, !kKod.includes(`"${tablo}"`));
  kontrol(`foto ucu \`${tablo}\` tablosuna doğrudan dokunmuyor`, !fKod.includes(`"${tablo}"`));
}
kontrol("kanıt ucu çekirdekten besleniyor", /from "@\/lib\/teslimat-db"/.test(kKod));
kontrol("foto ucu çekirdekten besleniyor", /from "@\/lib\/teslimat-db"/.test(fKod));
kontrol("panel AYNI çekirdeği kullanıyor", /from "@\/lib\/teslimat-db"/.test(pKod));
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
  kontrol(`${fn} yalnız çekirdekte tanımlı`, new RegExp(`export async function ${fn}\\b`).test(cKod));
  kontrol(`${fn} uçta yeniden tanımlanmamış`, !new RegExp(`function ${fn}\\b`).test(kKod + fKod));
}

// ══ 3 · İMZALAMA TEK YERDE ════════════════════════════════════════════════
// 🔴 EN KOLAY BOZULAN SÖZ. `imzali()` eskiden panelin ÖZEL yardımcısıydı;
// mobil uç eklenirken kopyalansaydı iki yüzey aynı kanıta farklı alanlarla
// bakardı ve TTL'i biri değiştirdiğinde öteki geride kalırdı.
kontrol("imzaliKanitlar çekirdekte EXPORT", /export async function imzaliKanitlar\b/.test(cKod));
kontrol("panel imzaliKanitlar'ı ÇAĞIRIYOR", /imzaliKanitlar\(/.test(pKod));
kontrol("kanıt ucu imzaliKanitlar'ı ÇAĞIRIYOR", /imzaliKanitlar\(/.test(kKod));
kontrol(
  "panelde özel imzalama yardımcısı KALMADI",
  !/async function imzali\s*\(/.test(pKod),
  "app/actions/teslimat.ts içinde yeniden doğmuş"
);
kontrol(
  "panel fotoğrafı kendi imzalamıyor",
  !/signedReceiptUrls\(/.test(pKod),
  "imzalama çekirdeğe taşındı, panelde çağrı kalmamalı"
);

// ══ 4 · SONUÇ SESSİZCE DÜŞMEZ ═════════════════════════════════════════════
// 109 yoksa insert 42703 verir ve uç bunu `ozellik_kapali` diye SÖYLER.
// `sonuc`u koşulsuz göndermek ya da hiç göndermemek, iki ayrı sessiz kusur.
kontrol("çekirdek sonuc'u YALNIZ verildiyse gönderiyor", /\.\.\.\(g\.sonuc \?/.test(cKod));
kontrol("kolon_yok ayrı bir sebep", /kolon_yok/.test(cKod));
kontrol("uç kolon_yok → ozellik_kapali 109", /kolon_yok[\s\S]{0,120}?migration: "109"/.test(kKod));
kontrol(
  "sonuc listesi TEK KAYNAK (TESLIMAT_SONUCLARI)",
  /export const TESLIMAT_SONUCLARI/.test(cKod) && /TESLIMAT_SONUCLARI/.test(kKod)
);
kontrol(
  "uç sonuc dizgesini elle yazmıyor",
  !/\["teslim",\s*"teslim_edilemedi"\]/.test(kKod),
  "liste çekirdekten gelmeli"
);

// ══ 5 · SEBEP ZORUNLULUĞU İKİ KATMANDA ════════════════════════════════════
// Uç 400 döner (kullanıcı hangi alanın yanlış olduğunu okusun), DB 23514 ile
// tutar (uç atlansa bile). Biri olmadan öteki eksik: yalnız DB olsaydı
// kullanıcı 503 görürdü, yalnız uç olsaydı panel/başka yol delerdi.
kontrol("uç: sebep_gerekli 400", /sebep_gerekli/.test(kKod));
kontrol("uç: sebep_gereksiz 400", /sebep_gereksiz/.test(kKod));
kontrol("migration: teslimat_sebep_butun CHECK", /teslimat_sebep_butun/.test(migration));
kontrol("migration: teslimat_sonuc_gecerli CHECK", /teslimat_sonuc_gecerli/.test(migration));

// ══ 6 · 23514 → 400, 503 DEĞİL ════════════════════════════════════════════
// `teslimatlar`da üç metin CHECK'i var; uç onları insert'ten ÖNCE ölçmezse
// istemcinin gövde hatası sunucu arızası gibi görünür.
kontrol("uç aliciAd tavanını (80) denetliyor", /enCok: 80|80,/.test(kKod) && /aliciAd/.test(kKod));
kontrol("uç not tavanını (500) denetliyor", /500/.test(kKod));
kontrol("uç sebep tavanını (300) denetliyor", /300/.test(kKod));

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
kontrol("foto ucunda taslak bayrağı var", /taslakIstendi/.test(fKod));
kontrol(
  "bayrak YOKKEN eski 409 kanit_yok korunuyor",
  /!bulundu\.teslimat[\s\S]{0,200}?"kanit_yok"/.test(fKod)
);
kontrol("taslak sahipliği SORGUDA süzülüyor", /\.eq\("durak_id"[\s\S]{0,120}?\.eq\("worker_id"/.test(cKod));
kontrol("eksik/yabancı taslak → istek reddediliyor", /tamamMi/.test(kKod) && /taslak_yok/.test(kKod));
// ⚠️ Yorum metnine değil, TETİKLEYİCİ İFADESİNE bakıyor: dosya taslağın neden
// değişebilir olduğunu uzun uzun anlatıyor ve "değişmez" sözcüğü orada da
// geçiyor. Aranan şey `create trigger … on public.teslimat_taslak_dosyalari`.
kontrol(
  "taslak tablosunda değişmezlik tetikleyicisi YOK (bilerek)",
  !/create trigger[\s\S]{0,300}?on public\.teslimat_taslak_dosyalari/i.test(migration)
);

// ══ 9 · FOTOĞRAF TAVANI ═══════════════════════════════════════════════════
// Şemada tavan YOK (ölçüldü) — tek bekçi uygulama katmanı.
kontrol("foto tavanı 5 ve uçta", /FOTO_TAVAN = 5/.test(kKod));
kontrol("tavan aşımı 400 foto_tavan", /foto_tavan/.test(kKod));

// ══ 10 · SESSİZ EKSİK YASAK ═══════════════════════════════════════════════
// Kanıt yazıldıktan sonra bir fotoğraf bağlanamazsa geri alınamaz (kanıt
// değişmez). Yanıt SAYIYI söylemek zorunda.
kontrol("bağlanan/düşen fotoğraf sayısı yanıtta", /bagli:/.test(kKod) && /dusen:/.test(kKod));
kontrol("durum ilerlemediyse yanıt SÖYLÜYOR", /durumIlerledi/.test(kKod) && /durumSebep/.test(kKod));

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ TESLİMAT KANITI MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log("✓ teslimat kanıtı: kapılar · çekirdek · değişmezlik · taslak ayrımı yerinde.");
