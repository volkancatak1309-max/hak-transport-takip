import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyMobileRequest, mobileError } from "@/lib/mobile-auth";
import { buildMobileUser, mobileTenant } from "@/lib/mobile-user";
import { kendiProfiliGuncelle } from "@/lib/profil-guncelle";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/me — geçerli accessToken ile kullanıcı + kiracı bilgisi.
 *
 * Ortak kapıyı (verifyMobileRequest) kullanan ilk uç; bundan sonraki tüm mobil
 * uçlar aynı deseni izleyecek.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return mobileError(auth.status, auth.code);

  /**
   * TELEFON — PATCH'in DÜZENLEDİĞİ ALAN OKUNABİLİR OLMAK ZORUNDA (19.09.2026).
   *
   * Jeton telefonu taşımıyor (`MobileWorker` altı alan) ve taşımamalı: numara
   * değiştiğinde eldeki jeton bayat bir numara gösterirdi. Bu yüzden KENDİ
   * kimliğine anahtarlı tek satır okunuyor (~30 ms).
   *
   * Yazılabilen ama okunamayan bir alan, profil ekranını "boş kutuya yaz"a
   * çevirirdi: şoför mevcut numarasını göremeden üzerine yazardı.
   */
  // test-visible: kendi kimliğine ANAHTARLI tek satır; liste okuması değil.
  const { data: kayit } = await supabaseAdmin
    .from("workers")
    .select("phone")
    .eq("id", auth.worker.id)
    .maybeSingle();

  return Response.json({
    ok: true,
    user: await buildMobileUser({
      id: auth.worker.id,
      name: auth.worker.name,
      is_admin: auth.worker.is_admin,
      counts_as_driver: auth.worker.counts_as_driver,
    }),
    /** PATCH ile değiştirilebilen alan — kanonik biçimde (E.164). */
    telefon: (kayit as { phone: string | null } | null)?.phone ?? null,
    mustChangePin: auth.worker.must_change_pin,
    tenant: mobileTenant(),
  });
}

/**
 * ── İZİNLİ ALANLAR — BEYAZ LİSTE, KARA LİSTE DEĞİL ────────────────────────
 *
 * Gövdede bu ikisi DIŞINDA bir alan gelirse istek 400 ile reddedilir; alan
 * sessizce yutulmaz. Kara liste (`is_admin` gelirse reddet) yazılsaydı listede
 * olmayan bir kolon eklendiği gün kapı kendiliğinden açılırdı — beyaz listede
 * yeni kolon varsayılan olarak KAPALI gelir.
 *
 * Reddedilenler arasında `rol`, `araç`, `filo`, `is_admin` da var ve bunlar
 * YETKİ alanlarıdır: kendi yetkisini yükseltebilen bir profil ucu, kimlik
 * katmanının tamamını anlamsız kılar.
 */
const IZINLI_ALANLAR = new Set(["ad", "name", "telefon", "phone"]);

/**
 * PATCH /api/mobile/me — ŞOFÖR KENDİ ADINI VE TELEFONUNU DEĞİŞTİRİR.
 *
 * ═══ KAPI: `verifyMobileRequest` — HER OTURUM, YALNIZ KENDİ KAYDI ═════════
 *
 * Kimlik GÖVDEDEN DEĞİL JETONDAN gelir; gövdede `id`/`workerId` gönderilse
 * bile beyaz listeye takılır (400). Yani bu uçla başkasının kaydına yazmanın
 * yolu yok — "kendi kaydı dışında hiçbir şey" kuralı tek satırla duruyor:
 * `workerId: auth.worker.id`.
 *
 * ═══ NEDEN PANELİN `updateWorkerAction`I ÇAĞRILMIYOR ═════════════════════
 * Gerekçe `lib/profil-guncelle.ts` başlığında ölçümle yazılı — özeti: o action
 * `requireAdmin()` istiyor ve gövdede olmayan 15 alanı `null`a çekiyor; şoför
 * adını değiştirdiğinde ehliyeti ve acil durum kişisi silinirdi. KURALLAR
 * (kanonik telefon · benzersizlik · diff · denetim izi) aynen kullanılıyor.
 *
 * ═══ HATA KODLARI ═════════════════════════════════════════════════════════
 *   401 missing_token / invalid_token / revoked / inactive
 *   400 invalid_json · alan_izinsiz (hangi alan olduğu yanıtta) ·
 *       bos_govde · errName · errPhone (E.164 değil)
 *   409 phone_taken   — numara başka bir kayıtta
 *   500 write_failed
 */
export async function PATCH(req: NextRequest) {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return mobileError(auth.status, auth.code);

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
  const ad = g.ad ?? g.name;
  const telefon = g.telefon ?? g.phone;
  if (ad === undefined && telefon === undefined) {
    return mobileError(400, "bos_govde", { izinli: [...IZINLI_ALANLAR] });
  }

  const r = await kendiProfiliGuncelle({ workerId: auth.worker.id, ad, telefon });
  if (!r.ok) {
    if (r.error === "phone_taken") return mobileError(409, "phone_taken");
    if (r.error === "not_found") return mobileError(404, "not_found");
    if (r.error === "write_failed") {
      return mobileError(500, "write_failed", { detail: r.detay });
    }
    return mobileError(400, r.error);
  }

  // Panel aynı kaydı listeliyor; iz bırakmadan bayatlamasın.
  let panelTazelendi = true;
  try {
    revalidatePath("/admin");
    revalidatePath("/panel");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    /** Hangi alanlar GERÇEKTEN değişti — boş dizi "aynı değer gönderildi". */
    degisen: r.degisen,
    user: await buildMobileUser({
      id: auth.worker.id,
      name: r.ad,
      is_admin: auth.worker.is_admin,
      counts_as_driver: auth.worker.counts_as_driver,
    }),
    telefon: r.telefon,
    panelTazelendi,
  });
}
