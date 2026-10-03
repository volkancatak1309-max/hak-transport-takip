/**
 * HAFTALIK AKSİYON KARTI — METİN, OKUMA ANINDA KULLANICININ DİLİNDE (03.10.2026).
 *
 * ═══ KUSUR ═══
 * Kart başlığı ve gerekçesi (`haftalik_aksiyonlar.baslik` / `.gerekce`, migration 084)
 * kural motorunda (`lib/haftalik-aksiyon.ts`) SABİT TÜRKÇE şablonla üretilip METİN olarak
 * saklanıyordu. Mobil Aksiyon Merkezi ve `/admin/haftalik` o metni olduğu gibi basıyordu:
 * uygulamayı İngilizce kullanan yönetici (Apple incelemecisi dahil) kartı Türkçe görüyordu;
 * Almanca kiracıda (Sendigo) bile kartlar Türkçeydi. Kanıt şeridinin birimi ("gün",
 * "saat", "puan") da Türkçe ham geliyordu.
 *
 * ═══ ÇÖZÜM: SAKLANAN YAPIDAN YENİDEN KUR ═══
 * Kart zaten YAPISAL veri de taşıyor: `kural` (tür) + `kanit` (jsonb: ölçülen, eşik, birim
 * ve kurala özel alanlar) + özne kimliği (şoför/araç). Metin bunlardan, istenen dilin
 * sözlüğüyle (`messages/*.json` › `haftalikMetin`) yeniden kurulur — MİGRATION GEREKMEZ.
 *   • İstenen dil, saklanan metnin diliyse (`kanit.metinDili`; eski satırlarda yok → "tr",
 *     çünkü eski şablonlar sabit Türkçeydi) saklanan metin AYNEN döner: o dilde kullanıcı
 *     için hiçbir şey değişmez.
 *   • Başka dil istendiyse metin kurulur. Kurmak için gereken bir değer yoksa (ör. özne
 *     silinmiş) saklanan metne düşülür — kart asla boş ya da bozuk çıkmaz.
 * Saf modül: ağ, veritabanı, saat yok; çevirmen (`t`) dışarıdan gelir (sunucuda
 * `getTranslations`, denetim betiğinde `createTranslator`).
 */

export type HaftalikDil = "tr" | "de" | "en";

/** next-intl çevirmeni (ad alanı `haftalikMetin`). */
export type HaftalikCevirmen = (anahtar: string, degerler?: Record<string, string | number>) => string;

export type HaftalikKart = {
  kural: string;
  kanit: Record<string, unknown>;
  /** Saklanan metin — geri düşüş ve aynı dilde aynen gösterim için. */
  baslik: string;
  gerekce: string;
  /** Öznenin GÜNCEL görünen adı: şoför adı ya da plaka (okuyan taraf çözer). */
  ozneAdi: string | null;
};

export type HaftalikMetin = {
  baslik: string;
  gerekce: string;
  /** Kanıt şeridinin birimi, istenen dilde (ör. "gün" → "days"). */
  birim: string | null;
  /** "saklanan" = metin aynen döndü · "kuruldu" = yeniden kuruldu · "geri_dusus" = kurulamadı. */
  kaynak: "saklanan" | "kuruldu" | "geri_dusus";
};

/** Eski satırlarda `metinDili` yok: kural motorunun şablonları sabit Türkçeydi. */
export const ESKI_METIN_DILI: HaftalikDil = "tr";

const sayi = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const metin = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Değer eksik → kurulamaz (çağıran saklanan metne düşer). */
class Eksik extends Error {}
function zorunlu<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Eksik();
  return v;
}

function bicimciler(dil: HaftalikDil) {
  const ondalik = new Intl.NumberFormat(dil, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const tam = new Intl.NumberFormat(dil, { maximumFractionDigits: 0 });
  const tarih = new Intl.DateTimeFormat(dil, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return {
    bir: (n: number) => ondalik.format(n),
    tam: (n: number) => tam.format(n),
    /** "YYYY-MM-DD" → dilin tarih biçimi; ayrıştırılamazsa olduğu gibi. */
    tarih: (s: string) => {
      const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? s : tarih.format(d);
    },
  };
}

/** Kanıt şeridinin birimi: yalnız dile bağlı üç birim çevrilir; km, %, L/100km evrensel. */
export function haftalikBirim(birim: unknown, t: HaftalikCevirmen): string | null {
  if (typeof birim !== "string") return null;
  if (birim === "gün") return t("birim.gun");
  if (birim === "saat") return t("birim.saat");
  if (birim === "puan") return t("birim.puan");
  return birim;
}

function kur(k: HaftalikKart, dil: HaftalikDil, t: HaftalikCevirmen): { baslik: string; gerekce: string } {
  const b = bicimciler(dil);
  const x = k.kanit;
  const ad = () => zorunlu(metin(k.ozneAdi));
  const olculen = () => zorunlu(sayi(x.olculen));
  const esik = () => zorunlu(sayi(x.esik));

  switch (k.kural) {
    case "skor_dususu": {
      const degerler = { ad: ad(), seri: zorunlu(metin(x.seri)), dusus: zorunlu(sayi(x.dusus)) };
      return {
        baslik: t("skor_dususu.baslik", degerler),
        gerekce: t(x.pencere === 3 ? "skor_dususu.gerekce3" : "skor_dususu.gerekce2", degerler),
      };
    }
    case "yakit_sapmasi": {
      const ortalama = zorunlu(sayi(x.filoOrtalama));
      const esikDeger = esik();
      // Yeni satırda eşik yüzdesi kanıtta; eskide eşik değeri ve ortalamadan türetilir.
      const esikYuzde = sayi(x.esikYuzde) ?? (ortalama > 0 ? Math.round((esikDeger / ortalama - 1) * 100) : null);
      return {
        baslik: t("yakit_sapmasi.baslik", { plaka: ad(), yuzde: zorunlu(sayi(x.sapmaYuzde)) }),
        gerekce: t("yakit_sapmasi.gerekce", {
          gun: zorunlu(sayi(x.pencereGun)),
          olculen: b.bir(olculen()),
          ortalama: b.bir(ortalama),
          esikYuzde: zorunlu(esikYuzde),
          esik: b.bir(esikDeger),
        }),
      };
    }
    case "sessiz_arac": {
      const gun = zorunlu(sayi(x.gun));
      return {
        baslik: t("sessiz_arac.baslik", { plaka: ad(), gun }),
        gerekce: t("sessiz_arac.gerekce", { gun, esikSaat: esik() }),
      };
    }
    case "belge_bitiyor": {
      const belge = zorunlu(metin(x.belgeTuru));
      const kalan = olculen();
      const tarih = b.tarih(zorunlu(metin(x.sonTarih)));
      if (x.doldu === true || kalan < 0) {
        return {
          baslik: t("belge_bitiyor.baslikDoldu", { ad: ad(), belge }),
          gerekce: t("belge_bitiyor.gerekceDoldu", { belge, tarih, gecen: Math.abs(kalan) }),
        };
      }
      return {
        baslik: t("belge_bitiyor.baslik", { ad: ad(), belge, gun: kalan }),
        gerekce: t("belge_bitiyor.gerekce", { belge, tarih, esik: esik() }),
      };
    }
    case "bakim_gecikti": {
      const tip = zorunlu(metin(x.tip));
      const baslik = t("bakim_gecikti.baslik", { plaka: ad(), tip });
      if (x.kalan === null) return { baslik, gerekce: t("bakim_gecikti.gerekceOlculemiyor", { tip }) };
      const asim = zorunlu(sayi(x.asim) ?? sayi(x.olculen));
      return {
        baslik,
        gerekce:
          x.birim === "km"
            ? t("bakim_gecikti.gerekceKm", { tip, asim: b.tam(asim) })
            : t("bakim_gecikti.gerekceGun", { tip, asim }),
      };
    }
    case "is_emri_bekliyor": {
      const gun = olculen();
      const aciklama = metin(x.aciklama);
      return {
        baslik: t("is_emri_bekliyor.baslik", { plaka: ad(), gun }),
        gerekce: aciklama
          ? t("is_emri_bekliyor.gerekce", { aciklama: aciklama.slice(0, 80), gun, esik: esik() })
          : t("is_emri_bekliyor.gerekceAciklamasiz", { gun, esik: esik() }),
      };
    }
    case "vardiya_kapanmadi": {
      const adet = zorunlu(sayi(x.kapanmayan));
      return {
        baslik: t("vardiya_kapanmadi.baslik", { adet }),
        gerekce: t("vardiya_kapanmadi.gerekce", {
          adet,
          toplam: zorunlu(sayi(x.toplam)),
          oran: b.tam(olculen()),
          esik: esik(),
        }),
      };
    }
    case "ayin_en_iyisi": {
      const degerler = { ad: ad(), skor: olculen() };
      return {
        baslik: t("ayin_en_iyisi.baslik", degerler),
        gerekce: t("ayin_en_iyisi.gerekce", {
          ...degerler,
          donem: b.tarih(zorunlu(metin(x.donemBas))),
          sayi: zorunlu(sayi(x.skorlananSayisi)),
          esik: esik(),
        }),
      };
    }
    case "saklama_uyarisi": {
      const ulke = zorunlu(metin(x.ulkeKodu));
      const yasalGun = sayi(x.yasalEsikGun);
      const dayanak = metin(x.yasalDayanak);
      const cipa =
        yasalGun === null
          ? t("saklama_uyarisi.cipaYok", { ulke })
          : dayanak
            ? t("saklama_uyarisi.cipaDayanak", { ulke, gun: yasalGun, dayanak })
            : t("saklama_uyarisi.cipa", { ulke, gun: yasalGun });
      return {
        baslik: t("saklama_uyarisi.baslik", { satir: b.tam(zorunlu(sayi(x.satirSayisi))) }),
        gerekce: t("saklama_uyarisi.gerekce", {
          enEski: olculen(),
          esik: esik(),
          asim: zorunlu(sayi(x.asimGun)),
          cipa,
        }),
      };
    }
    default:
      throw new Eksik();
  }
}

/**
 * Kartın metni `dil`de. Saklanan metnin dili istenen dilse aynen döner; değilse kurulur;
 * kurulamazsa saklanan metne düşer. Birim her durumda istenen dilde.
 */
export function haftalikMetni(k: HaftalikKart, dil: HaftalikDil, t: HaftalikCevirmen): HaftalikMetin {
  const birim = haftalikBirim(k.kanit.birim, t);
  const saklananDil = metin(k.kanit.metinDili) ?? ESKI_METIN_DILI;
  if (saklananDil === dil) return { baslik: k.baslik, gerekce: k.gerekce, birim, kaynak: "saklanan" };
  try {
    return { ...kur(k, dil, t), birim, kaynak: "kuruldu" };
  } catch {
    // Eksik değer (`Eksik`) ya da sözlük/biçim hatası kartı düşürmez: saklanan metin gösterilir.
    return { baslik: k.baslik, gerekce: k.gerekce, birim, kaynak: "geri_dusus" };
  }
}
