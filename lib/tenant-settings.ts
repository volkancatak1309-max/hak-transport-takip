import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { DEFAULT_TZ, TENANT_TZ, calismaZamaniTzAyarla, ianaGecerliMi } from "@/lib/tz";

/**
 * KİRACI AYARLARI — ÇALIŞMA ZAMANINDA OKUNAN TEK YER (19.09.2026, 108).
 *
 * ═══ NEDEN TABLO, NEDEN ENV YETMİYOR ══════════════════════════════════════
 *
 * Gerekçe 076'da (maliyet oranları) verilen kararın aynısı ve orada ölçülmüştü:
 *   1. Env değiştirmek DEPLOY gerektirir. Müşteri saat dilimini düzeltmek için
 *      bizden yeni bir dağıtım isteyemez.
 *   2. Env'i yalnız BİZ yazabiliyoruz (Vercel proje ayarları).
 *   3. "Bu firma Europe/Istanbul'da çalışıyor" cümlesi bir AYAR değil, o
 *      müşteriye ait bir VERİ. Verinin yeri veritabanı.
 *
 * Env KALDIRILMADI, rolü DEĞİŞTİ: artık yalnız VARSAYILAN sağlıyor. Öncelik
 * sırası burada, TEK yerde:
 *
 *        tablo satırı (108)  >  env (NEXT_PUBLIC_TENANT_TZ)  >  kod varsayılanı
 *
 * ═══ ⚠️ NEDEN "ÇALIŞMA ZAMANI OKUMASI TEK YERDEN" ═════════════════════════
 *
 * `NEXT_PUBLIC_TENANT_TZ` bir DERLEME SABİTİ: Next/Turbopack onu build anında
 * paketin içine gömüyor ve `lib/tz.ts`'teki `TENANT_TZ` istemcide de böyle
 * yaşıyor (65 dosya, 20'si istemci bileşeni — bkz. lib/tz.ts başlığı). Yani
 * "tabloyu okuyup her yerde kullanalım" mümkün DEĞİL: `lib/format.ts`'in gün
 * sınırı fonksiyonları SENKRON ve istemcide çalışıyor.
 *
 * Bu yüzden tablo YALNIZ BURADA okunuyor ve sonuç `calismaZamaniTzAyarla` ile
 * `lib/tz.ts`e veriliyor; oradaki `tenantTz()` sunucuda tablo değerini,
 * istemcide derleme sabitini döndürüyor. İkinci bir okuyucu yazılsaydı aynı
 * kiracı iki sunucu yüzeyinde iki farklı güne düşerdi — 09.08.2026'da panelin
 * `Europe/Vienna` sabitiyle mobilin cihaz dilimi arasında yaşanan kusurun
 * birebir aynısı.
 *
 * ═══ MIGRATION 108 YOKSA ══════════════════════════════════════════════════
 *
 * Tablo yoksa (`tabloYokMu`) sessizce env/varsayılan zincirine düşülür ve
 * `tabloYok: true` döner. Uygulamanın HİÇBİR yüzeyi bozulmaz; yalnız ayarlar
 * ekranı "migration bekliyor" der. Aynı kademeli düşüş 076 (maliyet), 058
 * (erteleme) ve 056/057'de (arıza) zaten var.
 *
 * ═══ ÖNBELLEK — NEDEN MODÜL DÜZEYİNDE VE NEDEN GÜVENLİ ════════════════════
 *
 * Değer KİRACIYA ait, kullanıcıya değil: her kiracının ayrı veritabanı ve ayrı
 * dağıtımı var (lib/brand.ts REGISTRY). Bir lambda örneğindeki değer, o örneğe
 * düşen HER isteğin doğru cevabıdır. Kullanıcı başına bir değer olsaydı bu
 * kalıp sızıntı olurdu ve yazılmazdı.
 *
 * TTL kısa (30 sn): panelden kaydeden yönetici sonucu hemen görmeli. Aynı
 * süreçte yazma önbelleği ANINDA düşürüyor; başka bir lambda örneği en geç
 * TTL kadar bayat kalır. Saat dilimi için bu kabul edilebilir — gün sınırı
 * saniyede bir değişen bir büyüklük değil.
 */

export type BirimSistemi = "metric" | "imperial";
export const BIRIM_SISTEMLERI: readonly BirimSistemi[] = ["metric", "imperial"];

/** Ölçü birimi varsayılanı. Bugüne kadar ürünün TEK davranışı buydu. */
export const VARSAYILAN_BIRIM: BirimSistemi = "metric";

/** Tablodaki ham satır. Her alan null olabilir = "kiracı girmedi". */
export type KiraciAyarSatiri = {
  unit_system: BirimSistemi | null;
  timezone: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type AyarKaynak = "tablo" | "env" | "varsayilan";

export type KiraciAyarlari = {
  birimSistemi: BirimSistemi;
  saatDilimi: string;
  /** Hangi değer nereden geldi — ekran GİRİLDİ / VARSAYILAN ayrımını yapabilsin. */
  kaynak: { birim: AyarKaynak; saatDilimi: AyarKaynak };
  /** migration 108 uygulanmamış → panel yolu kapalı, zincir env'den başlıyor. */
  tabloYok: boolean;
  /** Tabloda duran ham değerler (form bunları gösterir). Tablo yoksa null. */
  satir: KiraciAyarSatiri | null;
};

const TTL_MS = 30_000;
let onbellek: { deger: KiraciAyarlari; an: number } | null = null;

/** Önbelleği düşür — yazma yolundan çağrılır (aynı süreçte anında taze). */
export function ayarOnbelleginiDusur(): void {
  onbellek = null;
}

/** Tablo satırını okur. Tablo yoksa `{ satir: null, tabloYok: true }`. */
export async function kiraciAyarSatiri(): Promise<{
  satir: KiraciAyarSatiri | null;
  tabloYok: boolean;
}> {
  const { data, error } = await supabaseAdmin
    .from("tenant_settings")
    .select("unit_system, timezone, updated_at, updated_by")
    .eq("id", "singleton")
    .maybeSingle();

  if (error) {
    // Tablo yok → migration bekliyor (kurtarılabilir). Başka her hata da
    // uygulamayı çökertmemeli ama SESSİZ de kalmamalı: ayrı bayrakla döner.
    return { satir: null, tabloYok: tabloYokMu(error) };
  }
  return { satir: (data as KiraciAyarSatiri | null) ?? null, tabloYok: false };
}

/**
 * KİRACI AYARLARI — zincirin çözüldüğü tek fonksiyon.
 *
 * Yan etkisi VAR ve bilinçli: çözülen saat dilimini `lib/tz.ts`e veriyor.
 * Böylece aynı istekteki SENKRON sınır fonksiyonları (`startOfTodayVienna` vb.)
 * tablo değerini görüyor. Yan etkiyi çağırana bırakmak, onu unutan ilk yüzeyde
 * sessiz bir "yanlış gün" kusuru üretirdi.
 */
export async function kiraciAyarlari(
  secenek: { tazele?: boolean } = {}
): Promise<KiraciAyarlari> {
  const simdi = Date.now();
  if (!secenek.tazele && onbellek && simdi - onbellek.an < TTL_MS) {
    // Önbellekten dönerken de dilimi tazele: aynı süreçte başka bir modül
    // `calismaZamaniTzAyarla(null)` demiş olabilir.
    calismaZamaniTzAyarla(onbellek.deger.saatDilimi);
    return onbellek.deger;
  }

  const { satir, tabloYok } = await kiraciAyarSatiri();

  const birimTablo =
    satir?.unit_system && (BIRIM_SISTEMLERI as readonly string[]).includes(satir.unit_system)
      ? (satir.unit_system as BirimSistemi)
      : null;
  /**
   * ⚠️ BİRİM İÇİN ENV KADEMESİ YOK — bilerek.
   *
   * Böyle bir env hiç var olmadı; şimdi eklemek, ilk günden itibaren iki
   * kaynaklı bir alan doğururdu. Yeni bir ayarın doğru yeri doğrudan tablodur
   * (076'nın öğrettiği ders: env kademesi yalnız GEÇMİŞİ korumak için var).
   */
  const birimSistemi = birimTablo ?? VARSAYILAN_BIRIM;

  const tzTablo = satir?.timezone && ianaGecerliMi(satir.timezone) ? satir.timezone : null;
  // Env kademesi: `TENANT_TZ` zaten "env varsa env, yoksa DEFAULT_TZ" demek.
  const saatDilimi = tzTablo ?? TENANT_TZ;

  const deger: KiraciAyarlari = {
    birimSistemi,
    saatDilimi,
    kaynak: {
      birim: birimTablo ? "tablo" : "varsayilan",
      saatDilimi: tzTablo ? "tablo" : TENANT_TZ === DEFAULT_TZ ? "varsayilan" : "env",
    },
    tabloYok,
    satir,
  };

  calismaZamaniTzAyarla(deger.saatDilimi);
  onbellek = { deger, an: simdi };
  return deger;
}

export type AyarYazmaSonuc =
  | { ok: true }
  | { ok: false; sebep: "tablo_yok" | "hata" | "gecersiz"; alan?: string; mesaj?: string };

/**
 * AYARLARI YAZ — panel action'ı ve mobil PATCH aynı buradan geçer.
 *
 * `undefined` = "dokunma", `null` = "temizle, varsayılana dön". Ayrım 076'nın
 * kuralıyla aynı: kullanıcı kendi girdiği bir değerden GERİ DÖNEBİLMELİ; dönüş
 * yolu olmayan ayar, ayar değil tuzaktır.
 *
 * ⚠️ DOĞRULAMA BURADA, ÇAĞIRANDA DEĞİL. İki çağıran var (panel + mobil) ve
 * ikisi de aynı IANA kümesini kabul etmek zorunda: panelde kaydedilen bir dilim
 * telefonda reddedilirse kullanıcı hangisinin doğru olduğunu bilemez.
 */
export async function kiraciAyarlariniYaz(
  yama: { birimSistemi?: BirimSistemi | null; saatDilimi?: string | null },
  actorWorkerId: string | null
): Promise<AyarYazmaSonuc> {
  const alanlar: Record<string, unknown> = {};

  if (yama.birimSistemi !== undefined) {
    if (yama.birimSistemi !== null && !BIRIM_SISTEMLERI.includes(yama.birimSistemi)) {
      return { ok: false, sebep: "gecersiz", alan: "birimSistemi" };
    }
    alanlar.unit_system = yama.birimSistemi;
  }

  if (yama.saatDilimi !== undefined) {
    if (yama.saatDilimi !== null) {
      const tz = yama.saatDilimi.trim();
      // IANA adı `Intl` ile ÇÖZÜLEBİLİYOR mu — liste tutmuyoruz. Sabit bir
      // liste her tzdata güncellemesinde bayatlar; `Intl` çalışma zamanının
      // kendi veritabanına bakar ve doğru cevabı o verir.
      if (!tz || !ianaGecerliMi(tz)) {
        return { ok: false, sebep: "gecersiz", alan: "saatDilimi" };
      }
      alanlar.timezone = tz;
    } else {
      alanlar.timezone = null;
    }
  }

  if (Object.keys(alanlar).length === 0) return { ok: true };

  const { error } = await supabaseAdmin.from("tenant_settings").upsert(
    {
      id: "singleton",
      ...alanlar,
      updated_at: new Date().toISOString(),
      updated_by: actorWorkerId,
    },
    { onConflict: "id" }
  );
  if (error) {
    return {
      ok: false,
      sebep: tabloYokMu(error) ? "tablo_yok" : "hata",
      mesaj: error.message,
    };
  }

  // Aynı süreçte ANINDA taze; başka örnekler TTL kadar bayat kalabilir.
  ayarOnbelleginiDusur();
  await kiraciAyarlari({ tazele: true });
  return { ok: true };
}
