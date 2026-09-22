#!/usr/bin/env node
/**
 * SAKLAMA + HAFTALIK AKSİYON UÇLARI MUHAFIZI — kaynak denetimi (Faz D-2/D-3).
 *
 * ═══ NE KORUYOR ═══
 *
 * 1. **SİLME MOBİLE AÇILMAZ.** `araligiSil` bir İNSAN eylemidir ve çift
 *    onaylıdır (kuru mod → sayıyı gör → kutuya elle "SIL" yaz → sebep yaz).
 *    Mobil yüzeyde ne DELETE handler'ı ne de `kuru: false` bir `manuelSil`
 *    çağrısı bulunabilir. Bu kuralın tek koruyucusu bu betiktir: veritabanı
 *    tarafında takograftaki gibi bir tetikleyici YOK, ham telemetri
 *    gerçekten silinebiliyor.
 *
 * 2. **SAKLAMA YALNIZ YÖNETİCİ.** Panelin kuralı (`app/actions/saklama.ts`):
 *    uyarı eşiği ürünün hukuki beyanını etkiler, filo şefine kapalı.
 *
 * 3. **HAFTALIK'TA KAPSAM UYGULANIR.** Uç `requireMobileFleetView` — panel
 *    paritesi — AMA kapsam gerçekten süzülmek ZORUNDA. Kapının gevşemesi
 *    değil, SÜZGECİN düşmesi burada asıl risk: şef kendi filosu dışındaki
 *    şoförün adını ve aracın plakasını görürdü.
 *
 * 4. **KAPSAM KURALI TEK KAYNAK.** `kalemKapsamda` panel action'ı ile mobil
 *    ucun ORTAK fonksiyonu. Mobil tarafta yeniden yazılmış bir kopya, iki
 *    yüzeyin zamanla ayrışması demektir.
 *
 * 5. **KAPATMA `durum`u SESSİZCE SEÇİLMEZ.** `ilgisiz`, kural+özne çiftini
 *    haftalarca susturuyor; uç bunu istemciden AÇIKÇA almak zorunda.
 *
 * 6. **DOĞRULAMA İKİNCİ KEZ YAZILMAZ.** Ayar kapısı `ayarDenetle` çağırmak
 *    zorunda; uçta ikinci bir `1..3650` karşılaştırması, biri değiştiğinde
 *    sessizce ayrışır.
 *
 * Kullanım: npm run lint:saklama-haftalik
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

const kod = {
  saklama: kodu(oku("app/api/mobile/saklama/route.ts")),
  onIzleme: kodu(oku("app/api/mobile/saklama/on-izleme/route.ts")),
  haftalik: kodu(oku("app/api/mobile/haftalik/route.ts")),
  kapat: kodu(oku("app/api/mobile/haftalik/[id]/kapat/route.ts")),
  aksiyonDb: kodu(oku("lib/haftalik-aksiyon-db.ts")),
  panelAction: kodu(oku("app/actions/haftalik-aksiyon.ts")),
};

// ══ 1 · SİLME MOBİLE AÇILMAZ ══════════════════════════════════════════════
for (const [ad, k] of [["saklama", kod.saklama], ["on-izleme", kod.onIzleme]]) {
  kontrol(
    `${ad}: DELETE handler yok`,
    !/export\s+(async\s+)?function\s+DELETE/.test(k),
    "🔴 saklama yüzeyinde silme ucu AÇILMAZ (çift onay telefonda kaza riski)"
  );
  kontrol(
    `${ad}: araligiSil çağrılmıyor`,
    !/araligiSil/.test(k),
    "🔴 gerçek silme yalnız panelden"
  );
}
kontrol(
  "on-izleme yalnız KURU mod (kuru: true)",
  /manuelSil\s*\(/.test(kod.onIzleme) && /kuru:\s*true/.test(kod.onIzleme),
  "çekirdek kuru bayrağıyla çağrılmalı"
);
kontrol(
  "on-izleme'de kuru:false YOK",
  !/kuru:\s*false/.test(kod.onIzleme),
  "🔴 tek karakterlik bir değişiklik gerçek silmeye döner"
);
kontrol(
  "on-izleme yazma yapmadığını gövdede söylüyor",
  /yazmaYapildi/.test(kod.onIzleme)
);

// ══ 2 · SAKLAMA YALNIZ YÖNETİCİ ═══════════════════════════════════════════
for (const [ad, k] of [["saklama", kod.saklama], ["on-izleme", kod.onIzleme]]) {
  kontrol(`${ad}: requireMobileAdmin`, /requireMobileAdmin\s*\(/.test(k));
  kontrol(
    `${ad}: şefe açan kapı kullanılmıyor`,
    !/requireMobileFleetView|requireMobileWorker/.test(k),
    "panelin kuralı: saklama filo şefine KAPALI"
  );
}

// ══ 3 · SİLİNEBİLİRLİK FAIL-CLOSED ════════════════════════════════════════
kontrol(
  "on-izleme kategoriyi sorup silinebilirMi ile kapı uyguluyor",
  /tabloKategorisi\s*\(/.test(kod.onIzleme) && /silinebilirMi\s*\(/.test(kod.onIzleme),
  "sınıflandırılmamış tablo 'yasal_zorunlu' sayılmalı"
);
kontrol(
  "on-izleme tabloyu HAM_TABLOLAR ile sınırlıyor",
  /HAM_TABLOLAR/.test(kod.onIzleme)
);

// ══ 4 · AYAR DOĞRULAMASI ÇEKİRDEKTEN ══════════════════════════════════════
kontrol(
  "PATCH ayarDenetle çağırıyor",
  /ayarDenetle\s*\(/.test(kod.saklama),
  "doğrulama İKİNCİ kez yazılmaz"
);
kontrol(
  "uçta elle gün aralığı karşılaştırması yok",
  !/(uyariGun|gun)\s*[<>]=?\s*(1|3650)\b/.test(kod.saklama),
  "tavan tek yerde: UYARI_GUN_MIN / UYARI_GUN_MAX"
);
kontrol(
  "sınırlar gövdede taşınıyor (istemci sayı gömmesin)",
  /UYARI_GUN_MIN/.test(kod.saklama) && /UYARI_GUN_MAX/.test(kod.saklama)
);
kontrol(
  "tanınmayan alan sessizce yutulmuyor",
  /IZINLI_ALANLAR/.test(kod.saklama)
);

// ══ 5 · HAFTALIK: KAPI + KAPSAM ═══════════════════════════════════════════
for (const [ad, k] of [["haftalik", kod.haftalik], ["kapat", kod.kapat]]) {
  kontrol(`${ad}: requireMobileFleetView`, /requireMobileFleetView\s*\(/.test(k), "panel de öyle");
  kontrol(
    `${ad}: 🔴 KAPSAM SÜZGECİ UYGULANIYOR`,
    /kalemKapsamda\s*\(/.test(k),
    "kapı gevşemese bile süzgeç düşerse şef başka filonun plakasını görür"
  );
  kontrol(
    `${ad}: fleetScope aktörden okunuyor`,
    /fleetScope/.test(k),
    "kapsam sunucudan gelmeli, gövdeden değil"
  );
}
kontrol(
  "haftalik: kapsam süzgeci ADLARDAN ÖNCE (süzülmemiş satır sorguya girmez)",
  kod.haftalik.indexOf("kalemKapsamda") < kod.haftalik.indexOf('from("workers")'),
  "şefin göremeyeceği şoförün adı hiç çözülmemeli"
);

// ══ 6 · KAPSAM KURALI TEK KAYNAK ══════════════════════════════════════════
kontrol(
  "kalemKapsamda lib'de tanımlı",
  /export function kalemKapsamda/.test(kod.aksiyonDb)
);
kontrol(
  "panel action'ı da aynı fonksiyonu kullanıyor",
  /kalemKapsamda/.test(kod.panelAction),
  "iki yüzey tek kaynaktan beslenmeli"
);
kontrol(
  "mobil uçta kuralın ikinci bir kopyası yok",
  !/isFleetWorker\s*\(/.test(kod.haftalik) && !/isFleetWorker\s*\(/.test(kod.kapat),
  "kural kopyalanırsa zamanla ayrışır"
);

// ══ 7 · KAPATMA DURUMU AÇIK ═══════════════════════════════════════════════
kontrol(
  "kapat: durum istemciden okunuyor ve İKİ seçenek de var",
  /DURUMLAR\s*=\s*\[\s*"yapildi"\s*,\s*"ilgisiz"\s*\]/.test(kod.kapat) &&
    /g\.durum/.test(kod.kapat),
  "'ilgisiz' kural+özneyi susturuyor; seçeneği kısmak susturmayı imkânsız kılar"
);
kontrol(
  "kapat: zaten kapalı 409",
  /zaten_kapali/.test(kod.kapat),
  "ikinci dokunuş susturma penceresini uzatmamalı"
);
kontrol(
  "kapat: kapsam dışı 403 (404 değil)",
  /kapsam_disi/.test(kod.kapat),
  "kalem VAR, yetki yok — iki durum ayrı"
);

// ══ 8 · "CRON KURULU" DİYE BİR ALAN UYDURULMAZ ════════════════════════════
kontrol(
  "haftalik: üretim durumu yalnız tablodan (sonUretim)",
  /sonUretim/.test(kod.haftalik)
);
kontrol(
  "haftalik: cron kaydı hakkında iddia yok",
  !/cronKurulu|cronKayitli|zamanlayiciVar/.test(kod.haftalik),
  "🔴 uygulama dış zamanlayıcıyı göremez; uydurma durum alanı yanlış teşhis üretir"
);

// ══ RAPOR ═════════════════════════════════════════════════════════════════
if (dusen > 0) {
  console.error(`\n✗ SAKLAMA + HAFTALIK MUHAFIZI — ${dusen} bulgu (yukarıda).`);
  process.exit(1);
}
console.log(
  "✓ saklama/haftalık uçları: silme yok · yönetici kapısı · kapsam süzgeci · tek kaynak kural · uydurma cron alanı yok."
);
