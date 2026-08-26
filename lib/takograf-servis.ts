import "server-only";

import { SERVIS_ZAMAN_ASIMI_MS, type ServisCevabi } from "@/lib/takograf";

/**
 * TAKOGRAF OKUYUCU SERVİSİ — istemci (Faz 3 Adım 1'de kuruldu).
 *
 * Servis: Hetzner (Almanya), 127.0.0.1:8790, dışarıya Cloudflare Tunnel
 * "galzura-fleet" üzerinden `https://takograf.galzura.com`.
 *
 * ⚠️ Proofcan'ın tünelinden AYRI bir tünel — iki ürün ayrı kalıyor.
 *
 * ═══ SERVİS BİR ÇEVİRMENDİR, ARŞİV DEĞİL ═══
 *
 * Dört kural (Volkan onayı): AB'de koşar · gövdeyi loglamaz · diske yazmaz ·
 * saklama sıfır. Dosyanın KALICI kopyası Supabase Storage'dadır.
 *
 * Bu yüzden çağrı sırası şudur ve tersine çevrilemez:
 *   1. Dosya Storage'a yazılır  ← arşiv sözü burada tutulur
 *   2. Satır veritabanına yazılır
 *   3. ANCAK SONRA servise sorulur
 * Servis düşse bile müşteri dosyasını kaybetmez.
 */

export type ServisSonucu =
  | { ok: true; cevap: ServisCevabi }
  /** Servis cevap verdi ama dosyayı okuyamadı → `basarisiz` */
  | { ok: false; tur: "reddedildi"; hata: string }
  /** Servise ulaşılamadı → `bekliyor`, sonra yeniden denenir */
  | { ok: false; tur: "erisilemedi"; hata: string };

export function servisYapilandirildi(): boolean {
  return Boolean(process.env.TAKOGRAF_URL && process.env.TAKOGRAF_SECRET);
}

/**
 * Ham baytları servise gönderir.
 *
 * ⚠️ İKİ BAŞARISIZLIK TÜRÜ AYRI TUTULUR ve bu ayrım ürünün davranışını
 * belirler:
 *
 *   'reddedildi'   — servis çalıştı, dosya bozuk/tanınmıyor (HTTP 4xx).
 *                    Yeniden denemek İŞE YARAMAZ. `basarisiz` yazılır.
 *   'erisilemedi'  — ağ/zaman aşımı/5xx. Dosyada sorun YOK, biz ulaşamadık.
 *                    `bekliyor` kalır, sonra yeniden denenir.
 *
 * İkisini tek "hata"ya indirmek, sağlam bir dosyayı kalıcı olarak bozuk
 * damgalamak ya da bozuk bir dosyayı sonsuza dek yeniden denemek demekti.
 */
export async function servisAyristir(ham: Uint8Array): Promise<ServisSonucu> {
  const taban = process.env.TAKOGRAF_URL;
  const sir = process.env.TAKOGRAF_SECRET;
  if (!taban || !sir) {
    return { ok: false, tur: "erisilemedi", hata: "servis_yapilandirilmadi" };
  }

  const iptal = AbortSignal.timeout(SERVIS_ZAMAN_ASIMI_MS);
  let res: Response;
  try {
    res = await fetch(`${taban.replace(/\/+$/, "")}/parse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sir}`,
        "Content-Type": "application/octet-stream",
      },
      body: ham as unknown as BodyInit,
      signal: iptal,
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, tur: "erisilemedi", hata: kisalt(String((e as Error)?.message ?? e)) };
  }

  if (res.ok) {
    try {
      return { ok: true, cevap: (await res.json()) as ServisCevabi };
    } catch (e) {
      // Servis 200 döndü ama gövde okunamadı — bizim tarafımızda bir sorun,
      // dosyayı suçlamıyoruz.
      return { ok: false, tur: "erisilemedi", hata: kisalt(`gecersiz_cevap: ${String(e)}`) };
    }
  }

  const govde = await res.text().catch(() => "");
  const mesaj = kisalt(`HTTP ${res.status}: ${sebepCikar(govde)}`);

  /**
   * ⚠️ 401 'erisilemedi' sayılıyor, 'reddedildi' DEĞİL.
   * Yanlış sır bizim yapılandırma hatamızdır; dosyayı kalıcı olarak bozuk
   * damgalamak yanlış olurdu. Sır düzeltilince yeniden denenir.
   */
  if (res.status === 401 || res.status === 403 || res.status >= 500) {
    return { ok: false, tur: "erisilemedi", hata: mesaj };
  }
  return { ok: false, tur: "reddedildi", hata: mesaj };
}

function sebepCikar(govde: string): string {
  try {
    const j = JSON.parse(govde) as { hata?: string; sebep?: string };
    return [j.hata, j.sebep].filter(Boolean).join(" — ") || govde;
  } catch {
    return govde;
  }
}

function kisalt(s: string, n = 400): string {
  const v = s.replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

/** Sağlık ucu — ekranda "servis çalışıyor mu" göstermek için. */
export async function servisSagligi(): Promise<{ ayakta: boolean; sebep?: string }> {
  const taban = process.env.TAKOGRAF_URL;
  if (!taban) return { ayakta: false, sebep: "yapilandirilmadi" };
  try {
    const res = await fetch(`${taban.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    return res.ok ? { ayakta: true } : { ayakta: false, sebep: `HTTP ${res.status}` };
  } catch (e) {
    return { ayakta: false, sebep: kisalt(String((e as Error)?.message ?? e), 80) };
  }
}
