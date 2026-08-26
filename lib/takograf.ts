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
