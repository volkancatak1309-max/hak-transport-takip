/**
 * TAKOGRAF — saf katman (migration 091).
 *
 * Bu dosyada VERİTABANI ve AĞ YOK. Sabitler, doğrulama kuralları, biçimleme
 * ve sınıflandırma burada; sorgular lib/takograf-db.ts, servis çağrısı
 * lib/takograf-servis.ts.
 *
 * ═══ 🔴 ÜRÜNÜN SATIŞ VAADİ: ARŞİV ═══
 *
 * Müşteri .ddd dosyalarını kendi bilgisayarında klasörde tutmaktan
 * kurtuluyor. Dosya Supabase Storage'da KALICI durur ve denetimde oradan
 * BAYT BAYT ORİJİNAL indirilir. Bu yüzden:
 *   · dosya ASLA silinmez — ayrıştırılamasa bile
 *   · yükleme sırası ÖNCE ARŞİV: Storage'a yaz, sonra servise sor
 *   · servis düşse bile dosya kaydedilmiş olur
 */

/** Kova adı — migration 091'de kurulur. */
export const TAKOGRAF_KOVA = "takograf";

/**
 * 5 MB. ÖLÇÜLEN en büyük gerçek dosya 155 KB (araç ünitesi, Gen2v2).
 * Diğer altı kovayla aynı sayı; 33 kat pay.
 */
export const EN_BUYUK_BAYT = 5 * 1024 * 1024;

/** Sunucu tarafı zaman aşımı payı — servis 30 sn tutuyor. */
export const SERVIS_ZAMAN_ASIMI_MS = 35_000;

// ═══════════════════════════ TÜRLER ═══════════════════════════════════

export type DosyaTuru = "kart" | "vu";
export type MuhurDurumu = "dogrulandi" | "dogrulanamadi" | "denenmedi";
export type AyristirmaDurumu = "bekliyor" | "tamam" | "basarisiz";
export type FaaliyetTuru = "surus" | "is" | "hazir" | "mola" | "bilinmiyor";

export const FAALIYETLER: FaaliyetTuru[] = ["surus", "is", "hazir", "mola", "bilinmiyor"];

/**
 * ⚠️ ÜÇ MÜHÜR DEĞERİ, ÜÇÜ DE FARKLI ŞEY:
 *
 *   dogrulandi     — denendi, TUTTU
 *   dogrulanamadi  — denendi, TUTMADI (imza uyuşmadı ya da sertifika yok)
 *   denenmedi      — HİÇ DENENMEDİ (servis erişilemedi)
 *
 * "Doğrulanamadı" ile "doğrulanmadı/denenmedi" aynı şey değildir ve ekran
 * bu ayrımı korumak zorundadır. Birincisi bir BULGU, ikincisi bir BOŞLUK.
 */
export const MUHUR_DURUMLARI: MuhurDurumu[] = ["dogrulandi", "dogrulanamadi", "denenmedi"];

/** Uyarı şeridi bu durumda çıkar. */
export function muhurUyarisiGerekli(m: MuhurDurumu): boolean {
  return m === "dogrulanamadi";
}

/**
 * ⚠️ 'denenmedi' UYARI ÜRETMEZ ama "temiz" de DEĞİLDİR.
 * Ekran onu ayrı, sessiz bir tonda gösterir — bir şey iddia etmiyoruz.
 */
export function muhurTonu(m: MuhurDurumu): "iyi" | "uyari" | "notr" {
  if (m === "dogrulandi") return "iyi";
  if (m === "dogrulanamadi") return "uyari";
  return "notr";
}

// ═══════════════════ MÜHÜR SEBEBİ — HAM METİN EKRANA ÇIKMAZ ═══════════════

/**
 * 🔴 27.08.2026 — CANLIDA YAKALANDI.
 *
 * Okuyucu servisi `muhur_sebep` alanına kütüphanenin HAM Go hata dizesini
 * koyuyor (`servis/main.go`: `c.MuhurSebep = kisalt(aerr.Error(), 300)`) ve
 * panel onu olduğu gibi basıyordu. Müşterinin gördüğü:
 *
 *   "failed to extract Gen2 certificates: expected exactly 1 MSCA
 *    certificate, got 0 failed to extract Gen2 certificates: expected
 *    exactly 1 MSCA certificate, got 0 failed to extract…"
 *
 * İngilizce, teknik ve DÖRT KEZ tekrarlı — çünkü VU kimlik doğrulaması her
 * imzalı kaydı ayrı deniyor ve aynı hata kayıt başına bir kez birikiyor
 * (ölçüldü: 3 gün kaydı + genel bakış).
 *
 * Kural: ham metin KAYIT (log), ekran değil. Ham dize veritabanında
 * `takograf_dosyalari.muhur_sebep` kolonunda durmaya devam eder — denetim
 * izinde gerekirse oradan okunur; ekranda yerine kapalı bir kod ve o kodun
 * üç dildeki karşılığı gösterilir.
 */
export type MuhurSebepKodu =
  /** Dosyada imza/sertifika bloğu YOK — doğrulanacak bir şey bulunamadı. */
  | "imza_yok"
  /** İmza var ama tutmadı — dosya değişmiş olabilir. */
  | "imza_uyusmadi"
  /** Kök/CA sertifikasına ulaşılamadı — bizim tarafımızdaki bir boşluk. */
  | "kok_sertifika_yok"
  /** İmza bölümü çözülemedi — biçim beklenenden farklı. */
  | "bicim_okunamadi"
  /** Tanınmayan sebep — yine de bir şey uydurmuyoruz. */
  | "bilinmiyor";

export const MUHUR_SEBEP_KODLARI: MuhurSebepKodu[] = [
  "imza_yok",
  "imza_uyusmadi",
  "kok_sertifika_yok",
  "bicim_okunamadi",
  "bilinmiyor",
];

/**
 * Aynı cümlenin arka arkaya tekrarını tek kopyaya indirir.
 *
 * Ölçülen girdi 300 baytlık kırpılmış bir dizeydi ve aynı cümleyi dört kez
 * taşıyordu. Birim uzunluğunu SABİTLEMİYORUZ: ilk 24 karakterin ikinci kez
 * göründüğü yer birimin sınırıdır. Son kopya kırpık olabilir (servis 300'de
 * kesiyor), o yüzden "tam katı mı" diye bakmıyoruz — baştan tekrar YETER.
 */
export function tekrariSil(ham: string): string {
  const s = ham.replace(/\s+/g, " ").trim();
  if (s.length < 24) return s;
  const iz = s.slice(0, 24);
  const i = s.indexOf(iz, 1);
  if (i < 12) return s;
  const birim = s.slice(0, i).trim();
  if (!birim) return s;
  /**
   * Kalan gerçekten bu birimin tekrarı mı?
   *
   * ⚠️ SON KOPYA KIRPIK OLABİLİR ve sonunda "…" taşır — servis dizeyi 300
   * baytta kesip üç nokta ekliyor (`servis/main.go: kisalt`). İlk sürüm bunu
   * hesaba katmıyordu ve GERÇEK girdide düştü (301 karakterlik canlı dize
   * hiç kısalmadı, ölçüldü). Bu yüzden son parça birimin TAMAMI değil ÖN EKİ
   * olabilir; eşleşme iki yönlü aranıyor.
   */
  for (let p = 0; p < s.length; p += i) {
    const parca = s
      .slice(p, p + i)
      .trim()
      .replace(/…+$/, "");
    if (!parca) continue;
    if (!birim.startsWith(parca) && !parca.startsWith(birim)) return s;
  }
  return birim.replace(/[\s…:-]+$/, "");
}

/**
 * Ham hata dizesini KAPALI bir koda çevirir.
 *
 * Eşleştirme ölçülmüş sözcüklere dayanıyor — `tachograph-go` kimlik doğrulama
 * yolundaki tüm `fmt.Errorf` metinleri tarandı (27.08.2026):
 *   "certificate not found" · "expected exactly N … certificate, got"
 *   "failed to extract Gen1/Gen2 certificates" · "no signature present"
 *   "signature record not found" · "… verification failed" · "failed to get
 *   root certificate" · "unsupported file type" · "failed to split/parse/
 *   unmarshal" …
 *
 * ⚠️ SIRA ÖNEMLİ: "verification failed" önce denenir. "MSCA certificate
 * verification failed" hem 'certificate' hem 'verification failed' içerir ve
 * bu bir BULGUdur (imza tutmadı), boşluk değil.
 *
 * Boş/eksik sebep → null (ekran yalnız başlık cümlesini gösterir).
 */
export function muhurSebepKodu(ham: string | null | undefined): MuhurSebepKodu | null {
  const v = tekrariSil(String(ham ?? "")).toLowerCase();
  if (!v) return null;

  if (/verification failed|authentication failed|invalid signature length/.test(v)) {
    return "imza_uyusmadi";
  }
  if (/root certificate/.test(v)) return "kok_sertifika_yok";
  if (
    /certificate not found|expected exactly \d+ .*certificate|failed to extract gen[12] certificates|no signature present|signature record not found|record not found for authentication|insufficient data for/.test(
      v
    )
  ) {
    return "imza_yok";
  }
  if (/unsupported|unable to determine|failed to (split|parse|unmarshal)/.test(v)) {
    return "bicim_okunamadi";
  }
  return "bilinmiyor";
}

// ═══════════════════ DÖNEM ↔ FAALİYET GÜNÜ ÇELİŞKİSİ ══════════════════════

/**
 * Dosyanın bildirdiği indirme dönemi ile faaliyet satırlarının günleri
 * birbirini tutuyor mu?
 *
 * 🔴 27.08.2026'da canlıda görüldü: özet "2025-11-28 → 2026-03-11" derken
 * 155 satırın hepsi "2024-01-01" diyordu. ÖLÇÜLDÜ — okuma hatası DEĞİL:
 * dosyadaki üç gün kaydının üçü de `dateOfDay = 2024-01-01T00:00:00Z`
 * taşıyor, `downloadablePeriod` ise 2025-2026. Yani çelişki DOSYANIN İÇİNDE
 * (anonimleştirme zaman damgalarını sabit bir başlangıca çekmiş, genel bakış
 * bloğuna dokunmamış).
 *
 * Bu yüzden veriyi DÜZELTMİYORUZ — uydurmak olurdu. Ekran ham veriyi
 * gösterir ve çeliştiğini SÖYLER; kullanıcı iki sayıyı yan yana görüp
 * "hangisi doğru" diye tahmin etmek zorunda kalmaz.
 *
 * `null` = söylenecek bir şey yok (dönem yok, gün yok ya da tutarlı).
 */
export function donemCelismesi(
  donemBas: string | null,
  donemBit: string | null,
  gunler: (string | null)[]
): { ilk: string; son: string } | null {
  const g = [...new Set(gunler.filter(Boolean).map((x) => String(x).slice(0, 10)))].sort();
  if (g.length === 0) return null;
  const bas = (donemBas ?? "").slice(0, 10);
  const bit = (donemBit ?? "").slice(0, 10);
  if (!bas || !bit) return null;
  // Tek bir gün bile aralığın içindeyse çelişki DEMİYORUZ: gerçek dosyalarda
  // dönemin dışına taşan tek tük kayıt olabilir; iddia ancak HİÇBİRİ
  // içeride değilse kurulur.
  const iceride = g.some((x) => x >= bas && x <= bit);
  if (iceride) return null;
  return { ilk: g[0], son: g[g.length - 1] };
}

// ═══════════════════════════ YÜKLEME DENETİMİ ═════════════════════════

export type YuklemeHatasi =
  | "dosya_yok"
  | "cok_buyuk"
  | "bos_dosya"
  | "uzanti_yanlis";

/**
 * Dosya kabul edilebilir mi? null = kabul.
 *
 * ⚠️ MIME türüne BAKILMIYOR: `.ddd`'nin tescilli bir MIME türü yok ve
 * tarayıcılar boş tür gönderebiliyor. Denetim uzantı + boyut; içeriğin
 * gerçekten takograf dosyası olup olmadığına SERVİS karar verir ("okunamadı"
 * cevabı verirse dosya yine saklanır, `basarisiz` işaretlenir).
 */
export function yuklemeDenetle(ad: string, bayt: number): YuklemeHatasi | null {
  if (!ad) return "dosya_yok";
  if (bayt <= 0) return "bos_dosya";
  if (bayt > EN_BUYUK_BAYT) return "cok_buyuk";
  if (!/\.ddd$/i.test(ad.trim())) return "uzanti_yanlis";
  return null;
}

/**
 * DOSYA TÜRÜNÜ İLK BAYTLARDAN TESPİT ET.
 *
 * Ölçüt kütüphanenin kendi tespitiyle BİREBİR aynı (unmarshal.go:56-67):
 *   ilk bayt 0x76        → araç ünitesi (TREP öneki)
 *   ilk iki bayt 0x0002  → sürücü kartı (EF_ICC dosya kimliği)
 *
 * ⚠️ NEDEN BURADA: `takograf_dosyalari.tur` DEĞİŞMEZ bir kolon (HK091), yani
 * satır yazılırken doğru değer yazılmak ZORUNDA. Servis cevabını bekleyip
 * sonra yazmak arşiv sözünü bozardı (servis düşerse satır hiç oluşmazdı).
 *
 * Tanınmazsa 'vu' varsayılıyor ve servis cevabı yine de kaydedilir; tür
 * yanlış kalırsa ekran ham kimliği gösterir, uydurma yapmaz. [VARSAYIM]
 */
export function turTahmin(baytlar: Uint8Array): DosyaTuru {
  if (baytlar.length >= 1 && baytlar[0] === 0x76) return "vu";
  if (baytlar.length >= 2 && baytlar[0] === 0x00 && baytlar[1] === 0x02) return "kart";
  return "vu";
}

/** Depo yolu: yyyy/mm/<uuid>.ddd — kişisel ad yol içinde geçmez. */
export function depoYolu(simdi: Date, kimlik: string): string {
  const y = simdi.getUTCFullYear();
  const a = String(simdi.getUTCMonth() + 1).padStart(2, "0");
  return `${y}/${a}/${kimlik}.ddd`;
}

// ═══════════════════════════ BİÇİMLEME ════════════════════════════════

/** Dakikayı `4:32` biçimine çevirir. null → null (0 DEĞİL). */
export function sureBicim(dk: number | null): string | null {
  if (dk === null || !Number.isFinite(dk) || dk < 0) return null;
  const s = Math.floor(dk / 60);
  const k = Math.round(dk % 60);
  return `${s}:${String(k).padStart(2, "0")}`;
}

/** Uzun kimlikleri tabloda kısaltır: `1234…9012`. Boşsa null. */
export function kimlikKisalt(s: string | null | undefined, bas = 6, son = 4): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  if (v.length <= bas + son + 1) return v;
  return `${v.slice(0, bas)}…${v.slice(-son)}`;
}

// ═══════════════════════════ SAYAÇLAR ═════════════════════════════════

export type SuzgecSayaci = {
  tumu: number;
  dogrulandi: number;
  dogrulanamadi: number;
  denenmedi: number;
  ayristirilamadi: number;
};

/**
 * Vapi deseninin sayaçları. Süzgeç şeridi sayı göstermeden anlamsızdır —
 * "Doğrulanamadı" sekmesi 0 ise kullanıcı ona hiç tıklamamalı.
 */
export function sayaclar(
  satirlar: { muhurDurumu: MuhurDurumu; ayristirmaDurumu: AyristirmaDurumu }[]
): SuzgecSayaci {
  const s: SuzgecSayaci = {
    tumu: satirlar.length,
    dogrulandi: 0,
    dogrulanamadi: 0,
    denenmedi: 0,
    ayristirilamadi: 0,
  };
  for (const r of satirlar) {
    s[r.muhurDurumu]++;
    if (r.ayristirmaDurumu !== "tamam") s.ayristirilamadi++;
  }
  return s;
}

/** Faaliyet tablosunun alt toplamı (Twenty deseni). Dakika cinsinden. */
export function faaliyetToplami(
  satirlar: { faaliyet: FaaliyetTuru | null; sureDk: number | null }[]
): {
  toplam: number | null;
  kirilim: Record<FaaliyetTuru, number | null>;
  olculemeyen: number;
} {
  /**
   * 🔑 KIRILIM `null` BAŞLAR, 0 DEĞİL.
   *
   * 0'dan başlasaydı hiç ölçülemeyen bir dosyada ekran "Sürüş 0:00" yazardı —
   * yani "bu şoför hiç sürmedi" derdi. Doğrusu "ölçemedik"tir ve o "—" ile
   * gösterilir. Bir kategori ancak EN AZ BİR ölçülmüş satırla sayıya döner.
   * (Canlı ölçüm 26.08.2026: okuyucu süre döndürmeden önce 155 satırın 155'i
   * ölçülemezdi ve ekran dördüne birden 0:00 yazıyordu.)
   */
  const kirilim: Record<FaaliyetTuru, number | null> = {
    surus: null,
    is: null,
    hazir: null,
    mola: null,
    bilinmiyor: null,
  };
  let toplam: number | null = null;
  let olculemeyen = 0;
  for (const r of satirlar) {
    // ⚠️ Süresi ölçülemeyen satır TOPLAMA GİRMEZ ve AYRI SAYILIR.
    if (r.sureDk === null || !Number.isFinite(r.sureDk)) {
      olculemeyen++;
      continue;
    }
    const k = r.faaliyet ?? "bilinmiyor";
    toplam = (toplam ?? 0) + r.sureDk;
    kirilim[k] = (kirilim[k] ?? 0) + r.sureDk;
  }
  return { toplam, kirilim, olculemeyen };
}

// ═══════════════════════ SERVİS YANIT SÖZLEŞMESİ ══════════════════════

export type ServisFaaliyet = {
  baslangic?: string;
  /**
   * Bitiş ve süre servisin GÜN KAYDINDAN türettiği ölçümlerdir: bir sonraki
   * faaliyet değişiminin dakikası. Ölçülemediğinde ALAN GELMEZ (undefined) —
   * 0 gelmez. Sıfır gelseydi "hiç sürmedi" ile "ölçemedik" aynı görünürdü.
   */
  bitis?: string;
  sure_dk?: number;
  faaliyet?: string;
  slot?: string;
  kart_no?: string;
};

export type ServisOlay = {
  tur?: string;
  bas?: string;
  bit?: string;
  ciddiyet?: string;
};

export type ServisCevabi = {
  nesil?: string;
  tur?: string;
  muhur_durumu?: string;
  muhur_sebep?: string;
  faaliyetler?: ServisFaaliyet[];
  olaylar?: ServisOlay[];
  donem_bas?: string;
  donem_bit?: string;
  kart_no?: string;
  arac_vin?: string;
  arac_plaka?: string;
  ayristirici_surum?: string;
};

/**
 * Servisin faaliyet adını şemanın koduna çevirir.
 *
 * ⚠️ TANINMAYAN DEĞER 'bilinmiyor' OLUR, atılmaz. Satırı düşürmek, dosyada
 * olan bir kaydı yok saymaktır; ekran "bilinmiyor" yazıp kullanıcıya gerçeği
 * söyler.
 */
export function faaliyetKodu(ham: string | undefined): FaaliyetTuru {
  const v = (ham ?? "").toUpperCase();
  if (v.includes("DRIVING") || v.includes("DRIVE")) return "surus";
  if (v.includes("WORK")) return "is";
  if (v.includes("AVAILAB")) return "hazir";
  if (v.includes("REST") || v.includes("BREAK")) return "mola";
  return "bilinmiyor";
}

export function slotKodu(ham: string | undefined): "surucu" | "yardimci" | null {
  const v = (ham ?? "").toUpperCase();
  if (v.includes("CO_DRIVER") || v.includes("CODRIVER")) return "yardimci";
  if (v.includes("DRIVER")) return "surucu";
  return null;
}

export function muhurKodu(ham: string | undefined): MuhurDurumu {
  if (ham === "dogrulandi" || ham === "dogrulanamadi" || ham === "denenmedi") return ham;
  // ⚠️ FAIL-CLOSED: tanınmayan değer "doğrulandı" sayılmaz.
  return "denenmedi";
}
