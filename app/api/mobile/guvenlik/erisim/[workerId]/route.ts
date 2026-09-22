import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { katmanDurumu, katmanKapaliYanit, kapilarKapaliYanit } from "@/lib/mobile-guvenlik";
import { accessRuleTek, ACCESS_DEFAULTS } from "@/lib/access-read";
import { muafiyetYaz, saatleriDenetle, saatleriYaz } from "@/lib/guvenlik-eylem";
import { ACCESS_GATES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IZINLI_ALANLAR = new Set(["saatler", "muaf"]);
const IZINLI_SAAT = new Set(["bas", "bit"]);

/**
 * GET   /api/mobile/guvenlik/erisim/[workerId] — kişinin erişim kuralı
 * PATCH /api/mobile/guvenlik/erisim/[workerId] — saat aralığı + muafiyet
 *
 * `setAccessHoursAction` / `setGateExemptAction`ın (panel) mobil ikizi ve AYNI
 * çekirdekleri çağırıyor (`saatleriDenetle` + `saatleriYaz`, `muafiyetYaz`).
 *
 * ═══ 🔴 "İZİNLİ ÜLKELER" YAZILAMAZ — ÜRÜNDE YAZMA YOLU YOK, ÖLÇÜLDÜ ═══
 *
 * `workers.allowed_countries` üç yerde OKUNUYOR (lib/access-gates.ts,
 * lib/access-read.ts, panel etiket sözlüğü) ve HİÇBİR YERDE yazılmıyor:
 * panelde de action yok, form alanı yok. Kolonu SQL'le dolduruluyor.
 *
 * Mobilde bir yazıcı uydursaydık panelde olmayan bir yetenek açmış olurduk ve
 * kural (ör. "geçerli ülke kodu nedir", "boş dizi kısıt mı yoksa kaldırma mı")
 * ilk kez BURADA tanımlanırdı — yani kopya değil, TEKİL bir kaynak olurdu ve
 * panel ondan habersiz kalırdı. `?ulkeler` gönderen istemci bu yüzden **400**
 * alır ve durumu öğrenir; GET tarafında alan OKUNABİLİR hâlde duruyor.
 *
 * ═══ SAAT KİLİDİ Europe/İstanbul ═══
 * Panelin geri kalanı Viyana'ya göre çalışıyor, saat kapısı İstanbul'a göre —
 * 1 saatlik kayma BİLİNÇLİ (lib/access-gates.ts) ve burada düzeltilmiyor.
 * Gövde dilimi açıkça taşıyor ki istemci kullanıcıya doğru saati göstersin.
 *
 * ═══ MUAFİYET ANAHTARI GEÇMEZ ═══
 * `gate_exempt` (048) cihaz/ülke/saat kapılarından muaf tutar; ÖLÜ ADAM
 * ANAHTARINDAN muaf tutmaz. Orada tek istisna patrondur ve öyle kalmalı,
 * yoksa "sistemi kapat" birkaç kişiyi içeride bırakan bir düğmeye dönerdi.
 * Muafiyet YETKİ ya da GÖRÜNÜRLÜK de VERMEZ.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 *   400 gecersiz_govde · bos_govde · invalid (alan: workerId | saatler | muaf | ulkeler)
 *   404 not_found
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ workerId: string }> }) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();
  if (!ACCESS_GATES_ENABLED) return kapilarKapaliYanit();

  const { workerId } = await params;
  if (!UUID.test(workerId)) {
    return mobileError(400, "invalid", { alan: "workerId", bicim: "uuid", gelen: workerId });
  }

  const kural = await accessRuleTek(workerId);
  if (!kural) return mobileError(404, "not_found", { workerId });

  return Response.json({ ok: true, ...katmanDurumu(), ...govde(kural) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workerId: string }> }
) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();
  if (!ACCESS_GATES_ENABLED) return kapilarKapaliYanit();

  const { workerId } = await params;
  if (!UUID.test(workerId)) {
    return mobileError(400, "invalid", { alan: "workerId", bicim: "uuid", gelen: workerId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "gecersiz_govde", { beklenen: "application/json" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "gecersiz_govde", { sebep: "nesne_degil" });
  }
  const yama = body as Record<string, unknown>;

  const izinsiz = Object.keys(yama).filter((k) => !IZINLI_ALANLAR.has(k));
  if (izinsiz.length > 0) {
    return mobileError(400, "invalid", {
      alanlar: izinsiz,
      izinli: [...IZINLI_ALANLAR],
      ...(izinsiz.includes("ulkeler") || izinsiz.includes("countries")
        ? {
            sebep: "ulke_yazma_yolu_yok",
            aciklama:
              "workers.allowed_countries üründe SALT OKUNUR: ne panelde ne başka bir " +
              "yüzeyde yazıcısı var, SQL ile dolduruluyor. Mobilde bir yazıcı açmak " +
              "kuralı ilk kez burada tanımlamak olurdu. GET yanıtında alan okunabilir.",
          }
        : {}),
    });
  }
  if (Object.keys(yama).length === 0) {
    return mobileError(400, "bos_govde", { izinli: [...IZINLI_ALANLAR] });
  }

  const once = await accessRuleTek(workerId);
  if (!once) return mobileError(404, "not_found", { workerId });

  // ── saatler ──────────────────────────────────────────────────────────────
  if ("saatler" in yama) {
    const s = yama.saatler;
    /**
     * `null` = KISITI KALDIR (kiracı varsayılanına dön). Bunu `{bas:"",bit:""}`
     * ile de yapabilirsiniz; çekirdek ikisini de null'a indirger.
     */
    if (s === null) {
      const r = await saatleriYaz(workerId, null, null, guard.actor.worker.id);
      if (!r.ok) return mobileError(503, "db_error", { sebep: r.error ?? "hata" });
    } else {
      if (typeof s !== "object" || Array.isArray(s)) {
        return mobileError(400, "invalid", {
          alan: "saatler",
          bicim: "{bas,bit} | null",
          gelen: s,
        });
      }
      const alt = s as Record<string, unknown>;
      const altIzinsiz = Object.keys(alt).filter((x) => !IZINLI_SAAT.has(x));
      if (altIzinsiz.length > 0) {
        return mobileError(400, "invalid", {
          alan: "saatler",
          alanlar: altIzinsiz,
          izinli: [...IZINLI_SAAT],
        });
      }
      /**
       * Biçim ve "tek uç boş kabul edilmez" kuralı ÇEKİRDEKTEN. Uçta ikinci bir
       * regex yok — panel ile telefon aynı cümleyi söylemek zorunda.
       */
      const d = saatleriDenetle(
        alt.bas === undefined || alt.bas === null ? "" : String(alt.bas),
        alt.bit === undefined || alt.bit === null ? "" : String(alt.bit)
      );
      if (d.hata !== null) {
        return mobileError(400, "invalid", {
          alan: "saatler",
          sebep: d.hata,
          aciklama:
            d.hata === "bicim"
              ? "Saat biçimi SS:DD olmalı (ör. 07:00)."
              : "İki ucu birlikte doldurun ya da ikisini de boşaltın; tek uç, " +
                "diğerini varsayılandan alan ve kastedilmeyen bir aralık doğurur.",
        });
      }
      const r = await saatleriYaz(workerId, d.start, d.end, guard.actor.worker.id);
      if (!r.ok) return mobileError(503, "db_error", { sebep: r.error ?? "hata" });
    }
  }

  // ── muafiyet ─────────────────────────────────────────────────────────────
  if ("muaf" in yama) {
    if (typeof yama.muaf !== "boolean") {
      return mobileError(400, "invalid", { alan: "muaf", bicim: "boolean", gelen: yama.muaf });
    }
    const r = await muafiyetYaz(workerId, yama.muaf, guard.actor.worker.id);
    if (!r.ok) return mobileError(503, "db_error", { sebep: r.error ?? "hata" });
  }

  const sonra = await accessRuleTek(workerId);
  if (!sonra) return mobileError(503, "db_error", { sebep: "okunamadi" });

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/guvenlik");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    ...katmanDurumu(),
    once: govde(once),
    sonra: govde(sonra),
    panelTazelendi,
  });
}

type Kural = NonNullable<Awaited<ReturnType<typeof accessRuleTek>>>;

/** Tek gövde biçimi — GET ve PATCH aynı alanları döndürür. */
function govde(k: Kural) {
  return {
    workerId: k.id,
    ad: k.name,
    aktif: k.is_active,
    patron: k.is_owner,
    saatler: {
      /** Kişiye özel aralık; `null` → kiracı varsayılanı geçerli. */
      bas: k.start,
      bit: k.end,
      etkin: k.etkin,
      /** ⚠️ Saat kapısı Europe/İstanbul'a göre işler — panelin geri kalanı Viyana. */
      saatDilimi: "Europe/Istanbul",
      varsayilan: ACCESS_DEFAULTS.hours,
    },
    ulkeler: {
      /** Kişiye özel liste; `null` → kiracı varsayılanı. SALT OKUNUR (başlık §). */
      kisisel: k.countries,
      etkin: k.etkinCountries,
      varsayilan: ACCESS_DEFAULTS.countries,
      yazilabilir: false,
      yazilamazSebep: "ulke_yazma_yolu_yok",
    },
    muafiyet: {
      muaf: k.gate_exempt,
      /** 048: cihaz + ülke + saat. ANAHTAR (kapı 4) muafiyeti GEÇMEZ. */
      kapsam: ["cihaz", "ulke", "saat"],
      anahtariGecer: false,
      yetkiVerir: false,
      gorunurlukVerir: false,
    },
  };
}
