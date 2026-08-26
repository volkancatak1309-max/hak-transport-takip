/**
 * HAFTALIK AKSİYON — SAF KURAL KATMANI (migration 084).
 *
 * ═══ NEDEN SAF (server-only YOK, supabaseAdmin YOK) ═══
 *
 * `lib/action-snoozes.ts` ve `lib/fault-reports.ts` ile aynı gerekçe: eşikler,
 * öncelik formülü ve seçim kuralı Node'da SORGUSUZ çalıştırılabilsin. Bir
 * muhafız/doğrulama betiği "bu girdiyle hangi kalem çıkar" sorusunu canlı
 * veritabanı olmadan cevaplayabiliyor. Veri toplama AYRI dosyada
 * (`lib/haftalik-aksiyon-db.ts`).
 *
 * ═══ BU BİR YAPAY ZEKA DEĞİL ═══
 *
 * Her kalem bir KURALDAN çıkar ve `kanit` alanında ÖLÇÜLEN DEĞERİ, EŞİĞİ ve
 * BİRİMİ taşır. Kullanıcı "bu neden burada" diye sorduğunda cevap ekranda
 * yazıyor. Açıklanamayan bir öneri, bu üründe bir kusurdur.
 */

// ══════════════════════════════════════════════════════════════════════════
// SABİTLER — hepsi ÖLÇÜMLE seçildi (gerekçeler migration 084 başlığında)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Panelde gösterilecek EN FAZLA kalem. "Fazlası boğar" — az olması özelliğin
 * kendisi. Büyük ürünlerin sorunu tam olarak bu: veri gösteriyor, yorumlamıyor.
 */
export const HAFTALIK_TAVAN = 5;

/**
 * AYNI KURALDAN en fazla kaç kalem.
 *
 * ⚠️ ÖLÇÜMLE GEREKTİ (25.08.2026): HAK61'de 72 saatten uzun sessiz 7 araç var.
 * Saf puan sıralaması 5 kalemin TAMAMINI sessiz araçla doldururdu ve panel
 * "tek konulu" hâle gelirdi. Kalan kalemler sayılıp özetleniyor, atılmıyor.
 */
export const KURAL_BASINA_TAVAN = 2;

/**
 * "İlgisiz" denen bir kural+özne çifti kaç gün susar.
 *
 * 28 = dört hafta. Bir hafta olsaydı kalem ERTESİ TUR geri gelirdi ve "ilgisiz"
 * demenin hiçbir etkisi olmazdı; süresiz olsaydı bir kez yanlış basılan düğme
 * o kuralı kalıcı olarak öldürürdü. Dört hafta, "şimdilik değil" ile
 * "hiçbir zaman" arasındaki doğru yer.
 */
export const HAFTALIK_SUSTURMA_GUN = 28;

/**
 * ÖNCELİK TABANLARI — RİSK SINIFI.
 *
 * Sıralamanın gerekçesi: bir kalem ne kadar GERİ ALINAMAZ bir zarara yakınsa
 * o kadar yukarıda. Yasal uyum en üstte (şoför sahada durdurulabilir), para en
 * altta (kaybedilen para geri kazanılabilir), düzen en sonda.
 */
export const TABAN = {
  /** Belge süresi — şoför yasal olarak sürüş dışı kalabilir. */
  belge_bitiyor: 800,
  /** Bakım gecikmesi — araç emniyeti. */
  bakim_gecikti: 700,
  /** Açık iş emri bekliyor — bilinen bir kusur onarılmamış. */
  is_emri_bekliyor: 680,
  /** Sessiz araç — hem olası cihaz/araç arızası hem ÖLÇÜM KAYBI. */
  sessiz_arac: 600,
  /** Şoför skoru düşüyor — insan davranışı, konuşmayla düzelir. */
  skor_dususu: 500,
  /** Yakıt sapması — para. */
  yakit_sapmasi: 400,
  /**
   * Saklama uyarısı (090) — ham konum verisi uyarı eşiğini geçti.
   *
   * TABAN 450: yakıt sapmasının (400) ÜSTÜNDE çünkü karşılığı para değil
   * CEZA — İtalya'da bir filo işletmecisi 180 günlük saklama için 50.000 €
   * ödedi. Skor düşüşünün (500) ALTINDA çünkü skor bir insanın sürüşüdür ve
   * bugün kaza yapabilir; saklama aşımı bir gün içinde kötüleşmez.
   *
   * ⚠️ ÖZNESİ YOK (worker/vehicle/musteri üçü de null) — kiracının kendi
   * durumu. Tekil indeks `coalesce(...)` ile tek kovaya düşürüyor, yani
   * haftada EN FAZLA BİR saklama kalemi çıkar. Doğrusu da bu: aynı uyarıyı
   * iki tabloya bölüp iki kalem üretmek paneli kirletirdi.
   */
  saklama_uyarisi: 450,
  /** Vardiya kapanmıyor — düzen/veri kalitesi. */
  vardiya_kapanmadi: 300,
  /**
   * Müşteri zarar ettiriyor (085) — PARA, ama yakıt sapmasından DÜŞÜK taban.
   *
   * Gerekçe: yakıt sapması bir ARIZA işaretidir (sensör, sürüş, kaçak) ve
   * düzeltmesi filonun kendi elinde. Zararlı müşteri bir SÖZLEŞME sorunudur:
   * çözümü fiyat görüşmesi, yani daha yavaş ve karşı tarafa bağlı. Geri
   * dönülemezlik sırasında bu yüzden altta. Tutar büyükse `etki` ekseni
   * zaten yukarı taşır.
   */
  musteri_zarar: 350,
  /**
   * Ayın en iyisi (088) — TABAN EN DÜŞÜK, ve bu bilinçli.
   *
   * Bu kalem bir SORUN değil bir FIRSAT: yapılmazsa kimse zarar görmez.
   * Diğer yedi kural geri dönülemez bir kaybı önlüyor; tebrik etmemek yalnız
   * bir kazancı kaçırmaktır. Yine de listeye giriyor çünkü haftalık panel
   * "bu hafta ne yap" diyor ve tebrik etmek yapılacak bir iştir.
   */
  ayin_en_iyisi: 200,
} as const;

export type KuralAdi = keyof typeof TABAN;

/** Aciliyet ve etki eksenlerinin üst sınırı — taban sırasını bozmasın diye. */
export const EKSEN_TAVAN = 150;

// ── EŞİKLER ───────────────────────────────────────────────────────────────

/** Yakıt: filo ortalamasının bu YÜZDE üstü sapma sayılır (ölçüm: %25 → 2 araç). */
export const YAKIT_SAPMA_YUZDE = 25;
/** Yakıt penceresi (gün) — 7 günde 29 aracın yalnız 10'u ölçülebiliyor. */
export const YAKIT_PENCERE_GUN = 30;
/** Filo ortalaması bu kadar araçtan azsa kural HİÇ çalışmaz (anlamsız payda). */
export const YAKIT_MIN_ARAC = 5;
/** Örneklem bu sayının altındaysa kesinlik cezası uygulanır. */
export const YAKIT_ZAYIF_ORNEKLEM = 50;

/**
 * Sessiz araç eşiği (saat). Dikkat panosu 24 saatte uyarıyor; haftalık panel
 * 72 saatte "cihaza bakılmalı" diyor — AYNI SİNYAL, FARKLI İŞ.
 */
export const SESSIZ_ESIK_SAAT = 72;

/** Belge: bu kadar gün kala aksiyon (randevu alınabilir pencere). */
export const BELGE_ESIK_GUN = 30;

/** Açık iş emri bu kadar gündür bekliyorsa aksiyon. */
export const IS_EMRI_ESIK_GUN = 7;

/** Skor: iki ardışık pencere arası EN AZ bu kadar puan düşüş. */
export const SKOR_DUSUS_ESIK = 10;

/** Vardiya: haftalık kapanmama ORANI bu yüzdeyi geçerse aksiyon. */
export const VARDIYA_KAPANMAMA_YUZDE = 5;
/** Altında oranın anlamı olmayan vardiya sayısı. */
export const VARDIYA_MIN_ADET = 20;

// ══════════════════════════════════════════════════════════════════════════
// TİPLER
// ══════════════════════════════════════════════════════════════════════════

/** Bir kuralın ürettiği aday kalem. Henüz seçilmedi. */
export type AksiyonAdayi = {
  kural: KuralAdi;
  workerId: string | null;
  vehicleId: string | null;
  /**
   * ÜÇÜNCÜ ÖZNE EKSENİ (085). Müşteri ne şoför ne araçtır; ikisinden birine
   * sıkıştırılsaydı 084'ün tekil indeksi tüm müşterileri TEK kovaya toplar ve
   * haftada yalnız bir zararlı müşteri yazılabilirdi.
   */
  musteriId: string | null;
  oncelik: number;
  baslik: string;
  gerekce: string;
  /** Açıklanabilirlik: ölçülen değer + eşik + birim (+ kurala özel alanlar). */
  kanit: Record<string, unknown>;
  hedefYol: string | null;
};

/** Kural başına tarama sayacı — "çalışmadı" ile "geçen yok" ayrımı. */
export type TaramaSayaci = {
  /** Kaç özne tarandı. */
  aday: number;
  /** Kaçı eşiği geçti. */
  gecen: number;
  /** Eşik, insan okur biçimde. */
  esik: string;
  /** Kural HİÇ çalışamadıysa sebebi (tablo yok, veri yok…). */
  atlandi?: string;
};

export type Tarama = Partial<Record<KuralAdi, TaramaSayaci>>;

export type SecimSonucu = {
  secilen: AksiyonAdayi[];
  /** Eşiği geçtiği hâlde tavana/çeşitliliğe takılanlar. */
  elenen: AksiyonAdayi[];
};

// ══════════════════════════════════════════════════════════════════════════
// ÖNCELİK
// ══════════════════════════════════════════════════════════════════════════

const kirp = (n: number, alt: number, ust: number) => Math.max(alt, Math.min(ust, n));

/**
 * ÖNCELİK PUANI — ÜÇ EKSEN, TEK SAYI.
 *
 *   taban    → risk sınıfı (yukarıdaki tablo). Sıranın omurgası.
 *   aciliyet → zaman baskısı (0-150). "Ne kadar kaldı / ne kadardır sürüyor".
 *   etki     → sapmanın büyüklüğü (0-150). "Ne kadar kötü".
 *   kesinlik → ÖLÇÜMÜN GÜVENİ (negatif, 0..-150). Zayıf örneklemle üretilmiş
 *              bir kalem, sağlam ölçülmüş bir kalemin önüne geçmemeli.
 *
 * İki eksenin tavanı (150+150=300), iki taban arası en küçük farktan (680→700
 * = 20, 600→680 = 80) büyük. Yani sapma yeterince büyükse bir kalem üst sınıfın
 * önüne GEÇEBİLİR — bilinçli: %141 fazla yakan bir araç, 29 gün sonra dolacak
 * bir belgeden daha acildir.
 */
export function oncelikHesapla(g: {
  kural: KuralAdi;
  aciliyet?: number;
  etki?: number;
  kesinlikCezasi?: number;
}): number {
  const taban = TABAN[g.kural];
  const aciliyet = kirp(g.aciliyet ?? 0, 0, EKSEN_TAVAN);
  const etki = kirp(g.etki ?? 0, 0, EKSEN_TAVAN);
  const ceza = kirp(g.kesinlikCezasi ?? 0, 0, EKSEN_TAVAN);
  /**
   * ⚠️ TAM SAYIYA YUVARLANIYOR — kolon `integer` (084).
   * Kuru koşumda yakalandı: sapma yüzdesi ondalıklı olduğu için puan
   * `467.05845475045584` çıkıyordu. Yazma anında sessizce yuvarlanan bir sayı,
   * "geçen hafta bu neden 4. sıradaydı" sorusunu cevaplarken ekranda başka,
   * veritabanında başka bir değer gösterirdi.
   */
  return Math.round(kirp(taban + aciliyet + etki - ceza, 0, 10000));
}

// ══════════════════════════════════════════════════════════════════════════
// SEÇİM — tavan + çeşitlilik
// ══════════════════════════════════════════════════════════════════════════

/**
 * ADAYLARDAN EN FAZLA 5 KALEM SEÇ.
 *
 * ── SIRA: önce ÖNCELİK, eşitlikte KURAL TABANI, sonra kimlik ───────────────
 * Üçüncü kırıcı (kimlik) determinizm için: aynı veri iki kez koşarsa aynı
 * liste çıkmalı, yoksa "geçen hafta neden bu vardı" sorusu cevapsız kalır.
 *
 * ── ÇEŞİTLİLİK: kural başına en fazla `KURAL_BASINA_TAVAN` ────────────────
 * Ölçümle gerekti (sabit başlığındaki gerekçe). Elenen kalemler ATILMIYOR,
 * `elenen` listesinde dönüyor: ekran "3 benzer kalem daha" diyebilsin.
 *
 * ⚠️ İKİ AŞAMALI: önce çeşitlilik uygulanır, SONRA tavan. Tersi olsaydı ilk 5
 * sıra tek kuralla dolar, çeşitlilik uygulandığında panel 2 kaleme düşerdi —
 * yani "en fazla 5" vaadi "bazen 2" olurdu.
 */
/**
 * Adayın ÖZNE KİMLİĞİ — tek kaynak.
 *
 * Sıra: şoför → araç → müşteri → (yok: filo geneli). Bu sıra `haftalik_aksiyonlar`
 * tekil indeksindeki `coalesce` sırasıyla BİREBİR aynı olmak zorunda; ayrışırsa
 * susturma ve tekillik iki farklı özneyi aynı sanar.
 */
export function ozneKimligi(a: {
  workerId: string | null;
  vehicleId: string | null;
  musteriId?: string | null;
}): string | null {
  return a.workerId ?? a.vehicleId ?? a.musteriId ?? null;
}

export function adaylariSec(adaylar: AksiyonAdayi[]): SecimSonucu {
  const sirali = [...adaylar].sort((a, b) => {
    if (b.oncelik !== a.oncelik) return b.oncelik - a.oncelik;
    if (TABAN[b.kural] !== TABAN[a.kural]) return TABAN[b.kural] - TABAN[a.kural];
    const ak = `${a.kural}:${ozneKimligi(a)}`;
    const bk = `${b.kural}:${ozneKimligi(b)}`;
    return ak.localeCompare(bk);
  });

  const sayac = new Map<string, number>();
  const cesitliGecen: AksiyonAdayi[] = [];
  const elenen: AksiyonAdayi[] = [];

  for (const a of sirali) {
    const n = sayac.get(a.kural) ?? 0;
    if (n >= KURAL_BASINA_TAVAN) {
      elenen.push(a);
      continue;
    }
    sayac.set(a.kural, n + 1);
    cesitliGecen.push(a);
  }

  const secilen = cesitliGecen.slice(0, HAFTALIK_TAVAN);
  elenen.push(...cesitliGecen.slice(HAFTALIK_TAVAN));
  return { secilen, elenen };
}

// ══════════════════════════════════════════════════════════════════════════
// SUSTURMA
// ══════════════════════════════════════════════════════════════════════════

/** Bir kural+özne için en son "ilgisiz" kapatma anı (ISO) — yoksa null. */
export type SusturmaKaydi = {
  kural: string;
  /** Özne kimliği; filo geneli kalemde null. */
  ozneId: string | null;
  kapatildiAt: string;
};

/** Susturma anahtarı — kural + özne. Filo geneli kalemde özne "filo". */
export function susturmaAnahtari(kural: string, ozneId: string | null): string {
  return `${kural}:${ozneId ?? "filo"}`;
}

/**
 * SUSTURULMUŞ MU — SAF hesap.
 *
 * "İlgisiz" kapatmanın üstünden `HAFTALIK_SUSTURMA_GUN` geçmediyse aynı
 * kural+özne için kalem ÜRETİLMEZ. Kayıt `haftalik_aksiyonlar`dan TÜRETİLİR;
 * ayrı bir susturma tablosu aynı gerçeğin ikinci kopyası olurdu (084 başlığı).
 */
export function susturulmusMu(
  kayitlar: SusturmaKaydi[],
  kural: string,
  ozneId: string | null,
  simdi: Date = new Date()
): boolean {
  const anahtar = susturmaAnahtari(kural, ozneId);
  const sinir = simdi.getTime() - HAFTALIK_SUSTURMA_GUN * 86_400_000;
  return kayitlar.some(
    (k) =>
      susturmaAnahtari(k.kural, k.ozneId) === anahtar && Date.parse(k.kapatildiAt) > sinir
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HAFTA PENCERESİ
// ══════════════════════════════════════════════════════════════════════════

/**
 * Verilen anın içinde bulunduğu haftanın PAZARTESİSİ (YYYY-MM-DD).
 *
 * ⚠️ Kiracı takvimi (Europe/Vienna) çağıranın verdiği `viennaDayKey`
 * dizesinden türetiliyor — bu dosya saf kalsın diye tarih kütüphanesi
 * çağırmıyor. Girdi zaten Viyana gününün YYYY-MM-DD'si.
 */
export function haftaBasi(viyanaGunu: string): string {
  const [y, a, g] = viyanaGunu.split("-").map(Number);
  // UTC'de kurulan bir tarih: yalnız GÜN aritmetiği yapılıyor, saat yok.
  const d = new Date(Date.UTC(y, a - 1, g));
  const dow = d.getUTCDay(); // 0=Pazar
  const geri = dow === 0 ? 6 : dow - 1; // Pazartesi'ye kaç gün geri
  d.setUTCDate(d.getUTCDate() - geri);
  return d.toISOString().slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════════
// KURALLAR — hepsi SAF: girdi ölçüm, çıktı aday
// ══════════════════════════════════════════════════════════════════════════

export type SkorGirdi = {
  workerId: string;
  ad: string;
  /** Bu haftanın skoru. */
  buHafta: number;
  /** Geçen haftanın skoru. */
  gecenHafta: number;
  /** Üç hafta öncesi — varsa gerekçeye girer, yoksa null. */
  oncekiHafta: number | null;
};

/**
 * KURAL: ŞOFÖR SKORU DÜŞÜYOR.
 *
 * İki ardışık pencere + en az `SKOR_DUSUS_ESIK` puan düşüş. Üç pencere varsa
 * ve düşüş kesintisizse gerekçe onu da yazar ("üç hafta üst üste").
 *
 * ⚠️ ÜÇ PENCERE ŞART DEĞİL — ölçüldü: HAK61'de üç ardışık hafta skoru olan
 * şoför SIFIR (kapsama kapısı yüzünden haftada yalnız 3-4 şoför skorlanıyor).
 * Üç pencere şartı bu kuralı ölü doğururdu.
 */
export function kuralSkorDususu(g: SkorGirdi): AksiyonAdayi | null {
  const dusus = g.gecenHafta - g.buHafta;
  if (dusus < SKOR_DUSUS_ESIK) return null;

  const ucHafta = g.oncekiHafta !== null && g.oncekiHafta > g.gecenHafta;
  const seri = ucHafta
    ? `${g.oncekiHafta} → ${g.gecenHafta} → ${g.buHafta}`
    : `${g.gecenHafta} → ${g.buHafta}`;

  return {
    kural: "skor_dususu",
    workerId: g.workerId,
    vehicleId: null,
    musteriId: null,
    // Aciliyet: düşüş ne kadar tazeyse o kadar acil — burada hepsi bu hafta.
    // Etki: düşüşün büyüklüğü (10 puan = 30, 50 puan = 150).
    oncelik: oncelikHesapla({ kural: "skor_dususu", aciliyet: 60, etki: dusus * 3 }),
    baslik: `${g.ad} ile konuşun — güvenlik skoru düşüyor`,
    gerekce: ucHafta
      ? `Skor üç hafta üst üste düştü: ${seri} (${dusus} puan son haftada).`
      : `Skor ${seri} (${dusus} puan düştü, iki hafta üst üste ölçüldü).`,
    kanit: {
      olculen: g.buHafta,
      onceki: g.gecenHafta,
      esik: SKOR_DUSUS_ESIK,
      birim: "puan",
      dusus,
      pencere: ucHafta ? 3 : 2,
      seri,
    },
    hedefYol: `/admin/workers/${g.workerId}`,
  };
}

export type YakitGirdi = {
  vehicleId: string;
  plaka: string;
  lPer100Km: number;
  filoOrtalama: number;
  ornekSayisi: number;
};

/**
 * KURAL: YAKIT SAPMASI (filo-göreli).
 *
 * Sabit L/100km eşiği yanlış olurdu: filo ortalaması 11,4 ve araç tipine göre
 * değişir. Eşik ORTALAMANIN YÜZDESİ; %25 ölçümle seçildi (084 başlığı §2a).
 */
export function kuralYakitSapmasi(g: YakitGirdi): AksiyonAdayi | null {
  if (g.filoOrtalama <= 0) return null;
  const sapma = ((g.lPer100Km - g.filoOrtalama) / g.filoOrtalama) * 100;
  if (sapma < YAKIT_SAPMA_YUZDE) return null;

  const esikDeger = g.filoOrtalama * (1 + YAKIT_SAPMA_YUZDE / 100);
  // Zayıf örneklem → kesinlik cezası. Az okumadan çıkan bir sapma, çok
  // okumadan çıkan bir sapmayla aynı güvende değildir.
  const ceza = g.ornekSayisi < YAKIT_ZAYIF_ORNEKLEM ? 100 : 0;

  return {
    kural: "yakit_sapmasi",
    workerId: null,
    vehicleId: g.vehicleId,
    musteriId: null,
    // Yakıt bir SÜREGELEN kayıp: aciliyeti düşük, etkisi sapmayla büyür.
    oncelik: oncelikHesapla({
      kural: "yakit_sapmasi",
      aciliyet: 20,
      etki: sapma * 1.5,
      kesinlikCezasi: ceza,
    }),
    baslik: `${g.plaka} kontrol ettirin — filo ortalamasının %${Math.round(sapma)} üstünde yakıyor`,
    gerekce: `Son ${YAKIT_PENCERE_GUN} günde ${g.lPer100Km.toFixed(1)} L/100km; filo ortalaması ${g.filoOrtalama.toFixed(1)}. Eşik: ortalamanın %${YAKIT_SAPMA_YUZDE} üstü (${esikDeger.toFixed(1)}).`,
    kanit: {
      olculen: Number(g.lPer100Km.toFixed(1)),
      esik: Number(esikDeger.toFixed(1)),
      birim: "L/100km",
      filoOrtalama: Number(g.filoOrtalama.toFixed(1)),
      sapmaYuzde: Math.round(sapma),
      ornekSayisi: g.ornekSayisi,
      pencereGun: YAKIT_PENCERE_GUN,
      ...(ceza > 0 ? { kesinlikNotu: `örneklem ${g.ornekSayisi} < ${YAKIT_ZAYIF_ORNEKLEM}` } : {}),
    },
    hedefYol: `/admin/araclar/${g.vehicleId}`,
  };
}

export type SessizGirdi = {
  vehicleId: string;
  plaka: string;
  /** Son telemetriden bu yana geçen saat; hiç veri yoksa null. */
  sessizSaat: number | null;
};

/**
 * KURAL: SESSİZ ARAÇ.
 *
 * ⚠️ DİKKAT PANOSUYLA ÇAKIŞMIYOR: orası 24 saatte "bak" diyor, burası 72
 * saatte "cihaza bakılmalı" diyor. Aynı sinyal, farklı eşik, FARKLI İŞ.
 * Bir araç üç gündür susuyorsa bu artık bir gecikme değil, bir ARIZADIR.
 */
export function kuralSessizArac(g: SessizGirdi): AksiyonAdayi | null {
  if (g.sessizSaat === null || g.sessizSaat < SESSIZ_ESIK_SAAT) return null;
  const gun = Math.floor(g.sessizSaat / 24);

  return {
    kural: "sessiz_arac",
    workerId: null,
    vehicleId: g.vehicleId,
    musteriId: null,
    // Aciliyet süreyle artar ama doyar: 3 gün ile 30 gün arasındaki fark
    // yöneticinin yapacağı işi değiştirmiyor (ikisinde de cihaza bakılacak).
    oncelik: oncelikHesapla({ kural: "sessiz_arac", aciliyet: Math.min(gun, 14) * 8, etki: 40 }),
    baslik: `${g.plaka} cihazına baktırın — ${gun} gündür sinyal yok`,
    gerekce: `Son telemetri ${gun} gün önce. Eşik: ${SESSIZ_ESIK_SAAT} saat. Araç konumu, km'si ve yakıtı bu süre boyunca ÖLÇÜLEMEDİ.`,
    kanit: {
      olculen: Math.round(g.sessizSaat),
      esik: SESSIZ_ESIK_SAAT,
      birim: "saat",
      gun,
    },
    hedefYol: `/admin/araclar/${g.vehicleId}`,
  };
}

export type BelgeGirdi = {
  workerId: string;
  ad: string;
  belgeTuru: string;
  kalanGun: number;
  sonTarih: string;
};

/**
 * KURAL: BELGE BİTİYOR.
 *
 * 30 gün: randevu alınabilir pencere. Dikkat panosu belgeyi kendi uyarı
 * gününde (tür başına `warn_days`) gösteriyor; haftalık panel "RANDEVU AL"
 * diyor — gösterge değil, iş.
 */
export function kuralBelgeBitiyor(g: BelgeGirdi): AksiyonAdayi | null {
  if (g.kalanGun > BELGE_ESIK_GUN) return null;

  const doldu = g.kalanGun < 0;
  return {
    kural: "belge_bitiyor",
    workerId: g.workerId,
    vehicleId: null,
    musteriId: null,
    // Aciliyet: gün azaldıkça hızla artar; dolmuşsa tavan.
    oncelik: oncelikHesapla({
      kural: "belge_bitiyor",
      aciliyet: doldu ? EKSEN_TAVAN : (BELGE_ESIK_GUN - g.kalanGun) * 5,
      etki: doldu ? EKSEN_TAVAN : 40,
    }),
    baslik: doldu
      ? `${g.ad} — ${g.belgeTuru} SÜRESİ DOLDU, hemen yenileyin`
      : `${g.ad} için randevu alın — ${g.belgeTuru} ${g.kalanGun} gün sonra doluyor`,
    gerekce: doldu
      ? `${g.belgeTuru} ${g.sonTarih} tarihinde doldu (${Math.abs(g.kalanGun)} gün geçti).`
      : `${g.belgeTuru} son geçerlilik ${g.sonTarih}. Eşik: ${BELGE_ESIK_GUN} gün kala.`,
    kanit: {
      olculen: g.kalanGun,
      esik: BELGE_ESIK_GUN,
      birim: "gün",
      sonTarih: g.sonTarih,
      belgeTuru: g.belgeTuru,
      doldu,
    },
    hedefYol: `/admin/workers/${g.workerId}`,
  };
}

export type BakimGirdi = {
  vehicleId: string;
  plaka: string;
  tip: string;
  eksen: "km" | "sure" | null;
  kalanKm: number | null;
  kalanGun: number | null;
  gecti: boolean;
};

/** KURAL: PERİYODİK BAKIM GECİKTİ / YAKLAŞTI (081). */
export function kuralBakimGecikti(g: BakimGirdi): AksiyonAdayi | null {
  if (!g.gecti) return null; // Yalnız GEÇMİŞ bakım aksiyon olur; yaklaşan Dikkat'te.

  const olculen = g.eksen === "km" ? g.kalanKm : g.kalanGun;
  const birim = g.eksen === "km" ? "km" : "gün";
  const asim = olculen === null ? 0 : Math.abs(olculen);

  return {
    kural: "bakim_gecikti",
    workerId: null,
    vehicleId: g.vehicleId,
    musteriId: null,
    oncelik: oncelikHesapla({
      kural: "bakim_gecikti",
      aciliyet: EKSEN_TAVAN,
      etki: g.eksen === "km" ? Math.min(asim / 20, EKSEN_TAVAN) : Math.min(asim * 3, EKSEN_TAVAN),
    }),
    baslik: `${g.plaka} servise gönderin — ${g.tip} bakımı gecikti`,
    gerekce:
      olculen === null
        ? `${g.tip} bakımı geçti (eksen ölçülemiyor).`
        : `${g.tip} bakımı ${asim} ${birim} gecikti. Eşik: 0 (bakım anı).`,
    /**
     * KANIT ŞERİDİ NEGATİF SAYI GÖSTERMEZ.
     *
     * Ham eksen değeri "kalan" (−65 gün = 65 gün geçmiş). Şerit
     * "{olculen} ölçüldü · eşik {esik} {birim}" biçiminde basıyor ve
     * "−65 ölçüldü · eşik 0 gün" okunmuyordu — render kanıtında görüldü.
     * Şeride AŞIM giriyor; ham "kalan" değeri kanıtta duruyor, kaybolmuyor.
     */
    kanit: {
      olculen: asim,
      esik: 0,
      birim,
      tip: g.tip,
      eksen: g.eksen,
      kalan: olculen,
      asim,
    },
    hedefYol: `/admin/bakim`,
  };
}

export type IsEmriGirdi = {
  emirId: string;
  vehicleId: string;
  plaka: string;
  aciklama: string;
  yasGun: number;
  oncelikEtiketi: string;
};

/** KURAL: AÇIK İŞ EMRİ BEKLİYOR (081). */
export function kuralIsEmriBekliyor(g: IsEmriGirdi): AksiyonAdayi | null {
  if (g.yasGun < IS_EMRI_ESIK_GUN) return null;
  return {
    kural: "is_emri_bekliyor",
    workerId: null,
    vehicleId: g.vehicleId,
    musteriId: null,
    oncelik: oncelikHesapla({
      kural: "is_emri_bekliyor",
      aciliyet: Math.min(g.yasGun * 4, EKSEN_TAVAN),
      etki: g.oncelikEtiketi === "yuksek" ? EKSEN_TAVAN : 50,
    }),
    baslik: `${g.plaka} iş emrini kapatın — ${g.yasGun} gündür açık`,
    gerekce: `"${g.aciklama.slice(0, 80)}" ${g.yasGun} gündür bekliyor. Eşik: ${IS_EMRI_ESIK_GUN} gün.`,
    kanit: {
      olculen: g.yasGun,
      esik: IS_EMRI_ESIK_GUN,
      birim: "gün",
      emirId: g.emirId,
      emirOnceligi: g.oncelikEtiketi,
    },
    hedefYol: `/admin/is-emirleri`,
  };
}

export type VardiyaGirdi = {
  toplam: number;
  kapanmayan: number;
};

/**
 * KURAL: VARDİYA KAPANMIYOR — FİLO GENELİ.
 *
 * ⚠️ Dikkat panosu TEK TEK kapanmamış vardiyaları gösteriyor ("şu vardiya
 * açık"). Bu kural bir DESENİ gösteriyor: "bu hafta 100 vardiyanın 9'u
 * kapanmadan kaldı". Farklı iş: tek tek düzeltmek değil, alışkanlığı düzeltmek.
 * Bu yüzden özne YOK — kalem filo geneli.
 */
export function kuralVardiyaKapanmadi(g: VardiyaGirdi): AksiyonAdayi | null {
  if (g.toplam < VARDIYA_MIN_ADET) return null;
  const oran = (g.kapanmayan / g.toplam) * 100;
  if (oran < VARDIYA_KAPANMAMA_YUZDE) return null;

  return {
    kural: "vardiya_kapanmadi",
    workerId: null,
    vehicleId: null,
    musteriId: null,
    oncelik: oncelikHesapla({
      kural: "vardiya_kapanmadi",
      aciliyet: 30,
      etki: Math.min(oran * 4, EKSEN_TAVAN),
    }),
    baslik: `Şoförlere hatırlatın — bu hafta ${g.kapanmayan} vardiya kapanmadan kaldı`,
    gerekce: `${g.toplam} vardiyanın ${g.kapanmayan} tanesi (%${oran.toFixed(0)}) kapatılmamış. Eşik: %${VARDIYA_KAPANMAMA_YUZDE}. Kapanmayan vardiya çalışma süresini ve km'yi ölçülemez kılıyor.`,
    kanit: {
      olculen: Number(oran.toFixed(1)),
      esik: VARDIYA_KAPANMAMA_YUZDE,
      birim: "%",
      kapanmayan: g.kapanmayan,
      toplam: g.toplam,
    },
    hedefYol: `/admin`,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// KURAL: MÜŞTERİ ZARAR ETTİRİYOR (085)
// ══════════════════════════════════════════════════════════════════════════

export type MusteriZararGirdi = {
  musteriId: string;
  ad: string;
  seferSayisi: number;
  gelirEur: number;
  maliyetEur: number;
  katkiPayiEur: number;
  /** Asgari örneklem — `lib/karlilik.ts` ZARAR_MIN_SEFER. */
  minSefer: number;
  pencereGun: number;
};

/**
 * KURAL: bir müşteri son `pencereGun` günde NEGATİF katkı payı üretti.
 *
 * ⚠️ EŞİK SIFIRDIR VE ÖLÇÜLMESİ GEREKMEZ: "gelir, atfedilebilen maliyeti
 * karşılamıyor" cümlesi filoya göreli değil, aritmetiktir. Filo-göreli bir
 * eşik (örn. "ortalamanın %20 altı") burada YANLIŞ olurdu — az kârlı müşteri
 * zararlı değildir.
 *
 * ⚠️ KAPI: `seferSayisi >= minSefer`. Tek seferden sözleşme sonucu çıkarmak,
 * zayıf paydadan filo ortalaması üretmenin aynısı (yakıt kuralının dersi).
 *
 * ⚠️ Buraya YALNIZ maliyeti ölçülmüş seferler girer (çağıran süzer). Maliyeti
 * bilinmeyen sefer "bedava" görünür ve müşteriyi haksız yere kârlı yapar.
 */
export function kuralMusteriZarar(g: MusteriZararGirdi): AksiyonAdayi | null {
  if (g.seferSayisi < g.minSefer) return null;
  if (g.katkiPayiEur >= 0) return null;

  const zarar = Math.abs(g.katkiPayiEur);
  const seferBasi = zarar / g.seferSayisi;

  return {
    kural: "musteri_zarar",
    workerId: null,
    vehicleId: null,
    musteriId: g.musteriId,
    oncelik: oncelikHesapla({
      kural: "musteri_zarar",
      // Aciliyet sefer SAYISINA bağlı: her sefer zararı büyütüyor.
      aciliyet: Math.min(g.seferSayisi * 10, EKSEN_TAVAN),
      // Etki doğrudan PARA: 20 € zarar = 1 puan, tavan 150 (3.000 €).
      etki: Math.min(zarar / 20, EKSEN_TAVAN),
    }),
    baslik: `${g.ad} ile fiyatı görüşün — son ${g.seferSayisi} seferde ${zarar.toFixed(0)} € zarar`,
    gerekce: `${g.pencereGun} günde ${g.seferSayisi} sefer: ${g.gelirEur.toFixed(0)} € gelir, ${g.maliyetEur.toFixed(0)} € atfedilebilen maliyet. Katkı payı ${g.katkiPayiEur.toFixed(0)} € (sefer başına ${seferBasi.toFixed(0)} € zarar). Eşik: 0 € — gelir atfedilebilen maliyeti karşılamıyor. Araç sabit gideri bu hesaba DAHİL DEĞİL, yani gerçek zarar daha büyük.`,
    kanit: {
      olculen: Number(g.katkiPayiEur.toFixed(2)),
      esik: 0,
      birim: "€",
      seferSayisi: g.seferSayisi,
      gelirEur: Number(g.gelirEur.toFixed(2)),
      maliyetEur: Number(g.maliyetEur.toFixed(2)),
      pencereGun: g.pencereGun,
      /** Ekranda ZORUNLU uyarı: bu sayı net kâr değil, katkı payı. */
      sabitGiderHaric: true,
    },
    hedefYol: `/admin/karlilik`,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// KURAL: AYIN EN İYİSİ (088)
// ══════════════════════════════════════════════════════════════════════════

export type AyinEnIyisiGirdi = {
  workerId: string;
  ad: string;
  skor: number;
  /** Kaç şoför skorlanabildi — tek kişilik "birincilik" anlamsızdır. */
  skorlananSayisi: number;
  esik: number;
  /** Dönem kalibrasyon sınırından önce mi başlıyor. */
  epokOncesi: boolean;
  donemBas: string;
};

/**
 * KURAL: dönemin en yüksek skorlu şoförünü tebrik et.
 *
 * ⚠️ ÜÇ KAPI:
 *   1. Skor eşiği geçmeli — listenin en üstü olmak "iyi" demek değildir;
 *      herkesin 30 aldığı bir ayda birinciyi tebrik etmek alay olur.
 *   2. En az 3 şoför skorlanmış olmalı. İki kişilik bir sıralamada
 *      "birincilik" bir başarı değil, bir tesadüftür.
 *   3. Dönem kalibrasyon sınırından SONRA başlamalı. Cihaz eşiği değişimini
 *      aşan bir skor, aynı cetvelle ölçülmemiş demektir.
 */
export const AYIN_EN_IYISI_MIN_SKORLANAN = 3;

export function kuralAyinEnIyisi(g: AyinEnIyisiGirdi): AksiyonAdayi | null {
  if (g.epokOncesi) return null;
  if (g.skorlananSayisi < AYIN_EN_IYISI_MIN_SKORLANAN) return null;
  if (g.skor < g.esik) return null;

  return {
    kural: "ayin_en_iyisi",
    workerId: g.workerId,
    vehicleId: null,
    musteriId: null,
    oncelik: oncelikHesapla({
      kural: "ayin_en_iyisi",
      // Aciliyet DÜŞÜK: tebrik gecikince değerini tamamen kaybetmez.
      aciliyet: 20,
      // Etki skorun eşiğin ne kadar üstünde olduğuna bağlı.
      etki: Math.min((g.skor - g.esik) * 5, EKSEN_TAVAN),
    }),
    baslik: `${g.ad} bu dönem en iyi sürücü — tebrik edin (${g.skor} puan)`,
    gerekce: `${g.donemBas} döneminde ${g.skorlananSayisi} skorlanan şoför arasında en yüksek güvenlik skoru ${g.ad}'de: ${g.skor} puan (rozet eşiği ${g.esik}). Olumlu geri bildirim şoför devrini düşüren en ucuz araçtır.`,
    kanit: {
      olculen: g.skor,
      esik: g.esik,
      birim: "puan",
      skorlananSayisi: g.skorlananSayisi,
      donemBas: g.donemBas,
    },
    hedefYol: `/admin/odul`,
  };
}


// ══════════════════════════════════════════════════════════════════════════
// SAKLAMA UYARISI (090)
// ══════════════════════════════════════════════════════════════════════════

export type SaklamaGirdi = {
  /** Uyarı eşiğini geçen TOPLAM ham satır (tüm kişisel-veri tabloları). */
  satirSayisi: number;
  /** En eski kaydın yaşı (gün). null = ölçülemedi. */
  enEskiGun: number | null;
  /** Kiracının kendi uyarı eşiği (gün). */
  uyariGun: number;
  ulkeKodu: string;
  /**
   * ⚠️ DOĞRULANMIŞ yasal çıpa. null = çıpa YOK ve cümlede SAYI GEÇMEZ.
   * Uydurma bir gün sayısı DACH müşterisine giderse sorumluluk doğar.
   */
  yasalEsikGun: number | null;
  yasalDayanak: string | null;
};

/**
 * SAKLAMA UYARISI — "şu kadar satırınız eşiği geçti".
 *
 * ⚠️ BU BİR SİLME EMRİ DEĞİL. Kalem "silin" demez, "karar verin" der: silme
 * kararı veri sorumlusunundur (müşteri), Galzura veri işleyendir.
 *
 * ⚠️ YASAL ÇIPA YOKSA CÜMLEDE SAYI GEÇMEZ. `yasalEsikGun === null` ise metin
 * yalnız kiracının kendi eşiğini anar ve "ülke çıpası doğrulanmadı" der.
 * Doğrulanmamış bir eşiği yazmak, uydurmakla aynı şeydir.
 */
export function kuralSaklamaUyarisi(g: SaklamaGirdi): AksiyonAdayi | null {
  if (g.satirSayisi <= 0) return null;
  // Eşiği geçmiş ama yaşı ölçülemiyorsa kalem üretme: "ne kadar geciktiniz"
  // sorusuna cevap veremeyen bir uyarı, eyleme dönüşmez.
  if (g.enEskiGun === null) return null;

  const asim = g.enEskiGun - g.uyariGun;
  if (asim <= 0) return null;

  const cipa = g.yasalEsikGun !== null
    ? `${g.ulkeKodu} için yasal çıpa ${g.yasalEsikGun} gün${g.yasalDayanak ? ` (${g.yasalDayanak})` : ""}.`
    : `${g.ulkeKodu} için yasal çıpa HENÜZ DOĞRULANMADI — bu satırda bilerek sayı yazmıyoruz.`;

  return {
    kural: "saklama_uyarisi",
    // ⚠️ Üçü de null: öznesi kiracının kendisi.
    workerId: null,
    vehicleId: null,
    musteriId: null,
    oncelik: oncelikHesapla({
      kural: "saklama_uyarisi",
      // Aciliyet AŞIMLA büyür: 91 günlük bir aşım hatırlatma, 400 günlük
      // aşım Almanya'nın orantısız bulduğu bandın içi demektir.
      aciliyet: Math.min((asim / Math.max(1, g.uyariGun)) * 100, EKSEN_TAVAN),
      // Etki satır sayısıyla büyür ama LOGARİTMİK: 10 bin ile 1 milyon satır
      // arasındaki fark, yöneticinin yapacağı işi 100 kat değiştirmiyor.
      etki: Math.min(Math.log10(Math.max(10, g.satirSayisi)) * 20, EKSEN_TAVAN),
    }),
    baslik: `${g.satirSayisi.toLocaleString("de-AT")} ham konum satırı saklama eşiğini geçti — karar verin`,
    gerekce: `En eski kayıt ${g.enEskiGun} günlük; kiracı eşiğiniz ${g.uyariGun} gün (aşım ${asim} gün). ${cipa} Silme kararı ve zamanı VERİ SORUMLUSUNUNDUR; sistem otomatik silmez.`,
    kanit: {
      olculen: g.enEskiGun,
      esik: g.uyariGun,
      birim: "gün",
      satirSayisi: g.satirSayisi,
      asimGun: asim,
      ulkeKodu: g.ulkeKodu,
      yasalEsikGun: g.yasalEsikGun,
      yasalCipaDogrulandi: g.yasalEsikGun !== null,
    },
    hedefYol: "/admin/saklama",
  };
}
