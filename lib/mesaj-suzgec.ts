/**
 * MESAJ SÜZGECİ — TR / DE / EN küfür ve hakaret listesi (migration 111 ailesi).
 *
 * App Store Guideline 1.2 ve Google Play UGC kuralı "uygunsuz içeriğin
 * GÖNDERİLMESİNİ süzen bir yöntem" istiyor. Süzgeç SUNUCUDA, gönderim anında
 * çalışıyor: `lib/messaging.ts` `govdeCoz` her mesaj yolunun ortak kapısı
 * (mobil birebir/grup POST, mobil duyuru, panel gönder, panel duyuru) ve
 * eşleşmede `uygunsuz_icerik` döner; uçlar onu 422'ye çevirir. Mesaj YAZILMAZ.
 *
 * ── LİSTE TEK DOSYA — BU DOSYA ──────────────────────────────────────────────
 * Kelime eklemek/çıkarmak bu dosyayı düzenlemek demek; başka hiçbir yerde
 * kopyası yok. Sunucusuz tek bir modül olduğu için muhafız da
 * (`scripts/check-mesaj-bildir-engelle.mjs`) onu doğrudan çalıştırıp örnek
 * cümlelerle sınıyor — bir kelime eklendiğinde yanlış pozitif örnekleri de
 * yeniden koşar.
 *
 * ── TAM KELİME EŞLEŞMESİ ────────────────────────────────────────────────────
 * Metin harf/rakam DIŞI her karakterden bölünür ve KELİMELER listeyle
 * karşılaştırılır; alt dize ARANMAZ. "Götter" (göt), "fickle" (fick),
 * "Scunthorpe" (cunt), "Sikkim" (sik) gibi masum kelimeler içlerinde bir
 * liste kelimesi taşıdığı için yakalanmasın diye.
 * Bedeli bilinçli: "f*ck", ekli Almanca bileşikler ("Arschlochkind") ve
 * listede olmayan Türkçe çekimler geçer. İstek "yanlış pozitif düşük" — kaçan
 * bir küfür bildirim yoluyla yönetime gelir, haksız yere düşen bir iş mesajı
 * ise kimseye gelmez.
 *
 * ── HER DİLİN LİSTESİ KENDİ KÜÇÜK HARF KURALIYLA ────────────────────────────
 * Türkçe büyük/küçük harf eşlemesi diğer ikisinden FARKLI: I → ı, İ → i.
 *   "SIK"  → "sık"  (masum: sık sık)        → geçer
 *   "SİK"  → "sik"  (küfür)                 → durur
 * Aynı metin İngilizce kuralla küçültülseydi "SIK" da "sik" olurdu ve masum
 * bir kelime düşerdi. Tersine, Türkçe kural "IDIOT"u "ıdıot" yapar; o yüzden
 * Almanca/İngilizce listeler metnin İNGİLİZCE küçültülmüş hâliyle karşılaştırılır.
 * Yani her metin İKİ kez küçültülür ve her liste kendi kuralıyla bakar —
 * yazarın hangi dilde yazdığını tahmin etmek gerekmez.
 *
 * Türkçe karakter kullanmadan yazılan bazı yaygın biçimler ("serefsiz",
 * "yavsak") ve masum karşılığı OLMAYAN ı'lı biçimler ("sıktır": Latin
 * klavyede büyük harfle yazılan SIKTIR) listeye AYRICA yazıldı. Masum
 * karşılığı olanlar BİLEREK YOK: "pic" (İngilizce picture), "got" (get),
 * "amina" (yaygın bir ad: Amina), "dick" (Almanca dick = kalın, "dicker Nebel").
 *
 * ── NEYİ BİLEREK İÇERMİYOR ──────────────────────────────────────────────────
 * Hafif ünlemler ve hafif hakaretler: "Scheiße", "Mist", "shit", "damn",
 * "aptal", "salak", "Idiot". İş yerinde trafiğe söylenen bir "Scheiße"yi
 * düşürmek bu listenin amacı değil: hedef cinsel/kaba sözcükler, ağır
 * hakaretler ve aşağılayıcı nitelemeler (slur). Bir kelime eklemek tek satır.
 */

/** Türkçe — Türkçe küçük harf kuralıyla (I→ı, İ→i) yazılmış biçimler. */
const TR = [
  "amk", "amq", "amına", "amını", "amcık", "amcik",
  "orospu", "orosbu", "orospuçocuğu", "orospucocugu",
  "piç", "pıç", "piçler",
  "sik", "siktir", "sıktır", "siktirgit", "sikerim", "sıkerim", "sikeyim", "sıkeyim",
  "sikik", "sikim", "siktiğim", "siktigim",
  "yarrak", "yarak", "yarrağı", "yarragi", "dalyarak", "dalyarrak",
  "göt", "götveren",
  "ibne", "ıbne", "ipne",
  "kahpe", "kaltak", "kancık", "kancik", "sürtük", "surtuk",
  "pezevenk", "gavat", "puşt",
  "yavşak", "yavsak", "şerefsiz", "serefsiz", "şerefsız", "serefsız",
  "gerizekalı", "gerizekali",
] as const;

/** Almanca — ß metinde de listede de "ss"e indirilir (SCHEISSE/Scheiße aynı). */
const DE = [
  "arschloch", "arschlöcher",
  "fotze", "fotzen",
  "hurensohn", "hurensöhne", "hure", "huren", "nutte", "nutten",
  "wichser", "wixer", "wixxer",
  "schlampe", "schlampen",
  "missgeburt", "spast", "spasti",
  "schwuchtel",
  "ficken", "fick", "fickt", "gefickt", "verfickt", "fickdich",
  "kanake", "kanaken", "neger",
  "drecksau", "pisser",
] as const;

/** İngilizce. */
const EN = [
  "fuck", "fucks", "fucking", "fucked", "fucker", "fuckers", "motherfucker", "motherfucking",
  "cunt", "cunts",
  "bitch", "bitches",
  "asshole", "assholes", "dickhead", "shithead",
  "bastard", "bastards",
  "slut", "sluts", "whore", "whores",
  "wanker", "wankers", "twat",
  "faggot", "faggots",
  "nigger", "niggers", "nigga",
] as const;

export type SuzgecDili = "tr" | "de" | "en";

/** U+0307 BİRLEŞEN NOKTA — İngilizce kural "İ"yi "i̇" (i + nokta) yapar. */
const BIRLESEN_NOKTA = /̇/g;

/**
 * Bir metni o dilin kuralıyla küçültüp kelimelerine ayırır.
 *
 * NFKC önce: bazı klavyeler "ş"yi "s + birleşen çengel" olarak gönderir ve
 * liste bileşik biçimle yazılı; tam genişlikli harfler de düz harfe iner.
 */
function kelimeler(metin: string, dil: SuzgecDili): string[] {
  const duz = metin.normalize("NFKC");
  let kucuk =
    dil === "tr"
      ? duz.toLocaleLowerCase("tr-TR")
      : duz.toLocaleLowerCase("en-US").replace(BIRLESEN_NOKTA, "");
  if (dil === "de") kucuk = kucuk.replace(/ß/g, "ss");
  return kucuk.split(/[^\p{L}\p{N}]+/u).filter((k) => k.length > 0);
}

function kume(liste: readonly string[], dil: SuzgecDili): Set<string> {
  // Liste kelimeleri de AYNI yoldan geçer: biri ileride "Scheiße" ya da büyük
  // harfle eklerse karşılaştırma yine tutar.
  return new Set(liste.flatMap((k) => kelimeler(k, dil)));
}

const KUMELER: Record<SuzgecDili, Set<string>> = {
  tr: kume(TR, "tr"),
  de: kume(DE, "de"),
  en: kume(EN, "en"),
};

/**
 * Eşleşen ilk liste kelimesi ve dili; temizse `null`.
 *
 * ⚠️ YALNIZ TEŞHİS/TEST İÇİN. Uçlar bunu loglamaz ve istemciye döndürmez:
 * mesaj metni (ve onun parçası) hiçbir yere yazılmaz.
 */
export function suzgecEslesmesi(metin: string): { dil: SuzgecDili; kelime: string } | null {
  for (const dil of ["tr", "de", "en"] as const) {
    const k = kelimeler(metin, dil).find((x) => KUMELER[dil].has(x));
    if (k) return { dil, kelime: k };
  }
  return null;
}

/** Gönderim kapısının sorusu: bu metin listeden bir kelime taşıyor mu. */
export function uygunsuzIcerik(metin: string): boolean {
  return suzgecEslesmesi(metin) !== null;
}

/** Muhafız ve belge için liste boyları. */
export const SUZGEC_BOYU: Record<SuzgecDili, number> = {
  tr: KUMELER.tr.size,
  de: KUMELER.de.size,
  en: KUMELER.en.size,
};
