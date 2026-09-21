import type { NextRequest } from "next/server";
import { requireMobileFleetView, requireMobileWorkerScoped } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import {
  listIsEmirleri,
  createIsEmri,
  isEmriYazmaIzni,
  getIsEmri,
  IS_EMRI_DURUMLARI,
  IS_EMRI_ONCELIKLERI,
  type IsEmri,
  type IsEmriDurumSuzgec,
  type IsEmriOncelik,
} from "@/lib/is-emri-db";
import { ARIZA_ACIKLAMA_MAX, arizaAciklamasiniAyikla } from "@/lib/fault-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * İŞ EMRİ UÇLARI — liste + elle açma (Faz C-1, migration 081).
 *
 * Panel karşılığı `/admin/is-emirleri`; kural gövdesi `lib/is-emri-db.ts`te ve
 * İKİ yüzey de onu çağırıyor. Bu dosyada tek bir iş kuralı yeniden yazılmadı —
 * burada yalnız HTTP sözleşmesi var: ayrıştırma, kapı, durum kodu.
 *
 * ── İKİ FARKLI KAPI, BİLEREK ──────────────────────────────────────────────
 * GET  → `requireMobileFleetView` (panelde /admin/is-emirleri requireFleetView).
 *        Şoför listeyi GÖRMEZ: kuyruk yöneticinin işi, şoförün değil.
 * POST → `requireMobileWorkerScoped` — şoför de bildirim AÇABİLİR. Arıza bir
 *        yönetici gözlemi değil; onu ilk gören direksiyondaki kişidir.
 *
 * Kapıların farklı olması "yazma okumadan gevşek" demek DEĞİL: şoförün yazması
 * kendi aracına ANAHTARLI (lib/is-emri-db.ts isEmriYazmaIzni) ve öncelik/atama
 * alanlarını gönderemez — o alanlar bir YÖNETİM kararıdır.
 */

export function isEmriSatiri(e: IsEmri) {
  return {
    id: e.id,
    plaka: e.plaka,
    aracId: e.vehicleId,
    aciklama: e.aciklama,
    durum: e.durum,
    oncelik: e.oncelik,
    kaynak: e.kaynak,
    bildiren: e.bildirenAd,
    atanan: e.atananId ? { id: e.atananId, ad: e.atananAd ?? "—" } : null,
    maliyet: e.maliyet,
    servisAt: e.servisAt,
    kapanisNotu: e.kapanisNotu,
    olusturma: e.createdAt,
    kapanis: e.closedAt,
  };
}

/**
 * GET /api/mobile/is-emirleri?durum=&arac=&oncelik=&limit=&offset=
 *
 * `durum` varsayılanı `acik`: ekran bir KUYRUK, arşiv değil (panelin
 * `yalnizAcik` varsayılanıyla aynı karar). `hepsi` kapalıları da getirir.
 * Sıra: önce öncelik (kritik→düşük), sonra tarih (yeni→eski).
 *
 * ⚠️ GEÇERSİZ SÜZGEÇ SESSİZCE YOK SAYILMAZ → 400. Sessiz düşüş, istemcinin
 * "kritik olanları süzdüm" sanıp tüm listeye bakmasına yol açardı
 * (lib/mobile-list.ts'te aynı sınıf tuzağın kaydı var).
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { fleetScope, isChief } = guard.actor;

  const url = new URL(req.url);
  const page = parsePage(url);

  const durumHam = url.searchParams.get("durum");
  const gecerliDurum: readonly string[] = [...IS_EMRI_DURUMLARI, "hepsi"];
  if (durumHam !== null && !gecerliDurum.includes(durumHam)) {
    return mobileError(400, "invalid", { alan: "durum", gecerli: gecerliDurum });
  }
  const oncelikHam = url.searchParams.get("oncelik");
  if (oncelikHam !== null && !IS_EMRI_ONCELIKLERI.includes(oncelikHam as IsEmriOncelik)) {
    return mobileError(400, "invalid", { alan: "oncelik", gecerli: IS_EMRI_ONCELIKLERI });
  }

  const { emirler, tabloYok, toplam } = await listIsEmirleri({
    vehicleIds: isChief ? fleetScope.vehicleIds : null,
    durum: (durumHam ?? "acik") as IsEmriDurumSuzgec,
    oncelik: (oncelikHam ?? undefined) as IsEmriOncelik | undefined,
    vehicleId: url.searchParams.get("arac"),
    limit: page.limit,
    offset: page.offset,
  });

  // Tablo yoksa 503: 081 çalıştırılmamış bir kurulumda boş liste dönmek
  // "iş emri yok" derdi; oysa özellik hiç kurulmamış (ariza-bildir emsali).
  if (tabloYok) return mobileError(503, "db_error", { sebep: "tablo_yok" });

  return Response.json({
    ok: true,
    emirler: emirler.map(isEmriSatiri),
    page: pageInfo(page, toplam),
  });
}

/**
 * POST /api/mobile/is-emirleri — elle iş emri aç.
 *
 * Gövde: `{ aracId, aciklama, oncelik?, atananId? }`.
 *
 * ── ŞOFÖR: ÖNCELİK VE ATAMA GÖNDEREMEZ (400) ──────────────────────────────
 * Sessizce YOK SAYMAK daha kolaydı ama yanlış olurdu: şoför "kritik" işaretleyip
 * gönderdiğini sanır, kuyrukta normal görünür ve kimse farkı bilmez. 400 +
 * `forbidden_fields` istemciye alanı adıyla söyler.
 *
 * `kaynak` GÖVDEDEN ALINMAZ: roldan türer (şoför → `surucu`, yönetici/şef →
 * `elle`). Alanı olmayan bir istek kurulamaz.
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileWorkerScoped(req);
  if (!guard.ok) return guard.response;
  const { worker, isChief, fleetScope } = guard.actor;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null) {
    return mobileError(400, "invalid", { alan: "body" });
  }
  const g = body as Record<string, unknown>;

  const aracId = typeof g.aracId === "string" ? g.aracId.trim() : "";
  if (!aracId) return mobileError(400, "missing_fields", { alan: "aracId" });

  // Açıklama ayıklaması arıza bildirimiyle ORTAK (lib/fault-reports.ts): aynı
  // tabloya yazan iki uç aynı sınırı uygulasın.
  const ayikla = arizaAciklamasiniAyikla(g);
  if (!ayikla.ok) {
    return mobileError(400, ayikla.kod, {
      alan: "aciklama",
      ...(ayikla.sebep ? { sebep: ayikla.sebep } : {}),
      ...(ayikla.kod === "too_long"
        ? { enFazla: ARIZA_ACIKLAMA_MAX, uzunluk: ayikla.uzunluk }
        : {}),
    });
  }

  const izin = await isEmriYazmaIzni(
    {
      workerId: worker.id,
      isAdmin: worker.is_admin,
      isChief,
      isFleetVehicle: (id) => fleetScope.isFleetVehicle(id),
    },
    aracId
  );
  if (!izin.ok) return mobileError(403, "kapsam_disi", { alan: "aracId" });

  const yasakli = ["oncelik", "atananId"].filter((k) => g[k] !== undefined && g[k] !== null);
  if (izin.sofor && yasakli.length > 0) {
    return mobileError(400, "forbidden_fields", {
      alanlar: yasakli,
      sebep: "surucu_oncelik_atama_gonderemez",
    });
  }

  let oncelik: IsEmriOncelik | undefined;
  if (!izin.sofor && g.oncelik !== undefined && g.oncelik !== null) {
    if (!IS_EMRI_ONCELIKLERI.includes(g.oncelik as IsEmriOncelik)) {
      return mobileError(400, "invalid", { alan: "oncelik", gecerli: IS_EMRI_ONCELIKLERI });
    }
    oncelik = g.oncelik as IsEmriOncelik;
  }
  let atananId: string | null | undefined;
  if (!izin.sofor && g.atananId !== undefined) {
    if (g.atananId !== null && typeof g.atananId !== "string") {
      return mobileError(400, "invalid", { alan: "atananId" });
    }
    atananId = (g.atananId as string | null) || null;
  }

  const r = await createIsEmri(
    { vehicleId: aracId, aciklama: ayikla.aciklama, oncelik, kaynak: izin.kaynak, atananId },
    worker.id
  );
  if (!r.ok) {
    return mobileError(503, "db_error", {
      sebep: r.sebep === "tablo_yok" ? "tablo_yok" : "yazma_hatasi",
    });
  }

  const emir = await getIsEmri(r.veri.id);
  return Response.json(
    { ok: true, emir: emir ? isEmriSatiri(emir) : { id: r.veri.id } },
    { status: 201 }
  );
}
