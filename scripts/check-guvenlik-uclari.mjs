#!/usr/bin/env node
/**
 * GÜVENLİK UÇLARI MUHAFIZI — kaynak denetimi (Faz D-5).
 *
 * ═══ NE KORUYOR ═══
 *
 * 1. **SESSİZ BOŞ LİSTE YASAK.** `lib/security-read.ts` ve `lib/access-read.ts`
 *    bayrak kapalıyken BOŞ DİZİ döner — panel için doğru, API için yalan.
 *    Her uç çekirdeği ÇAĞIRMADAN ÖNCE bayrağa bakıp `katman:"kapali"`
 *    dönmek zorunda. Bu kuralın tek koruyucusu bu betik: çekirdekler sessizce
 *    boş dönmeye devam ediyor ve bir gün eklenen yeni bir uç kolayca "0 kayıt"
 *    diyebilir.
 *
 * 2. **PATRON KAPISI + SIRASI.** Altı ucun altısı da `requireMobileOwner`.
 *    Kapının içinde sıra kuralın kendisi: yönetici → katman → patron. Şoför
 *    katman durumunu bile öğrenmemeli.
 *
 * 3. **🔴 TEK OTURUM KESİLEMEZ.** Üründe iptal KİŞİ ekseninde
 *    (`session_version`/`token_version`); tek satır kapatmak kimseyi çıkarmaz.
 *    Kesme ucu `kapsam:"hepsi"` istemek ZORUNDA ve tek satır kapatan bir
 *    çağrı (`closeLoginSession`) içeremez — yoksa güvenlik ekranında yalan
 *    söyleyen bir düğme doğar.
 *
 * 4. **ANAHTAR: İKİ AŞAMA, ÇEKİRDEKTEN.** Uç `activateKillSwitch`i DOĞRUDAN
 *    çağıramaz; `anahtarCek` üzerinden geçmek zorunda (onay metni → kilit →
 *    cevap → iz sırası orada). Geri alma gizli soru İSTEMEZ.
 *
 * 5. **KOPYA KURAL YOK.** Saat biçimi, "iki uç birlikte", "yalnız bekleyen
 *    satır" ve oturum kesme kuralları `lib/guvenlik-eylem.ts`te; hem panel
 *    action'ları hem mobil uçlar AYNI fonksiyonları çağırıyor.
 *
 * 6. **`allowed_countries` YAZILMAZ.** Üründe yazıcısı yok; mobilde açmak
 *    kuralı ilk kez orada tanımlamak olurdu.
 *
 * Kullanım: npm run lint:guvenlik-uclari
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/** Bir fonksiyon çağrısının KENDİ argüman listesi — parantez sayarak. */
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

let dusen = 0;
const kontrol = (ad, gecti, ek) => {
  if (gecti) return;
  dusen++;
  console.error(`  ✗ ${ad}${ek ? `\n      ${ek}` : ""}`);
};

// ── uç envanteri: dizindeki TÜM route.ts dosyaları ────────────────────────
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

const UCLAR = routeYollari("app/api/mobile/guvenlik");
const BEKLENEN = [
  "app/api/mobile/guvenlik/denetim/route.ts",
  "app/api/mobile/guvenlik/erisim/[workerId]/route.ts",
  "app/api/mobile/guvenlik/kill-switch/route.ts",
  "app/api/mobile/guvenlik/onaylar/[id]/route.ts",
  "app/api/mobile/guvenlik/onaylar/route.ts",
  "app/api/mobile/guvenlik/oturumlar/[id]/kes/route.ts",
  "app/api/mobile/guvenlik/oturumlar/route.ts",
  "app/api/mobile/guvenlik/route.ts",
];

const kod = Object.fromEntries(UCLAR.map((p) => [p, kodu(oku(p))]));
const lib = {
  eylem: kodu(oku("lib/guvenlik-eylem.ts")),
  scope: kodu(oku("lib/mobile-scope.ts")),
  mg: kodu(oku("lib/mobile-guvenlik.ts")),
  secRead: kodu(oku("lib/security-read.ts")),
  accRead: kodu(oku("lib/access-read.ts")),
  panelSec: kodu(oku("app/actions/security.ts")),
  panelAcc: kodu(oku("app/actions/access.ts")),
};

const KES = "app/api/mobile/guvenlik/oturumlar/[id]/kes/route.ts";
const ANAHTAR = "app/api/mobile/guvenlik/kill-switch/route.ts";
const ERISIM = "app/api/mobile/guvenlik/erisim/[workerId]/route.ts";
const ONAY_KARAR = "app/api/mobile/guvenlik/onaylar/[id]/route.ts";

// ══ 0 · ENVANTER ══════════════════════════════════════════════════════════
kontrol(
  "sekiz route dosyasının hepsi yerinde",
  BEKLENEN.every((b) => UCLAR.includes(b)) && UCLAR.length === BEKLENEN.length,
  `bulunan (${UCLAR.length}): ${UCLAR.join(", ")}`
);

// ══ 1 · SESSİZ BOŞ LİSTE YASAK ════════════════════════════════════════════
for (const [p, k] of Object.entries(kod)) {
  const ad = p.replace("app/api/mobile/guvenlik", "").replace("/route.ts", "") || "/";
  kontrol(
    `${ad}: katman kapalıysa açıkça söylüyor`,
    /katmanKapaliYanit\s*\(/.test(k),
    "🔴 çekirdek bayrak kapalıyken BOŞ DİZİ döner — API için bu yalan"
  );
  kontrol(
    `${ad}: gövdede katman/kapilar durumu taşınıyor`,
    /katmanDurumu\s*\(/.test(k) || /katmanKapaliYanit\s*\(/.test(k),
    "istemci hangi kurulumda olduğunu okuyabilmeli"
  );
  kontrol(
    `${ad}: katman denetimi ÇEKİRDEK ÇAĞRISINDAN ÖNCE`,
    k.indexOf("katmanKapaliYanit") < (k.indexOf("await Promise.all") + 1 || 1e9),
    "sıra kuralın kendisi: önce bayrak, sonra sorgu"
  );
}

/** Kapılara bağlı dört uç ayrıca ACCESS_GATES_ENABLED'ı ayırıyor mu. */
for (const p of [
  "app/api/mobile/guvenlik/onaylar/route.ts",
  ONAY_KARAR,
  ERISIM,
  ANAHTAR,
]) {
  kontrol(
    `${p.replace("app/api/mobile/guvenlik", "")}: kapılar kapalıysa AYRI cevap`,
    /kapilarKapaliYanit\s*\(/.test(kod[p]),
    "iki bayrak bağımsız: katman açık + kapılar kapalı kurulumda 0 yazmak yalan olur"
  );
}

// ══ 2 · PATRON KAPISI + SIRASI ════════════════════════════════════════════
for (const [p, k] of Object.entries(kod)) {
  const ad = p.replace("app/api/mobile/guvenlik", "");
  kontrol(`${ad}: requireMobileOwner`, /requireMobileOwner\s*\(/.test(k), "panelde requireOwner");
  kontrol(
    `${ad}: daha gevşek bir kapı kullanılmıyor`,
    !/requireMobileFleetView|requireMobileWorkerScoped|requireMobileWorker\s*\(/.test(k),
    "🔴 güvenlik yüzeyi patron kademesinin altına açılmaz"
  );
}
kontrol(
  "requireMobileOwner tanımlı ve is_owner'ı DB'den soruyor",
  /export async function requireMobileOwner/.test(lib.scope) && /isOwnerWorker\s*\(/.test(lib.scope),
  "rol token'daki iddiadan okunmaz"
);
{
  const g = lib.scope.slice(lib.scope.indexOf("export async function requireMobileOwner"));
  const iAdmin = g.indexOf("is_admin");
  const iKatman = g.indexOf("SECURITY_LAYER_ENABLED");
  const iOwner = g.indexOf("isOwnerWorker");
  kontrol(
    "kapı sırası: yönetici → katman → patron",
    iAdmin > -1 && iKatman > iAdmin && iOwner > iKatman,
    `🔴 sıra bozulursa ya şoför katman durumunu öğrenir ya da katman kapalı kiracıda uç kalıcı 403 döner  [${iAdmin}/${iKatman}/${iOwner}]`
  );
}

// ══ 3 · 🔴 TEK OTURUM KESİLEMEZ ═══════════════════════════════════════════
kontrol(
  "kes: kapsam AÇIK onay istiyor (hepsi)",
  /kapsam\s*!==\s*"hepsi"/.test(kod[KES]),
  "🔴 sessizce genişletmek: 'bir cihazı attım' sanan patron tüm cihazları düşürür"
);
kontrol(
  "kes: sebep gövdede adlandırılmış",
  /tek_oturum_kesilemez/.test(kod[KES]),
  "istemci NEDEN olmadığını öğrenmeli"
);
kontrol(
  "kes: tek satır kapatan çağrı YOK",
  !/closeLoginSession\s*\(/.test(kod[KES]),
  "🔴 satırı kapatmak kimseyi çıkarmaz — 'bitti' görünür, kişi çalışmaya devam eder"
);
kontrol(
  "kes: çekirdek oturumlariKes çağrılıyor",
  /oturumlariKes\s*\(/.test(kod[KES]),
  "panel action'ı da aynı fonksiyonu çağırıyor"
);
/**
 * YAZMA aranıyor, kelime değil: uçların açıklama DİZELERİ kolon adlarını
 * anlatmak için içeriyor ("… workers.session_version + token_version …") ve
 * `kodu()` dize sabitlerini bilerek koruyor. Yasak olan, kolonu bir güncelleme
 * gövdesine ANAHTAR olarak yazmak. (Arıza enjeksiyonunda yakalandı.)
 */
const yazmaAnahtari = (k, kolon) => new RegExp(`${kolon}\\s*:`).test(k);

kontrol(
  "kes: sayaçlar uçta elle artırılmıyor",
  !yazmaAnahtari(kod[KES], "session_version") && !yazmaAnahtari(kod[KES], "token_version"),
  "sayaç aritmetiği tek yerde (lib/security-log.ts + lib/mobile-auth.ts)"
);
kontrol(
  "kes: önce/sonra ÖLÇÜLÜYOR (ok:true bir ölçüm değildir)",
  /once/.test(kod[KES]) && /sonra/.test(kod[KES]) && /sessionSayfasi\s*\(/.test(kod[KES]),
  "kesmenin gerçekten bir şey yaptığı gövdede sayı olarak dursun"
);

// ══ 4 · ANAHTAR ═══════════════════════════════════════════════════════════
kontrol(
  "anahtar: çekirdek anahtarCek çağrılıyor",
  /anahtarCek\s*\(/.test(kod[ANAHTAR]),
  "onay→kilit→cevap→iz sırası orada"
);
kontrol(
  "anahtar: activateKillSwitch DOĞRUDAN çağrılmıyor",
  !/activateKillSwitch\s*\(/.test(kod[ANAHTAR]),
  "🔴 doğrudan çağrı iki aşamalı doğrulamayı ATLAR"
);
kontrol(
  "anahtar: verifySecret uçta değil çekirdekte",
  !/verifySecret\s*\(/.test(kod[ANAHTAR]),
  "kilit denetimi cevaptan ÖNCE gelmek zorunda"
);
kontrol(
  "anahtar: onay metni sabiti çekirdekten",
  /ANAHTAR_ONAY_METNI/.test(kod[ANAHTAR]) && /export const ANAHTAR_ONAY_METNI/.test(lib.eylem),
  "iki yüzeyde iki farklı kelime olamaz"
);
kontrol(
  "anahtar: geri alma gizli soru İSTEMİYOR",
  (() => {
    const i = kod[ANAHTAR].indexOf('islem === "kapa"');
    if (i < 0) return false;
    const blok = kod[ANAHTAR].slice(i, i + 900);
    return /anahtarGeriAl\s*\(/.test(blok) && !/cevap/.test(blok);
  })(),
  "kapatmak yıkıcı, açmak onarıcı — geri almayı kilitlemek patronu dışarıda bırakır"
);
kontrol(
  "anahtar: gövde sistem durumunu AYRI alanda söylüyor",
  /sistemDurumu/.test(kod[ANAHTAR]),
  "🔴 'ac' anahtarı açar, SİSTEMİ KAPATIR — istemci kelimeye değil alana baksın"
);
kontrol(
  "anahtar: kalan hak gövdede",
  /kalanHak/.test(kod[ANAHTAR]),
  "üçüncü yanlışta 24 saat kilit — kullanıcı kaç hakkı kaldığını görmeli"
);
kontrol(
  "çekirdek: kilit denetimi cevap doğrulamasından ÖNCE",
  (() => {
    /**
     * ⚠️ ARIZA ENJEKSİYONUNDA YAKALANDI: bu kontrol önce dosyanın TAMAMINDA
     * sıraya bakıyordu ve `verifySecret` en üstteki İMPORT satırında da
     * geçtiği için her zaman "önce" çıkıyordu — sırayı tersine çeviren
     * enjeksiyon kaçtı. Artık yalnız `anahtarCek` GÖVDESİ okunuyor.
     */
    const i = lib.eylem.indexOf("export async function anahtarCek");
    if (i < 0) return false;
    const govde = lib.eylem.slice(i);
    const iKilit = govde.indexOf("getKillSwitchState");
    const iCevap = govde.indexOf("verifySecret");
    return iKilit > -1 && iCevap > -1 && iKilit < iCevap;
  })(),
  "🔴 tersi olsaydı kilitli anahtarda da cevap denenebilirdi"
);

// ══ 5 · KOPYA KURAL YOK ═══════════════════════════════════════════════════
const TEK_KAYNAK = [
  ["oturumlariKes", lib.panelSec],
  ["onayKarari", lib.panelAcc],
  ["saatleriDenetle", lib.panelAcc],
  ["saatleriYaz", lib.panelAcc],
  ["muafiyetYaz", lib.panelAcc],
  ["anahtarCek", lib.panelAcc],
  ["anahtarGeriAl", lib.panelAcc],
];
for (const [fn, panel] of TEK_KAYNAK) {
  kontrol(`çekirdek ${fn} lib'de tanımlı`, new RegExp(`export (async )?function ${fn}`).test(lib.eylem));
  kontrol(
    `panel action'ı da ${fn} kullanıyor`,
    new RegExp(`\\b${fn}\\s*\\(`).test(panel),
    "iki yüzey tek kaynaktan beslenmeli"
  );
}
kontrol(
  "erisim: saat biçimi uçta yeniden yazılmamış",
  // `\d{...}` KAÇIŞLI hâliyle aranıyor: uçta bir saat regex'i varsa kaynakta
  // bu dizi geçer. UUID kalıbı `[0-9a-f]{8}` kullanıyor, ona takılmaz.
  !kod[ERISIM].includes("\\d{"),
  "🔴 ikinci bir regex, panel ile telefonu sessizce ayrıştırır"
);
kontrol(
  "erisim: saatleriDenetle çağrılıyor",
  /saatleriDenetle\s*\(/.test(kod[ERISIM])
);
kontrol(
  "onay kararı: pending koşulu uçta tekrarlanmıyor",
  !/status.*pending.*update|update.*status.*pending/s.test(kod[ONAY_KARAR]),
  "yalnız-bekleyen kuralı çekirdekte"
);
kontrol(
  "onay kararı: çekirdek onayKarari çağrılıyor",
  /onayKarari\s*\(/.test(kod[ONAY_KARAR])
);
kontrol(
  "sayfalı okuma tek çeviriciden (listSessions sarmalayıcı oldu)",
  /export async function sessionSayfasi/.test(lib.secRead) &&
    /const \{ satirlar \} = await sessionSayfasi/.test(lib.secRead),
  "panel ve mobil aynı satır çevirisini kullanmalı"
);
kontrol(
  "denetim izi tek çeviriciden (listAudit sarmalayıcı oldu)",
  /export async function auditSayfasi/.test(lib.secRead) &&
    /const \{ satirlar \} = await auditSayfasi/.test(lib.secRead),
  "metaDegisim maskelemesi ikinci kez yazılmamalı"
);

// ══ 6 · allowed_countries YAZILMAZ ════════════════════════════════════════
for (const [p, k] of Object.entries(kod)) {
  kontrol(
    `${p.replace("app/api/mobile/guvenlik", "")}: allowed_countries YAZILMIYOR`,
    !yazmaAnahtari(k, "allowed_countries"),
    "🔴 üründe yazıcısı yok; mobilde açmak kuralı ilk kez orada tanımlamak olur"
  );
}
kontrol(
  "erisim: ülke yazma yolunun olmadığı gövdede yazılı",
  /ulke_yazma_yolu_yok/.test(kod[ERISIM]) && /yazilabilir/.test(kod[ERISIM]),
  "istemci olmayan alanı düzenlemeye kalkmasın"
);
kontrol(
  "çekirdekte de allowed_countries güncellemesi yok",
  !/allowed_countries/.test(lib.eylem)
);

// ══ 7 · DENETİM İZİ EKSİKLİĞİ SÖYLENİYOR ══════════════════════════════════
kontrol(
  "denetim: yalnız audit_log olduğu gövdede yazılı",
  /birlesikDegil/.test(kod["app/api/mobile/guvenlik/denetim/route.ts"]) &&
    /disaridaKalanKaynaklar/.test(kod["app/api/mobile/guvenlik/denetim/route.ts"]),
  "🔴 sessiz eksik, izin TAMAMI sanılmasına yol açar"
);
kontrol(
  "onaylar: 100 tavanı ve kırpılma gövdede",
  // TAM ANAHTAR aranıyor: `kirpildi` alt dizesi `kirpildiKaldirildi` içinde de
  // geçiyor ve enjeksiyon tam oradan kaçmıştı.
  /\btavan\s*:/.test(kod["app/api/mobile/guvenlik/onaylar/route.ts"]) &&
    /\bkirpildi\s*:/.test(kod["app/api/mobile/guvenlik/onaylar/route.ts"]),
  "sessiz kırpma yasak (PostgREST 1000 satır dersi)"
);

// ══ 8 · YAZMA UÇLARI İZ BIRAKIYOR ═════════════════════════════════════════
for (const p of [KES, ONAY_KARAR, ERISIM, ANAHTAR]) {
  const cekirdekler = ["oturumlariKes", "onayKarari", "saatleriYaz", "muafiyetYaz", "anahtarCek", "anahtarGeriAl"];
  kontrol(
    `${p.replace("app/api/mobile/guvenlik", "")}: iz yazan çekirdek çağrılıyor`,
    cekirdekler.some((f) => new RegExp(`\\b${f}\\s*\\(`).test(kod[p])),
    "her yazma audit_log'a düşmeli"
  );
}
for (const fn of ["oturumlariKes", "onayKarari", "saatleriYaz", "anahtarCek", "anahtarGeriAl"]) {
  const govde = cagriArgumanlari(lib.eylem, fn);
  kontrol(
    `çekirdek ${fn} aktör kimliğini ARGÜMAN olarak alıyor`,
    govde.length > 0 && /actorId/.test(lib.eylem),
    "iz kimsiz yazılamaz"
  );
}
kontrol(
  "çekirdek audit / auditChange çağırıyor",
  /\baudit\s*\(/.test(lib.eylem) && /auditChange\s*\(/.test(lib.eylem)
);

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ GÜVENLİK UÇLARI MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log(
  "✓ güvenlik uçları: sessiz boş liste yok · patron kapısı ve sırası · tek oturum kesilemez " +
    "(kapsam açık) · anahtar iki aşama çekirdekten · tek kaynak kural · ülke yazılmıyor."
);
