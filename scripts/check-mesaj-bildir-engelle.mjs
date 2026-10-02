#!/usr/bin/env node
/**
 * MESAJ BİLDİR / ENGELLE / SÜZGEÇ / YÖNETİCİ SİLMESİ MUHAFIZI (migration 111).
 *
 * App Store Guideline 1.2 ve Google Play UGC kuralının istediği dört yeteneğin
 * KAYNAKTA durduğunu ve sessizce gevşemediğini denetler. Ağ yok, DB yok —
 * davranışın uçtan uca kanıtı `verify:mesaj-bildir-engelle-yerel` (yerel DB).
 *
 * ═══ NE KORUYOR ═══
 *
 * 1. **SÜZGEÇ TEK KAPIDA.** `uygunsuzIcerik` YALNIZ `govdeCoz` içinde çağrılır
 *    ve dört gönderim yolunun dördü de `govdeCoz`dan geçer (mobil birebir/grup,
 *    mobil duyuru, panel gönder, panel duyuru). Mobil uçlar süzgeç kodunu 422'ye
 *    çevirir (`govdeHataDurumu`). Liste örnek cümlelerle SINANIR: İ/ı kuralı,
 *    tam kelime, masum kelimeler (dick/Götter/Amina/SIK).
 *
 * 2. **ENGEL SUNUCUDA, YALNIZ GRUPTA.** Geçmiş (`konusmaGecmisi`), okunmamış
 *    sayacı, makbuz ve liste önizlemesi engel listesini uygular; parametreler
 *    ZORUNLU (unutan çağıran derlenmez). Grup bildirimi engelleyeni düşürür.
 *    `engelSuzgeci` `is.null` dalını taşır — yoksa gönderen kaydı silinmiş
 *    bütün mesajlar da düşerdi (`NULL NOT IN` tuzağı).
 *
 * 3. **SİLİNEN METİN İSTEMCİYE GİTMEZ.** Geçmiş izde metni boşaltır, yönetici
 *    listesi `govde: null` döner; eski istemci (iz istemeyen) satırı hiç almaz.
 *    Silme sonrası liste önizlemesi tazelenir.
 *
 * 4. **YÖNETİCİ İŞLERİ İKİ HATLI.** Sil / listele / çöz uçları
 *    `requireMobileAdmin`, panel sayfası `requireAdmin`, çekirdek ayrıca
 *    `is_admin` denetler. Şef ve şoför bu listeyi göremez.
 *
 * 5. **BİLDİRİM PUSH'U METİN TAŞIMAZ.** Yöneticilere giden push mesajın
 *    kendisini okumaz; veri `tur: "mesaj_bildirimi"`.
 *
 * 6. **MIGRATION + KURULUM.** 111 iki tabloyu kurar, açık bildirim kısmi
 *    tekil indeksle korunur, RLS kapalı; kurulum listesinde (ORDER) yer alır.
 *
 * 7. **İNGİLİZCE METİNLER.** "Report" ve "Block" kelimeleri mağaza
 *    incelemecisinin arayacağı biçimde geçer (panel EN dosyası).
 *
 * Kullanım: npm run lint:mesaj-bildir-engelle
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oku = (p) => {
  const tam = path.join(ROOT, p);
  if (!existsSync(tam)) {
    console.error(`✗ dosya yok: ${p}`);
    process.exit(1);
  }
  return readFileSync(tam, "utf8").replace(/\r\n/g, "\n");
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

/** Bir üst düzey fonksiyonun bölgesi: başlangıcından bir sonraki `export`a. */
function bolge(kod, imza) {
  const i = kod.indexOf(imza);
  if (i < 0) return "";
  const j = kod.indexOf("\nexport ", i + imza.length);
  return kod.slice(i, j < 0 ? undefined : j);
}

let dusen = 0;
let gecen = 0;
const kontrol = (ad, gecti, ek) => {
  if (gecti) { gecen++; return; }
  dusen++;
  console.error(`  ✗ ${ad}${ek ? `\n      ${ek}` : ""}`);
};

const K = {
  messaging: kodu(oku("lib/messaging.ts")),
  push: kodu(oku("lib/push.ts")),
  engel: kodu(oku("lib/mesaj-engel.ts")),
  mod: kodu(oku("lib/mesaj-moderasyon.ts")),
  ucSohbet: kodu(oku("app/api/mobile/messages/[id]/route.ts")),
  ucOkundu: kodu(oku("app/api/mobile/messages/[id]/okundu/route.ts")),
  ucDuyuru: kodu(oku("app/api/mobile/messages/duyuru/route.ts")),
  ucListe: kodu(oku("app/api/mobile/messages/route.ts")),
  ucSil: kodu(oku("app/api/mobile/messages/mesaj/[mesajId]/route.ts")),
  ucBildir: kodu(oku("app/api/mobile/messages/mesaj/[mesajId]/bildir/route.ts")),
  ucBildirimler: kodu(oku("app/api/mobile/messages/bildirimler/route.ts")),
  ucCoz: kodu(oku("app/api/mobile/messages/bildirimler/[mesajId]/coz/route.ts")),
  ucEngeller: kodu(oku("app/api/mobile/messages/engeller/route.ts")),
  ucEngelKaldir: kodu(oku("app/api/mobile/messages/engeller/[workerId]/route.ts")),
  panel: kodu(oku("app/actions/messages.ts")),
  panelSayfa: kodu(oku("app/admin/mesajlar/bildirilen/page.tsx")),
  migration: oku("db/migrations/111_mesaj_bildir_engelle.sql"),
  kurulum: oku("scripts/gen-install-sql.mjs"),
  en: JSON.parse(oku("messages/en.json")).messages ?? {},
};

// ══ 1 · SÜZGEÇ TEK KAPIDA ═════════════════════════════════════════════════
const govdeCoz = bolge(K.messaging, "export function govdeCoz");
kontrol("govdeCoz süzgeci çağırıyor ve uygunsuz_icerik dönüyor",
  /uygunsuzIcerik\s*\(/.test(govdeCoz) && /"uygunsuz_icerik"/.test(govdeCoz));
kontrol("govdeHataDurumu süzgeç kodunu 422'ye çeviriyor",
  /uygunsuz_icerik"\s*\?\s*422/.test(bolge(K.messaging, "export function govdeHataDurumu")));
const suzgecCagrisi = Object.entries(K)
  .filter(([ad]) => ad !== "messaging" && typeof K[ad] === "string")
  .filter(([, kod]) => /uygunsuzIcerik\s*\(/.test(kod))
  .map(([ad]) => ad);
kontrol("süzgeç govdeCoz DIŞINDA çağrılmıyor (tek kapı)", suzgecCagrisi.length === 0, suzgecCagrisi.join(", "));
for (const [ad, kod] of [["mobil birebir/grup POST", K.ucSohbet], ["mobil duyuru", K.ucDuyuru]]) {
  kontrol(`${ad}: govdeCoz + govdeHataDurumu (422)`,
    /govdeCoz\s*\(/.test(kod) && /mobileError\(\s*govdeHataDurumu\(/.test(kod));
}
kontrol("panel gönder + duyuru govdeCoz'dan geçiyor",
  (K.panel.match(/govdeCoz\s*\(/g) ?? []).length >= 2);

// Liste davranışı — gerçek modül çalıştırılıyor (saf, ağ yok).
const suzgec = await import(pathToFileURL(path.join(ROOT, "lib/mesaj-suzgec.ts")).href);
const ORNEKLER = [
  ["SİKTİR git", true], ["SIKTIR", true], ["Du Arschloch", true], ["what the FUCK", true],
  ["orospu'nun", true], ["IBNE", true], ["ŞEREFSIZ", true], ["ＦＵＣＫ", true],
  ["SIK sık geliyorum", false], ["Götter", false], ["fickle weather", false],
  ["Scunthorpe depot", false], ["dicker Nebel auf der A1", false], ["Ich bin zu dick", false],
  ["Amina kommt später", false],
  ["Sikkim'e gittim", false], ["pic attached", false], ["I got it", false],
  ["Scheiße, Stau!", false], ["Teslimat 06:30 A deposu", false], ["en retard", false],
];
const yanlis = ORNEKLER.filter(([m, b]) => suzgec.uygunsuzIcerik(m) !== b).map(([m]) => m);
kontrol(`süzgeç örnekleri (${ORNEKLER.length}) — İ/ı, tam kelime, masum kelimeler`, yanlis.length === 0,
  `beklenmeyen sonuç: ${yanlis.join(" | ")}`);
kontrol("süzgeç listeleri boş değil (tr/de/en)",
  suzgec.SUZGEC_BOYU.tr > 20 && suzgec.SUZGEC_BOYU.de > 15 && suzgec.SUZGEC_BOYU.en > 15,
  JSON.stringify(suzgec.SUZGEC_BOYU));

// ══ 2 · ENGEL SUNUCUDA, YALNIZ GRUPTA ═════════════════════════════════════
const gecmis = bolge(K.messaging, "export async function konusmaGecmisi");
kontrol("konusmaGecmisi: gorunum ZORUNLU parametre",
  /gorunum:\s*KonusmaGorunumu\s*\)/.test(gecmis) && !/gorunum\?:/.test(gecmis));
kontrol("konusmaGecmisi: grupta engellenenler okunuyor ve sorguya uygulanıyor",
  /if\s*\(\s*gorunum\.grup\s*\)/.test(gecmis) && /engellenenler\(/.test(gecmis) && /q\.or\(\s*engel\s*\)/.test(gecmis));
kontrol("konusmaGecmisi: engel listesi okunamazsa 503 (fail-closed)",
  /if\s*\(\s*!e\.ok\s*\)\s*return\s*\{\s*ok:\s*false/.test(gecmis));
kontrol("okunmamisSayaclari: engel parametresi ZORUNLU ve süzüyor",
  /engel:\s*\{[^}]*\}\s*\|\s*null\s*\)/.test(bolge(K.messaging, "export async function okunmamisSayaclari")) &&
    /engel\.engelliler\.has/.test(bolge(K.messaging, "export async function okunmamisSayaclari")));
kontrol("makbuzYaz: grup parametresi ZORUNLU ve engelliye makbuz yazmıyor",
  /grup:\s*boolean\s*\)/.test(bolge(K.messaging, "export async function makbuzYaz")) &&
    /q\.or\(\s*engel\s*\)/.test(bolge(K.messaging, "export async function makbuzYaz")));
kontrol("konusmaListesi: engelli okuyanda grup önizlemesi yeniden kuruluyor + sayaca engel geçiyor",
  /engellenenler\(actor\.worker\.id\)/.test(K.messaging) && /okunmamisSayaclari\([\s\S]{0,200}engel\s*\)/.test(K.messaging));
kontrol("engelSuzgeci 'is.null' dalını taşıyor (NULL NOT IN tuzağı)",
  /sender_worker_id\.is\.null,sender_worker_id\.not\.in\./.test(K.engel));
kontrol("tabloYok yazma yolunun gövdesiz 404'ünü de tanıyor",
  /status\s*===\s*404/.test(K.engel));
kontrol("grup push'u gönderini engelleyenleri düşürüyor",
  /gondereniEngelleyenler\(/.test(bolge(K.push, "async function grupUyeleri")) &&
    /engelleyen\.idler\.has\(/.test(K.push));
kontrol("mobil geçmiş: okuyan + grup bayrağı geçiriliyor",
  /okuyanId:\s*k\.actor\.worker\.id/.test(K.ucSohbet) && /grup:\s*hedef\.tur\s*===\s*"grup"/.test(K.ucSohbet));
kontrol("mobil okundu: makbuzYaz grup bayrağıyla",
  /makbuzYaz\([\s\S]{0,120}tur\s*===\s*"grup"/.test(K.ucOkundu));

// ══ 3 · SİLİNEN METİN İSTEMCİYE GİTMEZ ════════════════════════════════════
kontrol("geçmiş: silinmiş satırda metin BOŞ, makbuz yok",
  /govde:\s*silindi\s*\?\s*""\s*:\s*m\.body/.test(gecmis) && /okuyanlar:\s*silindi\s*\|\|/.test(gecmis));
kontrol("geçmiş: 'gizle' modunda silinmiş satır sorgudan düşüyor",
  /silinenler\s*===\s*"gizle"\)\s*q\s*=\s*q\.is\("deleted_at",\s*null\)/.test(gecmis));
kontrol("mobil geçmiş: iz yalnız ?silinen=iz isteyene (varsayılan gizle)",
  /get\("silinen"\)\s*===\s*"iz"\s*\?\s*"iz"\s*:\s*"gizle"/.test(K.ucSohbet));
kontrol("yönetici listesi: silinmiş mesajda govde null",
  /govde:\s*silindi\s*\?\s*null\s*:\s*m\.body/.test(K.mod));
kontrol("silme sonrası liste önizlemesi tazeleniyor",
  /await\s+onizlemeTazele\(/.test(bolge(K.mod, "export async function mesajSil")));
kontrol("silme yumuşak: deleted_at + deleted_by, satır SİLİNMİYOR",
  /deleted_at:[\s\S]{0,60}deleted_by:/.test(bolge(K.mod, "export async function mesajSil")) &&
    !/from\("messages"\)[\s\S]{0,40}\.delete\(/.test(K.mod));

// ══ 4 · YÖNETİCİ İŞLERİ İKİ HATLI ═════════════════════════════════════════
for (const [ad, kod] of [["sil ucu", K.ucSil], ["bildirimler ucu", K.ucBildirimler], ["çöz ucu", K.ucCoz]]) {
  kontrol(`${ad}: requireMobileAdmin`, /requireMobileAdmin\(req\)/.test(kod) && !/requireMobileWorkerScoped/.test(kod));
}
for (const f of ["mesajSil", "bildirimListesi", "bildirimCoz"]) {
  kontrol(`çekirdek ${f}: is_admin denetimi (ikinci hat)`,
    /if\s*\(\s*!yoneticiMi\(actor\)\s*\)\s*return\s*\{\s*ok:\s*false,\s*status:\s*403/.test(bolge(K.mod, `export async function ${f}`)));
}
kontrol("panel sayfası requireAdmin", /await\s+requireAdmin\(\)/.test(K.panelSayfa) && !/requireFleetView/.test(K.panelSayfa));
for (const f of ["mesajSilAction", "bildirimlerAction", "bildirimCozAction", "pasifeAlAction"]) {
  kontrol(`panel ${f}: requireAdmin`, /await\s+requireAdmin\(\)/.test(bolge(K.panel, `export async function ${f}`)));
}
kontrol("liste ucu: bildirim sayısı yalnız yöneticiye",
  /worker\.is_admin\s*\?\s*await\s+acikBildirimSayisi\(\)\s*:\s*null/.test(K.ucListe));
kontrol("bildir ve engelle uçları üç rolü kabul ediyor (requireMobileWorkerScoped)",
  [K.ucBildir, K.ucEngeller, K.ucEngelKaldir].every((k) => /requireMobileWorkerScoped\(req\)/.test(k)));

// ══ 5 · BİLDİRİM PUSH'U METİN TAŞIMAZ ═════════════════════════════════════
const sikayet = bolge(K.push, "export async function mesajSikayetiBildir");
kontrol("şikâyet push'u mesaj tablosunu okumuyor ve tur=mesaj_bildirimi",
  sikayet.length > 0 && !/from\("messages"\)/.test(sikayet) && /tur:\s*"mesaj_bildirimi"/.test(sikayet));
kontrol("şikâyet push'u yalnız aktif yöneticilere, bildiren hariç",
  /\.eq\("is_admin",\s*true\)/.test(sikayet) && /id\s*!==\s*g\.bildirenId/.test(sikayet));

// ══ 6 · MIGRATION + KURULUM ═══════════════════════════════════════════════
const m = K.migration;
kontrol("111 iki tabloyu kuruyor",
  /create table if not exists public\.mesaj_bildirimleri/.test(m) && /create table if not exists public\.mesaj_engeller/.test(m));
kontrol("111 açık bildirimi kısmi tekil indeksle koruyor",
  /create unique index if not exists mesaj_bildirimleri_acik_tekil[\s\S]{0,140}where durum = 'open'/.test(m));
kontrol("111 kendini engellemeyi şemada reddediyor", /check \(engelleyen_id <> engellenen_id\)/.test(m));
kontrol("111 RLS kapalı (deponun kuralı)",
  /alter table public\.mesaj_bildirimleri disable row level security/.test(m) &&
    /alter table public\.mesaj_engeller\s+disable row level security/.test(m));
kontrol("111 kurulum listesinde (ORDER)", /"111_mesaj_bildir_engelle\.sql"/.test(K.kurulum));

// ══ 7 · İNGİLİZCE METİNLER ════════════════════════════════════════════════
const BEKLENEN_EN = {
  reportMessage: "Report message",
  blockUser: "Block user",
  blockedUsers: "Blocked users",
  reportedTitle: "Reported messages",
  removedByAdmin: "Message removed by an administrator",
  errFiltered: "Message not sent: it contains language that is not allowed.",
  deactivateUser: "Deactivate user",
  reported: "Reported. The company's administrators will review it.",
};
const enFark = Object.entries(BEKLENEN_EN).filter(([k, v]) => K.en[k] !== v).map(([k]) => k);
kontrol("panel EN metinleri ('Report' / 'Block' aynen)", enFark.length === 0, enFark.join(", "));

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ MESAJ BİLDİR/ENGELLE MUHAFIZI — ${dusen} bulgu (yukarıda) · ${gecen} geçti.`);
  process.exit(1);
}
console.log(
  `✓ mesaj bildir/engelle: ${gecen} denetim — süzgeç tek kapıda · engel sunucuda (yalnız grup) · ` +
    "silinen metin gitmez · yönetici işleri iki hatlı · push metinsiz · 111 kurulumda."
);
