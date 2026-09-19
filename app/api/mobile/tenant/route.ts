import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker, requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { mobileTenant } from "@/lib/mobile-user";
import {
  kiraciAyarlari,
  kiraciAyarlariniYaz,
  BIRIM_SISTEMLERI,
  type BirimSistemi,
} from "@/lib/tenant-settings";
import { auditChange } from "@/lib/audit-change";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/tenant — kiracı ayarlarının OKUNABİLİR hâli.
 *
 * ── NEDEN AYRI UÇ, /me YETMİYOR MU ────────────────────────────────────────
 * `/me` kiracı nesnesini (kod · dil · saatDilimi · birimSistemi) zaten dönüyor
 * ve İSTEMCİNİN EKRAN ÇİZMEK için ihtiyacı olan her şey orada. Bu uç bir şeyi
 * FAZLA veriyor: değerin NEREDEN geldiğini (`kaynak`) ve tablonun var olup
 * olmadığını (`tabloYok`). Ayarlar ekranı "GİRİLDİ / VARSAYILAN" rozetini
 * bunlarla çiziyor — `/me`ye koymak, her açılışta o iki alanı taşımak olurdu.
 *
 * ── KAPI: her oturum ──────────────────────────────────────────────────────
 * Okuma `requireMobileWorker`: şoför de kendi ekranındaki saatlerin hangi
 * dilimde çizildiğini bilmeye hak sahibi ve burada kişiye ait hiçbir veri yok.
 * YAZMA (PATCH) yalnız yöneticide.
 */
export async function GET(req: NextRequest) {
  const kapi = await requireMobileWorker(req);
  if (!kapi.ok) return kapi.response;

  const ayar = await kiraciAyarlari();
  return Response.json({
    ok: true,
    tenant: await mobileTenant(),
    /** Hangi değer nereden geldi: "tablo" · "env" · "varsayilan". */
    kaynak: ayar.kaynak,
    /** migration 108 uygulanmamış → yazma yolu kapalı, zincir env'den başlıyor. */
    tabloYok: ayar.tabloYok,
    gecerli: { birimSistemi: BIRIM_SISTEMLERI },
    /** Kim, ne zaman değiştirdi — gün sınırını oynatan bir ayar için şart. */
    guncelleme: ayar.satir
      ? { an: ayar.satir.updated_at, kim: ayar.satir.updated_by }
      : null,
  });
}

/**
 * ── İZİNLİ ALANLAR — BEYAZ LİSTE ──────────────────────────────────────────
 *
 * Kara liste yazılsaydı, tabloya bir kolon eklendiği gün kapı kendiliğinden
 * açılırdı. Beyaz listede yeni kolon varsayılan olarak KAPALI gelir.
 *
 * ⚠️ PARA BİRİMİ LİSTEDE YOK ve olmayacak: EUR sabit. Para birimini ayar
 * yapmak kur dönüşümü + geçmiş kayıtların hangi kurla yazıldığı sorusunu açar;
 * yarım yapılırsa rapor sessizce yanlış toplar.
 */
const IZINLI_ALANLAR = new Set(["birimSistemi", "saatDilimi"]);

/**
 * PATCH /api/mobile/tenant — ÖLÇÜ BİRİMİ ve SAAT DİLİMİ (yalnız yönetici).
 *
 * ═══ KISMİ ════════════════════════════════════════════════════════════════
 * Gövdede olmayan alan DEĞİŞMEZ. `null` göndermek ayrı bir şey: "temizle,
 * varsayılana dön". Kullanıcı kendi girdiği bir değerden GERİ DÖNEBİLMELİ;
 * dönüş yolu olmayan ayar, ayar değil tuzaktır (076'nın kuralı).
 *
 * ⚠️ `birimSistemi: null` → 'metric' varsayılanı KOLONA YAZILIR (kolon NOT NULL,
 * altında env kademesi yok). `saatDilimi: null` → kolona GERÇEKTEN null yazılır
 * ve zincir env'e (`NEXT_PUBLIC_TENANT_TZ`), o da yoksa 'Europe/Vienna'ya düşer.
 * Fark kolonların kendisinden geliyor; bkz. lib/tenant-settings.ts.
 *
 * ═══ KAPI: YALNIZ YÖNETİCİ ════════════════════════════════════════════════
 * `requireMobileAdmin` ↔ panelde /admin/ayarlar `requireAdmin()`. Şef ve şoför
 * 403 `admin_required`. Gerekçe 076'nın maliyet oranlarıyla aynı: bu iki ayar
 * FİLONUN TAMAMINI etkiliyor, filo şefinin kapsamı ise kendi filosu — kapsamı
 * olan bir kullanıcıya kapsamsız bir kaldıraç vermek yetki tasarımında en sık
 * yapılan hata.
 *
 * ═══ SAAT DİLİMİ AĞIR BİR ALAN ════════════════════════════════════════════
 * Gün sınırını değiştiriyor: bir vardiyanın hangi güne sayıldığı, AZG
 * raporunun hangi güne düştüğü, panonun "bugün"ü buna bağlı. Bu yüzden:
 *   · doğrulama `Intl` ile (sabit liste tzdata güncellemesinde bayatlar),
 *   · değişiklik `auditChange` ile ize düşüyor,
 *   · yanıt ESKİ ve YENİ değeri birlikte döndürüyor — istemci "ne neye
 *     döndü" sorusunu kullanıcıya gösterebilsin.
 *
 * ═══ HATA KODLARI ═════════════════════════════════════════════════════════
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required
 *   400 invalid_json · alan_izinsiz (izinli küme yanıtta) · bos_govde ·
 *       gecersiz (alan: birimSistemi | saatDilimi)
 *   409 tablo_yok        — migration 108 bu kurulumda uygulanmamış
 *   500 write_failed
 */
export async function PATCH(req: NextRequest) {
  const kapi = await requireMobileAdmin(req);
  if (!kapi.ok) return kapi.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "invalid", { alan: "govde", sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  const izinsiz = Object.keys(g).filter((k) => !IZINLI_ALANLAR.has(k));
  if (izinsiz.length > 0) {
    return mobileError(400, "alan_izinsiz", {
      alanlar: izinsiz,
      izinli: [...IZINLI_ALANLAR],
    });
  }
  if (g.birimSistemi === undefined && g.saatDilimi === undefined) {
    return mobileError(400, "bos_govde", { izinli: [...IZINLI_ALANLAR] });
  }

  const yama: { birimSistemi?: BirimSistemi | null; saatDilimi?: string | null } = {};
  if (g.birimSistemi !== undefined) {
    if (g.birimSistemi !== null && typeof g.birimSistemi !== "string") {
      return mobileError(400, "gecersiz", { alan: "birimSistemi", gecerli: BIRIM_SISTEMLERI });
    }
    yama.birimSistemi = (g.birimSistemi as BirimSistemi | null) ?? null;
  }
  if (g.saatDilimi !== undefined) {
    if (g.saatDilimi !== null && typeof g.saatDilimi !== "string") {
      return mobileError(400, "gecersiz", { alan: "saatDilimi", bicim: "IANA" });
    }
    yama.saatDilimi = (g.saatDilimi as string | null) ?? null;
  }

  // ESKİ HÂL yazmadan ÖNCE okunur — sonrasında okumak yeni değeri verirdi ve
  // iz "neyin neye döndüğünü" söyleyemezdi.
  const once = await kiraciAyarlari();

  const r = await kiraciAyarlariniYaz(yama, kapi.actor.worker.id);
  if (!r.ok) {
    if (r.sebep === "gecersiz") {
      return mobileError(400, "gecersiz", {
        alan: r.alan,
        ...(r.alan === "birimSistemi" ? { gecerli: BIRIM_SISTEMLERI } : { bicim: "IANA" }),
      });
    }
    if (r.sebep === "tablo_yok") {
      // 409: istek geçerli, KURULUM elverişsiz. 400 demek istemciye "gövdeni
      // düzelt" derdi — düzeltilecek bir şey yok.
      return mobileError(409, "tablo_yok", { migration: "108_kiraci_ayarlari" });
    }
    return mobileError(500, "write_failed", { detail: r.mesaj });
  }

  const sonra = await kiraciAyarlari({ tazele: true });

  await auditChange(
    kapi.actor.worker.id,
    once.satir ? "update" : "create",
    "tenant_settings",
    "singleton",
    { unit_system: once.birimSistemi, timezone: once.satir?.timezone ?? null },
    { unit_system: sonra.birimSistemi, timezone: sonra.satir?.timezone ?? null }
  );

  // Panel aynı ayarı gösteriyor; gün sınırı değiştiyse pano da bayatlamasın.
  let panelTazelendi = true;
  try {
    revalidatePath("/admin");
    revalidatePath("/admin/ayarlar");
    revalidatePath("/panel");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    tenant: await mobileTenant(),
    kaynak: sonra.kaynak,
    /** ESKİ → YENİ: ekran kullanıcıya ne değiştiğini gösterebilsin. */
    once: { birimSistemi: once.birimSistemi, saatDilimi: once.saatDilimi },
    panelTazelendi,
  });
}
