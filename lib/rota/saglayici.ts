import "server-only";
import {
  ROTA_AZAMI_DURAK,
  ROTA_GUNLUK_TAVAN,
  ROTA_OPTIMIZASYONU_ENABLED,
  TAKIP_VARSAYILAN_SERVIS_DK,
} from "@/lib/tenant";
import type { RotaOptimizasyonSaglayici, RotaYetenegi } from "./tipler";
import { VroomSaglayici } from "./vroom";
import { GoogleSaglayici } from "./google";
import { servisHesabiCoz } from "./google-oauth";
import { SahteSaglayici } from "./sahte";

/**
 * SAĞLAYICI FABRİKASI — hangi motorun konuşacağına TEK yerde karar verilir.
 *
 * ═══ SIRA (Volkan kararı, 03.10.2026) ═══
 *
 *   1. VROOM + OSRM (kendi sunucumuz, 18.07.2026 kurulumu) — BİRİNCİL.
 *   2. Google Maps Platform — YALNIZ YEDEK. Anahtar yoksa pasif; varsa ve
 *      `ROTA_YEDEK=google` ise birincil ULAŞILAMADIĞINDA devreye girer.
 *      `ROTA_SAGLAYICI=google` ile birincil de yapılabilir (önerilmez).
 *   3. Sahte — yalnız test ve önizleme; ÜRETİMDE KURULMAZ.
 *
 * Env'ler YALNIZ sunucuda okunur; hiçbiri `NEXT_PUBLIC_` değil ve istemciye
 * yalnız `rotaYetenegi()`nin sır taşımayan özeti gider.
 *
 * ⚠️ Her erişim DÜZ LİTERAL (lib/tenant.ts başlığındaki kural): sunucuda
 * dinamik erişim de çalışırdı, ama kuralı burada delmek onu her yerde
 * tartışmaya açardı.
 */

export type SaglayiciSecimi = {
  birincil: RotaOptimizasyonSaglayici | null;
  yedek: RotaOptimizasyonSaglayici | null;
  /** Birincil neden kurulamadı — ekrana değil günlüğe/belgeye. */
  sebep: string | null;
};

function loopbackMu(url: URL): boolean {
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
}

/**
 * VROOM/OSRM adresleri — güvenlik kuralı:
 *   · loopback (yerel deneme, SSH tüneli) → sır isteğe bağlı, http serbest
 *   · başka her adres → HTTPS ZORUNLU ve sır ZORUNLU
 * Sırsız ya da düz http bir uzak adres, açık bir rota motoru demektir; o
 * kurulumda sağlayıcı hiç kurulmaz ("Rota servisi tanımlı değil").
 */
function vroomKur(): { s: VroomSaglayici | null; sebep: string | null } {
  const vroomHam = process.env.ROTA_VROOM_URL?.trim() ?? "";
  const osrmHam = process.env.ROTA_OSRM_URL?.trim() ?? "";
  const sir = process.env.ROTA_SERVIS_SIRRI?.trim() || null;
  if (!vroomHam || !osrmHam) return { s: null, sebep: "vroom_adresi_yok" };
  let vroom: URL;
  let osrm: URL;
  try {
    vroom = new URL(vroomHam);
    osrm = new URL(osrmHam);
  } catch {
    return { s: null, sebep: "vroom_adresi_gecersiz" };
  }
  for (const u of [vroom, osrm]) {
    if (loopbackMu(u)) continue;
    if (u.protocol !== "https:") return { s: null, sebep: "vroom_https_degil" };
    if (!sir) return { s: null, sebep: "vroom_sir_yok" };
  }
  return { s: new VroomSaglayici({ vroomUrl: vroom.toString(), osrmUrl: osrm.toString().replace(/\/+$/, ""), sir }), sebep: null };
}

function googleKur(): GoogleSaglayici | null {
  const sa = servisHesabiCoz(process.env.GOOGLE_ROTA_ANAHTARI);
  if (!sa) return null;
  // EEA koşulu kabul edilmişse Google sonucu Google dışı haritada çizilebilir.
  const eea = process.env.GOOGLE_HARITA_KOSULU?.trim().toLowerCase() === "eea";
  return new GoogleSaglayici(sa, eea);
}

function sahteKur(): SahteSaglayici | null {
  // Üretimde ASLA: kuş uçuşu sayıları gerçek bir müşteri ekranına çıkmamalı.
  return process.env.VERCEL_ENV === "production" ? null : new SahteSaglayici();
}

export function rotaSaglayicilari(): SaglayiciSecimi {
  const secim = (process.env.ROTA_SAGLAYICI?.trim().toLowerCase() || "vroom") as string;
  let birincil: RotaOptimizasyonSaglayici | null = null;
  let sebep: string | null = null;

  if (secim === "google") {
    birincil = googleKur();
    if (!birincil) sebep = "google_anahtari_yok";
  } else if (secim === "sahte") {
    birincil = sahteKur();
    if (!birincil) sebep = "sahte_uretimde_kapali";
  } else {
    const v = vroomKur();
    birincil = v.s;
    sebep = v.sebep;
  }

  const yedekIstek = process.env.ROTA_YEDEK?.trim().toLowerCase() === "google";
  const yedek = yedekIstek && birincil?.kod !== "google" ? googleKur() : null;

  // Birincil kurulamadıysa yedek tek başına konuşur — "servis yok"tan iyidir.
  if (!birincil && yedek) return { birincil: yedek, yedek: null, sebep };
  return { birincil, yedek, sebep };
}

/**
 * Ekranın bilmesi gereken özet — modül kapalıysa null (düğme HİÇ çizilmez).
 * Sır, adres, anahtar içermez.
 */
export function rotaYetenegi(): RotaYetenegi | null {
  if (!ROTA_OPTIMIZASYONU_ENABLED) return null;
  const { birincil } = rotaSaglayicilari();
  return {
    servisHazir: birincil !== null,
    saglayiciAdi: birincil?.ad ?? null,
    test: birincil?.kod === "sahte",
    gunlukTavan: ROTA_GUNLUK_TAVAN,
    azamiDurak: ROTA_AZAMI_DURAK,
    varsayilanServisDk: TAKIP_VARSAYILAN_SERVIS_DK,
  };
}
