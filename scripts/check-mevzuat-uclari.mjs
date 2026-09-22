#!/usr/bin/env node
/**
 * MEVZUAT UÇLARI MUHAFIZI — kaynak denetimi (Faz D-4).
 *
 * ═══ NE KORUYOR ═══
 *
 * 1. **UYARI DEFTERİ DEĞİŞMEZ.** `mevzuat_uyarilari` gönderilmiş bildirimlerin
 *    kaydıdır. Kapatma/silme ucu AÇILMAZ ve tabloya mobil yüzeyden
 *    dokunulmaz. İki ayrı zarar birden: (a) gönderilmiş bir bildirim
 *    gönderilmemiş gibi görünür, (b) `mevzuat_uyari_tekil` indeksinin spam
 *    koruması bozulur — satır kalkınca aynı kademe yeniden gönderilir.
 *    Kural ürünün kendi CRUD muhafızında da yazılı
 *    (`scripts/check-crud-ekranlari.mjs`, MUAF listesi).
 *
 * 2. **`?durum=` SESSİZCE YUTULMAZ.** Açık/kapalı diye bir durum yok. Süzgeci
 *    yok sayıp tam listeyi döndürmek, istemciye "süzdüm" dedirtirdi.
 *
 * 3. **İKİ KAPI, PANELİNKİYLE AYNI.** Okuma `requireMobileFleetView`, ayar
 *    `requireMobileAdmin`. Kural setini değiştirmek filonun tabi olduğu
 *    hukuku değiştirir; şefe kapalıdır.
 *
 * 4. **KAPSAM GERÇEKTEN SÜZÜLÜYOR.** Kapı gevşemese bile SÜZGEÇ düşerse şef
 *    başka filonun şoförünü, uyarısını ve belgesini görür. Uç kapsamı üç
 *    okumaya da VERMEK, lib ise `onlyFleet` ile UYGULAMAK zorunda.
 *
 * 5. **PANEL DAVRANIŞI KAZA ESERİ DEĞİŞMEZ.** `mevzuatPanosu`nun kapsam
 *    parametresi varsayılanı `UNRESTRICTED` olmalı: panel ve tarama cron'u
 *    bugünkü kümeyi okumaya devam etsin.
 *
 * 6. **KADEME SIRASI TEK KAYNAK.** `kademeDenetle` hem yazma yolunun hem ucun
 *    çağırdığı fonksiyon; uçta elle yazılmış ikinci bir karşılaştırma, biri
 *    değiştiğinde panel ile telefonu sessizce ayrıştırır.
 *
 * 7. **EŞİK VE KADEME SAYILARI UÇTA GÖMÜLÜ DEĞİL.** Hukuki eşikler
 *    `KURAL_SETLERI`de, varsayılan kademeler `VARSAYILAN_KADEME`de.
 *
 * 8. **"EKSİK BELGE" UYDURULMAZ.** 078'de bir belgenin ZORUNLU olduğunu
 *    söyleyen alan yok; uç ölçebildiğini (süre) döndürür ve bunu gövdede
 *    açıkça söyler.
 *
 * Kullanım: npm run lint:mevzuat-uclari
 */
import { readFileSync, existsSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
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

/** Yorumları söker, dize sabitlerini KORUR — kuralı ANLATAN yorum kapıyı açmasın. */
function kodu(kaynak) {
  let cikti = "";
  let d = "kod";
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
    cikti += c;
    if (c === "\\") { cikti += kaynak[i + 1] ?? ""; i++; continue; }
    if ((d === "tek" && c === "'") || (d === "cift" && c === '"') || (d === "sablon" && c === "`")) {
      d = "kod";
    }
  }
  return cikti;
}

let dusen = 0;
const kontrol = (ad, gecti, ek) => {
  if (gecti) return;
  dusen++;
  console.error(`  ✗ ${ad}${ek ? `\n      ${ek}` : ""}`);
};

const UC = "app/api/mobile/mevzuat/route.ts";
const kod = {
  uc: kodu(oku(UC)),
  ucHam: oku(UC),
  db: kodu(oku("lib/mevzuat-db.ts")),
  saf: kodu(oku("lib/mevzuat.ts")),
  panelAction: kodu(oku("app/actions/mevzuat.ts")),
  crudMuhafiz: oku("scripts/check-crud-ekranlari.mjs"),
};

// ══ 1 · UYARI DEFTERİ DEĞİŞMEZ ════════════════════════════════════════════

/** `app/api/mobile/mevzuat` altındaki TÜM route dosyaları. */
function routeYollari(dizin) {
  const tam = path.join(ROOT, dizin);
  if (!existsSync(tam)) return [];
  const cikti = [];
  for (const ad of readdirSync(tam)) {
    const alt = path.join(tam, ad);
    if (statSync(alt).isDirectory()) cikti.push(...routeYollari(path.join(dizin, ad)));
    else if (ad === "route.ts") cikti.push(path.join(dizin, ad).split(path.sep).join("/"));
  }
  return cikti;
}
const mevzuatRotalari = routeYollari("app/api/mobile/mevzuat");

kontrol(
  "mevzuat mobil yüzeyinde YALNIZ tek route var (kapatma ucu açılmamış)",
  mevzuatRotalari.length === 1 && mevzuatRotalari[0] === UC,
  `🔴 bulunan: ${mevzuatRotalari.join(", ") || "(yok)"} — defter değişmez, kapatma/silme ucu AÇILMAZ`
);

kontrol(
  "uçta POST/DELETE/PUT handler yok (yalnız GET + PATCH)",
  !/export\s+(async\s+)?function\s+(POST|DELETE|PUT)\s*\(/.test(kod.uc),
  "🔴 defteri değiştirecek tek yazma yolu bile açılmaz"
);

for (const [ad, k] of [["uç", kod.uc], ["panel action", kod.panelAction]]) {
  /**
   * SORGU aranıyor, kelime değil: uç gövdesinde tablo adı bir AÇIKLAMA dizesi
   * olarak geçiyor ("…mevzuat_uyarilari bir defterdir…") ve o metin kapıyı
   * açmıyor. Yasak olan `.from("mevzuat_uyarilari")` ile tabloya uzanmak.
   */
  kontrol(
    `${ad}: mevzuat_uyarilari tablosuna SORGU açmıyor`,
    !/\.from\(\s*"mevzuat_uyarilari"/.test(k),
    "defterin tek yazıcısı lib/mevzuat-db.ts mevzuatTara — gönderim yolu"
  );
}

kontrol(
  "lib: mevzuat_uyarilari üzerinde .delete() YOK",
  !/from\("mevzuat_uyarilari"\)[\s\S]{0,200}?\.delete\(/.test(kod.db),
  "🔴 satır silinince tekil indeksin spam koruması da silinir"
);

kontrol(
  "CRUD muhafızındaki değişmezlik gerekçesi yerinde duruyor",
  /mevzuat_uyarilari\).*?DEĞİŞMEZ/s.test(kod.crudMuhafiz),
  "kural iki muhafızda birden yazılı olmalı; biri kalkarsa diğeri tutar"
);

kontrol(
  "uç kapatma ucu olmadığını GÖVDEDE söylüyor (istemci düğme çizmesin)",
  /uyariKapatma:\s*false/.test(kod.uc) && /uyariSilme:\s*false/.test(kod.uc),
  "sessiz eksik yasak: istemci olmayan yeteneği denemeye kalkmasın"
);

// ══ 2 · `?durum=` SESSİZCE YUTULMAZ ═══════════════════════════════════════
kontrol(
  "?durum= 400 ile reddediliyor ve sebebi adlandırılmış",
  /searchParams\.has\("durum"\)/.test(kod.uc) && /kapanis_ekseni_yok/.test(kod.uc),
  "🔴 yok sayılan süzgeç, süzülmemiş listeyi süzülmüş gibi gösterir"
);
kontrol(
  "uçta acik/kapali diye uydurulmuş bir durum eşlemesi yok",
  !/durum\s*===?\s*"(acik|kapali)"/.test(kod.uc),
  "kapanış ekseni üründe yok; türetilmiş bir 'açık' tanımı ölçüm gibi okunur"
);

// ══ 3 · İKİ KAPI ══════════════════════════════════════════════════════════
kontrol(
  "GET → requireMobileFleetView",
  /export async function GET[\s\S]*?requireMobileFleetView\s*\(/.test(kod.uc),
  "panelin okuma kapısı: patron + filo şefi"
);
kontrol(
  "PATCH → requireMobileAdmin",
  /export async function PATCH[\s\S]*?requireMobileAdmin\s*\(/.test(kod.uc),
  "🔴 kural setini değiştirmek filonun HUKUKUNU değiştirir — şefe kapalı"
);
kontrol(
  "PATCH şefe açan kapıyı kullanmıyor",
  !/export async function PATCH[\s\S]*?requireMobileFleetView\s*\(/.test(kod.uc),
  "panelin ayar kapısı requireAdmin"
);
kontrol(
  "panel de aynı iki kapıyı kullanıyor (parite tek kaynak)",
  /requireFleetView\s*\(/.test(kod.panelAction) && /requireAdmin\s*\(/.test(kod.panelAction),
  "mobil kapı paneldekinin ikizi olmalı"
);

// ══ 4 · KAPSAM GERÇEKTEN SÜZÜLÜYOR ════════════════════════════════════════
kontrol(
  "uç: kapsam aktörden okunuyor (gövdeden değil)",
  /guard\.actor\.fleetScope/.test(kod.uc),
  "kapsam sunucudan gelmeli"
);
/**
 * ÇAĞRININ KENDİ ARGÜMAN LİSTESİ — parantez SAYARAK.
 *
 * ⚠️ ARIZA ENJEKSİYONUNDA YAKALANDI: bu kontrol önce "fonksiyon adından
 * sonraki 260 karakterde `fleetScope` geçiyor mu" diye bakıyordu ve
 * `mevzuatPanosu(new Date())` enjeksiyonunu KAÇIRDI — çünkü hemen ardından
 * gelen `uyariListesi({… fleetScope …})` pencereye giriyordu. Komşunun
 * argümanı kapıyı açamamalı; artık yalnız ÇAĞRININ KENDİ parantezi okunuyor.
 */
function cagriArgumanlari(kaynak, fnAdi) {
  const cikti = [];
  const kalip = new RegExp(`\\b${fnAdi}\\s*\\(`, "g");
  let m;
  while ((m = kalip.exec(kaynak)) !== null) {
    let derinlik = 1;
    let i = m.index + m[0].length;
    const bas = i;
    while (i < kaynak.length && derinlik > 0) {
      if (kaynak[i] === "(") derinlik++;
      else if (kaynak[i] === ")") derinlik--;
      i++;
    }
    cikti.push(kaynak.slice(bas, i - 1));
  }
  return cikti;
}

for (const fn of ["mevzuatPanosu", "uyariListesi", "mevzuatBelgeleri"]) {
  const cagrilar = cagriArgumanlari(kod.uc, fn);
  kontrol(
    `uç: ${fn} çağrısı kapsamı TAŞIYOR`,
    cagrilar.length > 0 && cagrilar.every((a) => /fleetScope/.test(a)),
    `🔴 süzgeç düşerse şef başka filonun satırını görür  [çağrı: ${cagrilar.length}]`
  );
}
kontrol(
  "uç: ?sofor= kapsam dışıysa 403 (404 değil)",
  /kapsam_disi/.test(kod.uc) && /isFleetWorker\s*\(/.test(kod.uc),
  "şoför VAR, yetki yok — iki durum ayrı"
);
for (const fn of ["mevzuatPanosu", "uyariListesi", "mevzuatBelgeleri"]) {
  kontrol(
    `lib: ${fn} kapsamı onlyFleet ile UYGULUYOR`,
    new RegExp(`${fn}\\(`).test(kod.db),
    "fonksiyon yerinde olmalı"
  );
}
kontrol(
  "lib: onlyFleet üç okumada da kullanılıyor",
  (kod.db.match(/onlyFleet\(/g) ?? []).length >= 4,
  "🔴 kapsam parametresini ALIP kullanmamak, en sessiz sızıntı biçimi"
);
kontrol(
  "lib: belge kümesi test + şoför + filo üçlüsünden geçiyor",
  /withoutTestRows\(/.test(kod.db) && /onlyDrivers\(/.test(kod.db) && /onlyFleet\(/.test(kod.db),
  "/admin Dikkat panosundaki üçlünün aynısı"
);

// ══ 5 · PANEL DAVRANIŞI KAZA ESERİ DEĞİŞMEZ ═══════════════════════════════
kontrol(
  "mevzuatPanosu kapsam varsayılanı UNRESTRICTED",
  /fleetScope:\s*FleetScope\s*=\s*UNRESTRICTED/.test(kod.db),
  "🔴 varsayılan daraltıcı olursa panel ve tarama cron'u sessizce satır kaybeder"
);
kontrol(
  "panel action'ı kapsam GEÇMİYOR (bu turda panel davranışı değişmedi)",
  !/mevzuatPanosu\([^)]*fleetScope/.test(kod.panelAction),
  "değişecekse bilinçli ve ölçülerek değişmeli — bkz. docs/MEVZUAT-UCLARI.md §3"
);

// ══ 6 · KADEME SIRASI TEK KAYNAK ══════════════════════════════════════════
kontrol(
  "kademeDenetle saf katmanda tanımlı",
  /export function kademeDenetle/.test(kod.saf)
);
kontrol(
  "yazma yolu (mevzuatAyariYaz) kademeDenetle çağırıyor",
  /kademeDenetle\s*\(/.test(kod.db),
  "şema CHECK'i ile aynı cümle tek yerde"
);
kontrol(
  "uç da AYNI fonksiyonu çağırıyor",
  /kademeDenetle\s*\(/.test(kod.uc),
  "uçta ikinci bir kural kümesi olmaz"
);
kontrol(
  "uçta elle yazılmış kademe karşılaştırması yok",
  !/kademe\.(erken|yaklasti|son)\s*[<>]/.test(kod.uc),
  "🔴 kopyalanan kural zamanla ayrışır (ayarDenetle dersi, 090)"
);

// ══ 7 · SAYILAR UÇTA GÖMÜLÜ DEĞİL ═════════════════════════════════════════
kontrol(
  "uç eşikleri KURAL_SETLERI'nden okuyor",
  /KURAL_SETLERI/.test(kod.uc),
  "hukuki eşik uçta yazılı olamaz"
);
kontrol(
  "uç varsayılan kademeyi VARSAYILAN_KADEME'den taşıyor",
  /VARSAYILAN_KADEME/.test(kod.uc)
);
kontrol(
  "uçta gömülü {erken: 60 …} varsayılanı yok",
  !/erken:\s*\d+\s*,\s*yaklasti:\s*\d+/.test(kod.uc),
  "varsayılan tek kaynakta (lib/mevzuat.ts)"
);
kontrol(
  "uç geçerli kural setlerini KODDAN türetiyor",
  /Object\.keys\(KURAL_SETLERI\)/.test(kod.uc),
  "elle yazılmış üçlü, dördüncü set eklendiğinde onu sessizce reddeder"
);

// ══ 8 · "EKSİK BELGE" UYDURULMAZ ══════════════════════════════════════════
kontrol(
  "uç 'eksik belge' tespiti yapmadığını gövdede söylüyor",
  /eksikBelgeTespiti:\s*false/.test(kod.uc),
  "🔴 hangi belgenin zorunlu olduğunu söyleyen alan 078'de YOK"
);
kontrol(
  "belge bloğu tür sayısını taşıyor (0 satırın sebebi ayırt edilsin)",
  /turSayisi/.test(kod.uc) && /turSayisi/.test(kod.db),
  "'tür tanımlı değil' ile 'temiz' aynı görünmemeli"
);
kontrol(
  "uçta zorunlu-belge kuralı uydurulmamış",
  !/(zorunluBelge|requiredDocs|eksikBelgeler)\b/.test(kod.uc),
  "ürün o soruyu cevaplayacak veriyi tutmuyor"
);

// ══ 9 · GÖVDE SÖZLEŞMESİ ══════════════════════════════════════════════════
kontrol(
  "uç sayfalama sözleşmesini kullanıyor (parsePage + pageInfo)",
  /parsePage\s*\(/.test(kod.uc) && /pageInfo\s*\(/.test(kod.uc),
  "lib/mobile-list.ts tek kaynak"
);
kontrol(
  "uç ayar değişikliğini alan farkıyla iz bırakıyor",
  /auditChange\s*\(/.test(kod.uc),
  "eski→yeni farkı denetimde sorulan sorunun ta kendisi"
);
kontrol(
  "uç 086 yoksa 503 + migration numarası dönüyor",
  /tabloYok/.test(kod.uc) && /migration:\s*"086"/.test(kod.ucHam),
  "kademeli düşüş: teşhis edilebilir olsun"
);

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ MEVZUAT UÇLARI MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log(
  "✓ mevzuat uçları: defter değişmez · kapatma ucu yok · iki kapı · kapsam süzgeci · " +
    "tek kaynak kademe · uydurma eksik-belge yok."
);
