#!/usr/bin/env node
/**
 * AI ASİSTAN MUHAFIZI — kaynak denetimi (v1, 23.09.2026).
 *
 * ═══ NEDEN BU MUHAFIZ VAR ═══
 *
 * Asistan bu üründeki diğer her uçtan iki bakımdan farklı: (a) kararı bir dil
 * modeli veriyor, (b) müşteri verisi bir DIŞ SAĞLAYICIYA gidiyor. İkisi de
 * derleyicinin göremeyeceği sınıfta hata üretir — `npx tsc` bir aracın yanlış
 * kapıya bağlandığını ya da bir yazma ucunun listeye sızdığını söylemez. Bu
 * betik onları söyler.
 *
 * ── 1 · YAZMA ARACI YOK ───────────────────────────────────────────────────
 *    Dokuz aracın dokuzu da `GET`. Araç katmanı `supabaseAdmin`i İÇE
 *    AKTARMAZ; yazma yolunun var olmaması, yazmanın yasak olmasından güçlüdür.
 *
 * ── 2 · 🔴 KAPI, UCUN KENDİ KAPISIYLA AYNI ────────────────────────────────
 *    Bu muhafızın en değerli kuralı. Uçların kapıları AYNI DEĞİL: dört uç
 *    `requireMobileFleetView`, beşi `requireMobileAdmin`. Araç listesi role
 *    göre süzülüyor ve süzgeç `kapi` alanından okunuyor. Bir gün bir ucun
 *    kapısı değişirse (ya da yeni bir araç yanlış `kapi` ile eklenirse) filo
 *    şefi panelde giremediği veriyi asistan üzerinden okur. Betik her aracın
 *    `kapi` alanını, ucun GET GÖVDESİNDEKİ gerçek kapıyla karşılaştırır.
 *
 * ── 3 · KAPSAM SUNUCUDAN, GÖVDEDEN ASLA ───────────────────────────────────
 *    Uç gövdeden YALNIZ `mesajlar` ve `dil` okur. Kimlik `Authorization`
 *    başlığından, kapsam o kimlikten DB'de çözülür. Modelin ürettiği argüman
 *    yalnız süzgeçtir.
 *
 * ── 4 · RAPOR VE GÜVENLİK UÇLARI ARAÇ DEĞİL ───────────────────────────────
 *    `/reports/*` bir BELGE üretir (asistanın işi değil), `/guvenlik/*` patron
 *    kademesidir. İkisi de listeye HİÇ girmemeli.
 *
 * ── 5 · ANAHTAR SIZMAZ ────────────────────────────────────────────────────
 *    `ANTHROPIC_API_KEY` tek bir yerde okunur, hiçbir yere yazılmaz, uçta
 *    `console.*` yoktur ve istemciye dönen hata gövdesi sağlayıcı mesajını
 *    taşımaz.
 *
 * ── 6 · ARAÇ KATMANINDA ARİTMETİK YOK ─────────────────────────────────────
 *    Daraltma yalnız SEÇME ve KESME'dir. Burada hesaplanan bir sayı, hiçbir
 *    ekranda bulunmayan üçüncü bir sayı olurdu (`lib/asistan-araclar.ts` §3).
 *
 * ── 7 · SİSTEM İSTEMİ DURAĞAN ─────────────────────────────────────────────
 *    İçine tarih/rastgele girerse prompt cache hiç tutmaz ve bunu yalnız
 *    faturada fark ederiz. Betik istem dosyasında zaman/rastgele/env arar.
 *
 * ── 8 · HIZ SINIRI VAR VE FAIL-CLOSED ─────────────────────────────────────
 *    Kredi model çağrısından ÖNCE düşülür; sayaç okunamazsa istek REDDEDİLİR.
 *
 * Kullanım: npm run lint:asistan
 */
import { existsSync, readFileSync } from "node:fs";
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
 * Yorumları söker, dize sabitlerini KORUR.
 *
 * Kuralı ANLATAN yorum kapıyı açmasın: bu dosyanın başlığı "supabaseAdmin
 * kullanılmaz" diye yazıyor ve ham metinde arama yapan bir kontrol o cümleyi
 * ihlal sanırdı. (Kardeş muhafızların hepsinde aynı yardımcı, aynı gerekçe.)
 */
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

/**
 * Yorumları VE dize/şablon sabitlerini söker — yalnız çıplak kod kalır.
 *
 * Aritmetik denetimi (§6) bunu kullanır: araç açıklamaları `"…" + "…"` diye
 * birleştiriliyor ve URL şablonları eğik çizgi taşıyor. İkisi de hesap değil;
 * ham metinde arasaydık her ikisi de yanlış alarm verirdi.
 */
function kodSade(kaynak) {
  let cikti = "";
  let d = "kod";
  for (let i = 0; i < kaynak.length; i++) {
    const c = kaynak[i];
    const s2 = kaynak.slice(i, i + 2);
    if (d === "kod") {
      if (s2 === "//") { d = "satir"; i++; continue; }
      if (s2 === "/*") { d = "blok"; i++; continue; }
      if (c === "'") { d = "tek"; continue; }
      if (c === '"') { d = "cift"; continue; }
      if (c === "`") { d = "sablon"; continue; }
      cikti += c;
      continue;
    }
    if (d === "satir") { if (c === "\n") { d = "kod"; cikti += c; } continue; }
    if (d === "blok") { if (s2 === "*/") { d = "kod"; i++; } continue; }
    if (c === "\\") { i++; continue; }
    if ((d === "tek" && c === "'") || (d === "cift" && c === '"') || (d === "sablon" && c === "`")) {
      d = "kod";
    }
  }
  return cikti;
}

/** `export async function GET` gövdesi — bir sonraki üst düzey export'a kadar. */
function getGovdesi(kaynak) {
  const i = kaynak.indexOf("export async function GET");
  if (i < 0) return "";
  const kalan = kaynak.slice(i + 10);
  const j = kalan.search(/\nexport (async )?(function|const) /);
  return j < 0 ? kalan : kalan.slice(0, j);
}

let dusen = 0;
const kontrol = (ad, gecti, ek) => {
  if (gecti) return;
  dusen++;
  console.error(`  ✗ ${ad}${ek ? `\n      ${ek}` : ""}`);
};

// ── dosyalar ────────────────────────────────────────────────────────────────

const UC = "app/api/mobile/asistan/route.ts";
const ARACLAR = "lib/asistan-araclar.ts";
const ISTEM = "lib/asistan-istem.ts";
const HIZ = "lib/asistan-hiz.ts";

const hamUc = oku(UC);
const hamAraclar = oku(ARACLAR);
const hamIstem = oku(ISTEM);
const hamHiz = oku(HIZ);

const kod = {
  uc: kodu(hamUc),
  araclar: kodu(hamAraclar),
  istem: kodu(hamIstem),
  hiz: kodu(hamHiz),
  scope: kodu(oku("lib/mobile-scope.ts")),
  tenant: kodu(oku("lib/tenant.ts")),
};

/**
 * ARAÇ ENVANTERİ — ad → (kapı, uç yolu, route dosyası).
 *
 * Bu tablo betiğin kendi kaydıdır: kaynaktan TÜRETİLMEZ, kaynakla KARŞILAŞTIRILIR.
 * Türetseydik yanlış `kapi` ile eklenen bir araç kendi yanlışını doğrulardı.
 */
const BEKLENEN = [
  ["filo_panosu", "filo", "app/api/mobile/dashboard/route.ts"],
  ["filo_analizi", "yonetici", "app/api/mobile/analytics/route.ts"],
  ["alarmlar", "yonetici", "app/api/mobile/alarms/route.ts"],
  ["sofor_skorlari", "yonetici", "app/api/mobile/driver-scores/route.ts"],
  ["filo_araclari", "yonetici", "app/api/mobile/vehicles/route.ts"],
  ["arac_ozeti", "yonetici", "app/api/mobile/vehicles/[id]/ozet/route.ts"],
  ["is_emirleri", "filo", "app/api/mobile/is-emirleri/route.ts"],
  ["izin_takvimi", "filo", "app/api/mobile/leaves/route.ts"],
  ["mevzuat_panosu", "filo", "app/api/mobile/mevzuat/route.ts"],
];

/** Kaynaktaki araç tanımları: `ad:`/`kapi:` çiftleri, yazıldıkları sırayla. */
function aracTanimlari(kaynak) {
  const cikti = [];
  const kalip = /\bad:\s*"([a-z_]+)"\s*,\s*kapi:\s*"(yonetici|filo)"/g;
  let m;
  while ((m = kalip.exec(kaynak)) !== null) cikti.push([m[1], m[2]]);
  return cikti;
}

const TANIMLAR = aracTanimlari(hamAraclar);

// ══ 0 · ENVANTER ══════════════════════════════════════════════════════════
kontrol(
  "dokuz araç, beklenen ad ve kapı ile tanımlı",
  TANIMLAR.length === BEKLENEN.length &&
    TANIMLAR.every(([ad, kapi], i) => ad === BEKLENEN[i][0] && kapi === BEKLENEN[i][1]),
  `bulunan: ${JSON.stringify(TANIMLAR)}`
);

// ══ 1 · YAZMA ARACI YOK ═══════════════════════════════════════════════════
/**
 * ⚠️ ARIZA ENJEKSİYONUNDA YAKALANDI (23.09.2026). Bu kontrol önce
 * `import {` hemen ardındaki ismi arıyordu:
 *
 *     !/import\s*\{\s*(POST|PATCH|PUT|DELETE)\b/
 *
 * Enjeksiyon `import { GET as izinUc, POST as izinYaz } from …` yazdı ve
 * KAÇTI — yazma işleyicisi listenin İKİNCİ elemanıydı. Artık fiil adı
 * dosyanın HİÇBİR YERİNDE aranmıyor: yorumlar zaten sökülü (`kodu`), dize
 * sabitleri korunuyor ama araç açıklamalarında bu fiiller geçmiyor.
 */
kontrol(
  "araç katmanında yazma fiili HİÇ geçmiyor",
  !/\b(POST|PATCH|PUT|DELETE)\b/.test(kod.araclar),
  "🔴 yazma işleyicisi içe aktarılmış — asistan salt okumadır"
);
kontrol(
  "araç katmanında GET içe aktarma sayısı araç sayısıyla eşit",
  (kod.araclar.match(/import\s*\{\s*GET as /g) ?? []).length === BEKLENEN.length,
  "her araç bir uca bağlı olmalı; fazlası listede olmayan bir yüzey demek"
);
kontrol(
  "araç katmanı supabaseAdmin İÇE AKTARMIYOR",
  !/from\s*"@\/lib\/supabase"/.test(kod.araclar),
  "🔴 yazma yolunun var OLMAMASI, yazmanın yasak olmasından güçlüdür"
);
for (const yasak of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
  kontrol(
    `araç katmanında ${yasak} yok`,
    !kod.araclar.includes(yasak),
    "salt okuma sözleşmesi"
  );
}
kontrol(
  "uç YALNIZ POST tanımlıyor (GET/PATCH/DELETE yok)",
  /export async function POST/.test(kod.uc) &&
    !/export async function (GET|PATCH|PUT|DELETE)/.test(kod.uc),
  "asistan tek bir yüzeydir; ikinci bir fiil ikinci bir sözleşme demek"
);

// ══ 2 · 🔴 KAPI, UCUN KENDİ KAPISIYLA AYNI ════════════════════════════════
for (const [ad, kapi, dosya] of BEKLENEN) {
  const govde = getGovdesi(kodu(oku(dosya)));
  const admin = /requireMobileAdmin\s*\(/.test(govde);
  const filo = /requireMobileFleetView\s*\(/.test(govde);
  kontrol(
    `${ad}: ucun GET kapısı tek ve tanınıyor (${dosya})`,
    admin !== filo,
    `admin=${admin} fleetView=${filo} — başka bir kapı kullanılmışsa bu tablo güncellenmeli`
  );
  kontrol(
    `${ad}: kapi="${kapi}" ucun gerçek kapısıyla eşleşiyor`,
    (kapi === "yonetici" && admin) || (kapi === "filo" && filo),
    `🔴 uç ${admin ? "requireMobileAdmin" : "requireMobileFleetView"} kullanıyor; ` +
      `kapi="${kapi}" yazmak filo şefine panelde kapalı olan veriyi açar`
  );
}
kontrol(
  "araç listesi role göre süzülüyor",
  /export function araclarFor/.test(kod.araclar) &&
    /a\.kapi === "filo"/.test(kod.araclar),
  "yönetici olmayan aktöre yönetici araçları verilmemeli"
);
kontrol(
  "uç zemin kapısı requireMobileFleetView",
  /requireMobileFleetView\s*\(/.test(kod.uc),
  "şoför 403 almalı"
);
kontrol(
  "uçta daha gevşek bir kapı YOK",
  !/requireMobileWorkerScoped\s*\(|requireMobileWorker\s*\(/.test(kod.uc),
  "🔴 şoför asistana girmemeli — ayrı araç kümesi, ayrı kapsam kararıdır"
);

// ══ 3 · KAPSAM SUNUCUDAN, GÖVDEDEN ASLA ═══════════════════════════════════
{
  const alanlar = [...kod.uc.matchAll(/\bgovde\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const izinli = new Set(["mesajlar", "dil"]);
  const fazla = [...new Set(alanlar)].filter((a) => !izinli.has(a));
  kontrol(
    "gövdeden YALNIZ mesajlar ve dil okunuyor",
    fazla.length === 0,
    `🔴 fazladan okunan alan: ${fazla.join(", ")} — kimlik/kapsam gövdeden gelemez`
  );
}
kontrol(
  "yetki başlığı istekten alınıyor",
  /yetkiBasligi:\s*req\.headers\.get\("authorization"\)/.test(kod.uc),
  "kimliğin tek kaynağı Authorization başlığıdır"
);
kontrol(
  "araç katmanı başlığı YALNIZ bağlamdan yazıyor",
  (kod.araclar.match(/authorization:/g) ?? []).length === 1 &&
    /authorization:\s*ctx\.yetkiBasligi/.test(kod.araclar),
  "🔴 ikinci bir başlık kaynağı, kimliği modelin eline verirdi"
);
kontrol(
  "araç şemaları kapalı (additionalProperties: false)",
  (hamAraclar.match(/additionalProperties: false/g) ?? []).length >= BEKLENEN.length,
  "modelin uydurduğu bir alan sessizce sorguya geçmemeli"
);
kontrol(
  "araç katmanında ikinci bir kapsam tanımı yok",
  !/getFleetScope\s*\(|getManagedFleet\s*\(|UNRESTRICTED/.test(kod.araclar),
  "🔴 kapsamı burada kurmak, ucun kapsamından ayrışan ikinci bir gerçek üretir"
);

// ══ 4 · RAPOR VE GÜVENLİK UÇLARI ARAÇ DEĞİL ═══════════════════════════════
for (const yasak of ["/api/mobile/reports", "/api/mobile/guvenlik", "requireMobileOwner"]) {
  kontrol(
    `araç katmanında ${yasak} yok`,
    !hamAraclar.includes(yasak) || !kodu(hamAraclar).includes(yasak),
    yasak.includes("reports")
      ? "🔴 rapor bir BELGE üretir — kullanıcı Raporlar ekranına gider"
      : "🔴 güvenlik yüzeyi patron kademesidir; bir dil modeline okuma bile açılmaz"
  );
}
kontrol(
  "içe aktarılan uçlar tam olarak beklenen dokuz tanesi",
  (() => {
    const yollar = [...kod.araclar.matchAll(/from "@\/(app\/api\/mobile\/[^"]+)"/g)].map(
      (m) => `${m[1]}.ts`
    );
    const bek = BEKLENEN.map(([, , d]) => d).sort();
    return JSON.stringify(yollar.sort()) === JSON.stringify(bek);
  })(),
  "listeye yeni bir uç eklenmişse bu betiğin tablosu da güncellenmeli"
);
kontrol(
  "sistem istemi rapor istendiğinde Raporlar ekranına yönlendiriyor (üç dil)",
  /\*\*Raporlar\*\*/.test(hamIstem) &&
    /\*\*Berichte\*\*/.test(hamIstem) &&
    /\*\*Reports\*\*/.test(hamIstem),
  "asistan belge üretmez; kullanıcıyı doğru ekrana göndermeli"
);

// ══ 5 · ANAHTAR SIZMAZ ════════════════════════════════════════════════════
kontrol(
  "ANTHROPIC_API_KEY yalnız uçta ve TEK yerde okunuyor",
  (kod.uc.match(/ANTHROPIC_API_KEY/g) ?? []).length === 1 &&
    !kod.araclar.includes("ANTHROPIC_API_KEY") &&
    !kod.hiz.includes("ANTHROPIC_API_KEY") &&
    !kod.istem.includes("ANTHROPIC_API_KEY"),
  "🔴 anahtarın ikinci okuma yeri, ikinci sızma yeri demektir"
);
kontrol(
  "uçta console.* YOK",
  !/\bconsole\s*\./.test(kod.uc),
  "🔴 akış içinde bir günlük satırı, anahtarı ya da müşteri verisini Vercel loguna yazardı"
);
kontrol(
  "araç katmanında ve hız sayacında console.* YOK",
  !/\bconsole\s*\./.test(kod.araclar) && !/\bconsole\s*\./.test(kod.hiz)
);
kontrol(
  "anahtar değişkeni yalnız istemci kurucusuna geçiyor",
  (kod.uc.match(/\banahtar\b/g) ?? []).length === 3 &&
    /new Anthropic\(\{ apiKey: anahtar \}\)/.test(kod.uc),
  "okuma + varlık denetimi + kurucu: üçten fazlası anahtarın başka bir yere gittiği anlamına gelir"
);
kontrol(
  "istemciye dönen hata gövdesi sağlayıcı mesajını taşımıyor",
  (() => {
    const i = kod.uc.indexOf("function hataGovdesi");
    if (i < 0) return false;
    const govde = kod.uc.slice(i, i + 400);
    return !/\.message|\.stack|JSON\.stringify\(e\)|String\(e\)/.test(govde);
  })(),
  "🔴 sağlayıcı hata metni istek başlıklarını yankılayabilir"
);

// ══ 6 · ARAÇ KATMANINDA ARİTMETİK YOK ═════════════════════════════════════
{
  const sade = kodSade(hamAraclar);
  const bulunan = [];
  if (/[^=!<>+\-*/%]\s[*/%]\s/.test(sade)) bulunan.push("* / %");
  if (/\s\+\s|\s-\s/.test(sade)) bulunan.push("+ -");
  if (/\bMath\./.test(sade)) bulunan.push("Math.");
  if (/\.reduce\(/.test(sade)) bulunan.push(".reduce(");
  if (/\.toFixed\(/.test(sade)) bulunan.push(".toFixed(");
  kontrol(
    "araç katmanında ARİTMETİK yok — daraltma yalnız seçme ve kesme",
    bulunan.length === 0,
    `🔴 bulunan: ${bulunan.join(", ")} — burada hesaplanan sayı hiçbir ekranda bulunmaz`
  );
}
kontrol(
  "kesme sessiz değil: kes() kirpildi bayrağı yazıyor",
  /kirpildi:\s*satirlar\.length > tavan/.test(kod.araclar),
  "🔴 sessiz kırpma, modele '40 uyarı var' dedirtir (PostgREST 1000 satır dersi)"
);
kontrol(
  "araç hatası yutulmuyor, modele veriliyor",
  /return r\.hata/.test(kod.araclar) && /uc_cevabi_okunamadi/.test(kod.araclar),
  "sessiz boş cevap, kullanıcıya 'sıfır' diye okunur"
);

// ══ 7 · SİSTEM İSTEMİ DURAĞAN ═════════════════════════════════════════════
for (const [ad, kalip] of [
  ["new Date", /new Date\(/],
  ["Date.now", /Date\.now\(/],
  ["Math.random", /Math\.random\(/],
  ["process.env", /process\.env/],
  ["toISOString", /toISOString\(/],
]) {
  kontrol(
    `sistem istemi ${ad} İÇERMİYOR (ön ek durağan kalmalı)`,
    !kalip.test(kod.istem),
    "🔴 ön ekte değişen tek bayt prompt cache'i sıfırlar — fark yalnız faturada görünür"
  );
}
kontrol(
  "üç dilin üçü de tanımlı",
  /const TR = /.test(kod.istem) && /const DE = /.test(kod.istem) && /const EN = /.test(kod.istem)
);
kontrol(
  "null ≠ 0 kuralı üç dilde de yazılı",
  (() => {
    // Dil bloklarını ADLARIYLA kesip her birinde ayrı ayrı arıyoruz: dosyanın
    // TAMAMINDA saymak, kuralı yalnız BAŞLIK YORUMUNDA anlatan bir istemi de
    // geçirirdi (yorum modele gitmiyor).
    const blok = (ad, son) => {
      const i = hamIstem.indexOf(`const ${ad} = `);
      const j = son ? hamIstem.indexOf(`const ${son} = `) : hamIstem.length;
      return i < 0 ? "" : hamIstem.slice(i, j < 0 ? hamIstem.length : j);
    };
    return [blok("TR", "DE"), blok("DE", "EN"), blok("EN", "ISTEMLER")].every(
      (b) => (b.match(/null/g) ?? []).length >= 2
    );
  })(),
  "ölçülemeyeni sıfır sanmak bu üründeki en ciddi hata"
);
kontrol(
  "araç sonucu VERİDİR etiketi istemde ve uçta AYNI sabitten",
  /export const VERI_ETIKETI/.test(kod.istem) && /VERI_ETIKETI/.test(kod.uc),
  "iki yerde iki etiket olsaydı istem var olmayan bir etiketten söz ederdi"
);
kontrol(
  "değişken bağlam ön ekin DIŞINDA (messages sonunda system mesajı)",
  /role: "system"/.test(kod.uc) && /baglamMetni\(/.test(kod.uc),
  "şu an/rol bilgisi sistem istemine yazılsaydı önbellek hiç tutmazdı"
);
kontrol(
  "önbellek kesme noktaları hem araçlarda hem sistem isteminde",
  (kod.uc.match(/cache_control/g) ?? []).length >= 2,
  "tools → system ön ekinin tamamı önbelleğe girmeli"
);
kontrol(
  "önbellek kanıtı gövdede: cache_read_input_tokens taşınıyor",
  /cache_read_input_tokens/.test(kod.uc) && /onbellekOkuma/.test(kod.uc),
  "önbelleğin tuttuğu ÖLÇÜLEBİLİR olmalı, varsayılmamalı"
);

// ══ 8 · BAYRAK, ANAHTAR, HIZ SINIRI ═══════════════════════════════════════
kontrol(
  "ASISTAN_ENABLED sunucu tarafı ve varsayılanı false",
  /export const ASISTAN_ENABLED = envBool\(\s*process\.env\.ASISTAN_ENABLED,\s*false\s*\)/.test(
    kod.tenant.replace(/\s+/g, " ").replace(/envBool\( /g, "envBool(")
  ) ||
    /export const ASISTAN_ENABLED = envBool\(process\.env\.ASISTAN_ENABLED, false\)/.test(kod.tenant),
  "🔴 NEXT_PUBLIC_ olsaydı kapı istemciye taşınırdı; true olsaydı canlı müşteride kendiliğinden açılırdı"
);
kontrol(
  "bayrak NEXT_PUBLIC_ DEĞİL",
  !/NEXT_PUBLIC_ASISTAN/.test(kod.tenant) && !/NEXT_PUBLIC_ASISTAN/.test(kod.uc),
  "kapı sunucuda kalmalı"
);
kontrol(
  "bayrak ve anahtar AYRI sebep döndürüyor",
  /sebep: "bayrak_kapali"/.test(kod.uc) && /sebep: "anahtar_yok"/.test(kod.uc),
  "🔴 tek bir 'kapalı' cevabı, anahtarı girmeyi bekleyene hiçbir şey söylemez"
);
kontrol(
  "kurulum denetimi KİMLİKTEN SONRA",
  (() => {
    const iKapi = kod.uc.indexOf("requireMobileFleetView");
    const iBayrak = kod.uc.indexOf("ASISTAN_ENABLED");
    const iAnahtar = kod.uc.indexOf("ANTHROPIC_API_KEY");
    return iKapi > -1 && iBayrak > iKapi && iAnahtar > iBayrak;
  })(),
  "🔴 kimliği doğrulanmamış birine kiracının kurulum durumu söylenmez"
);
kontrol(
  "hız sınırı model çağrısından ÖNCE düşülüyor",
  (() => {
    const iHiz = kod.uc.indexOf("hizKrediDus(");
    const iIstemci = kod.uc.indexOf("new Anthropic(");
    return iHiz > -1 && iIstemci > iHiz;
  })(),
  "🔴 sonra düşseydi iptal/hata veren her istek bedava olurdu — tavan tam da döngüde çalışmazdı"
);
kontrol(
  "hız sayacı okunamazsa istek REDDEDİLİYOR (fail-closed)",
  /kod: "hiz_sayaci_okunamadi"/.test(kod.hiz) &&
    /if \(error\) return \{ ok: false, kod: "hiz_sayaci_okunamadi" \}/.test(kod.hiz) &&
    /hiz_sayaci_okunamadi/.test(kod.uc),
  "🔴 açık düşersek maliyet tavanı tamamen kalkar ve kimse fark etmez"
);
kontrol(
  "hız anahtarında BORU İŞARETİ yok (giriş kilidiyle çakışmaz)",
  /return `asistan:\$\{workerId\}`/.test(kod.hiz),
  "🔴 `asistan|<id>` yazılsaydı 'Giriş kilidini kaldır' düğmesi bu satırları da silebilirdi"
);
kontrol(
  "hız sayacı locked_until YAZMIYOR (giriş kilidinin alanı)",
  /locked_until: null/.test(kod.hiz) && !/locked_until: [^n]/.test(kod.hiz),
  "iki mekanizma tek alanda buluşmamalı"
);
kontrol(
  "tavan 30 soru / 60 dakika",
  /ASISTAN_SORU_TAVANI = 30/.test(kod.hiz) && /ASISTAN_PENCERE_MS = 60 \* 60 \* 1000/.test(kod.hiz)
);

// ══ 9 · AKIŞ VE MODEL ═════════════════════════════════════════════════════
kontrol(
  "model sabit ve env'e bağlı DEĞİL",
  /const MODEL = "claude-opus-5"/.test(kod.uc) && !/process\.env\.\w*MODEL/.test(kod.uc),
  "sayıların üretildiği yol env ile sessizce değişmemeli"
);
kontrol(
  "effort medium",
  /output_config: \{ effort: "medium" \}/.test(kod.uc)
);
kontrol(
  "SSE başlıkları doğru",
  /text\/event-stream/.test(kod.uc) &&
    /no-store, no-transform/.test(kod.uc) &&
    /x-accel-buffering/.test(kod.uc),
  "tamponlayan bir ters vekil akışı toplu indirirdi"
);
kontrol(
  "maxDuration açıkça yazılı",
  /export const maxDuration = 300/.test(kod.uc),
  "platform varsayılanı sessizce kesilen bir akışa dönüşür"
);
kontrol(
  "araç döngüsünde sert tur tavanı var",
  /TUR_TAVANI = \d+/.test(kod.uc) && /arac_dongusu_asildi/.test(kod.uc),
  "model kendini döngüye sokabilir"
);
kontrol(
  "araçlar PARALEL ama TAVANLI çalışıyor",
  /mapBounded\(/.test(kod.uc) && !/Promise\.all\(cagrilar/.test(kod.uc),
  "sınırsız fan-out aynı anda onlarca Supabase sorgusu açardı (DB_FANOUT_LIMIT dersi)"
);
kontrol(
  "araç sonuçları TEK kullanıcı mesajında dönüyor",
  (() => {
    const i = kod.uc.indexOf("const sonuclar = await mapBounded");
    if (i < 0) return false;
    return /messages\.push\(\{ role: "user", content: sonuclar \}\)/.test(kod.uc.slice(i));
  })(),
  "sonuçları bölmek modeli paralel çağrı yapmamaya iter"
);
kontrol(
  "asistan turu geri yazılırken TÜM içerik taşınıyor (düşünme blokları dâhil)",
  /messages\.push\(\{ role: "assistant", content: cevap\.content \}\)/.test(kod.uc),
  "aynı modelde devam ederken bloklar olduğu gibi geri gönderilmeli"
);
kontrol(
  "model reddi sessizce yutulmuyor",
  /stop_reason === "refusal"/.test(kod.uc) && /model_reddetti/.test(kod.uc),
  "red bir cevapsızlık değil, söylenmesi gereken bir durumdur"
);
kontrol(
  "arac_sonuc olayı sonucun GÖVDESİNİ taşımıyor",
  (() => {
    const m = kod.uc.match(/gonder\("arac_sonuc", \{([^}]*)\}\)/);
    return !!m && !/govde|veri|sonuc:/.test(m[1]);
  })(),
  "aynı veriyi iki kez akıtmak telefon bağlantısında bedavaya gelmez"
);
kontrol(
  "fazla mesaj SESSİZCE kırpılmıyor (400)",
  /tavan: MESAJ_TAVANI/.test(kod.uc) && /MESAJ_TAVANI = 20/.test(kod.uc),
  "kırpsaydık istemci gönderdiği bağlamla cevaplandığını sanırdı"
);
kontrol(
  "geçersiz dil SESSİZCE yutulmuyor (400 invalid_dil)",
  /invalid_dil/.test(kod.uc) && /SUPPORTED_LOCALES/.test(kod.uc),
  "kardeş rapor uçlarıyla aynı sözleşme"
);
kontrol(
  "sohbet geçmişi SAKLANMIYOR — uçta yazma yok",
  !/\.insert\(|\.upsert\(|\.update\(/.test(kod.uc.replace(/hizKrediDus/g, "")) ||
    !/from\("(?!login_attempts)/.test(kod.uc),
  "v1 kararı: geçmiş istemciden gelir, sunucuda tutulmaz"
);
kontrol(
  "uç doğrudan Supabase'e dokunmuyor",
  !/from\s*"@\/lib\/supabase"/.test(kod.uc),
  "veri yolu araçlardan, sayaç yolu lib/asistan-hiz.ts'ten geçer"
);

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ AI ASİSTAN MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log(
  "✓ ai asistan: 9 araç salt okuma · kapı ucun kapısıyla eşleşiyor · kapsam sunucudan · " +
    "rapor/güvenlik yok · anahtar tek yerde ve loglanmıyor · araç katmanında aritmetik yok · " +
    "istem durağan (önbellek) · hız sınırı fail-closed."
);
