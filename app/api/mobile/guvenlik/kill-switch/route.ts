import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { clientIpFromHeaders } from "@/lib/auth-core";
import { katmanDurumu, katmanKapaliYanit, kapilarKapaliYanit } from "@/lib/mobile-guvenlik";
import { getKillSwitchState } from "@/lib/kill-switch";
import {
  ANAHTAR_ONAY_METNI,
  anahtarCek,
  anahtarGeriAl,
  anahtarKurulumu,
} from "@/lib/guvenlik-eylem";
import { ACCESS_GATES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISLEMLER = ["ac", "kapa"] as const;

/**
 * POST /api/mobile/guvenlik/kill-switch
 *
 * Gövde: `{ islem: "ac" | "kapa", onay?: string, cevap?: string, sebep?: string }`
 *
 * `killSwitchConfirmAction` + `killSwitchActivateAction` +
 * `killSwitchDeactivateAction`ın (panel) mobil ikizi ve AYNI çekirdeği
 * çağırıyor (`anahtarCek` / `anahtarGeriAl`).
 *
 * ═══ 🔴 KELİME UYARISI — "ac" ANAHTARI ÇEKER, SİSTEMİ KAPATIR ═══
 *
 * Panelin ekran dili ile bu ucun gövde dili TERS okunabiliyor ve bu bilinçli
 * olarak burada yazılı duruyor:
 *
 *   `islem: "ac"`   → ANAHTARI AKTİF ET  → 🔴 **SİSTEM KAPANIR**
 *                     Patron HARİÇ herkesin web ve mobil oturumu düşer
 *                     (`session_version` + `token_version` artar) ve kimse
 *                     yeniden giremez. Panelde bu düğmenin adı "Sistemi kapat".
 *   `islem: "kapa"` → ANAHTARI GERİ AL   → SİSTEM ESKİ HÂLİNE DÖNER
 *                     Panelde bu "anahtarı aç".
 *
 * Yani "ac" sistemi açmaz, ANAHTARI açar. Yanıt gövdesi her iki durumda da
 * `sistemDurumu` alanını taşır (`kapali` / `acik`) — istemci kelimeye değil o
 * alana bakmalı.
 *
 * ═══ İKİ AŞAMALI DOĞRULAMA AYNEN ═══
 * Panel iki ayrı düğmeyle ilerliyor: önce "ONAYLIYORUM" metni, sonra gizli
 * soru. Mobil ikisini TEK gövdede alır ama sırayı ve iz yazımını aynen
 * uygular (`anahtarCek`):
 *
 *   1. onay metni yanlış → `confirm_mismatch`, deneme ize yazılır
 *   2. ÖNCE KİLİT denetlenir, SONRA cevap doğrulanır — tersi olsaydı kilitli
 *      bir anahtarda bile cevap denenebilir, yani kilit deneme sayısını
 *      sınırlamamış olurdu
 *   3. her durumda `kill_switch_attempts`e satır yazılır
 *
 * 🔴 **HER YANLIŞ CEVAP BİR HAKKI YAKAR.** Üçüncü yanlışta anahtar **24 saat**
 * kilitlenir ve o süre boyunca DOĞRU cevapla bile çekilemez. Yanıt `kalanHak`
 * taşır.
 *
 * ═══ GERİ ALMA GİZLİ SORU İSTEMEZ ═══
 * Kapatmak yıkıcı, açmak onarıcı bir eylemdir. Geri almayı da üç aşamaya
 * bağlasaydık, sistemi yanlışlıkla kapatan patron kendi anahtarının arkasında
 * kalırdı (046 kararı). `kapa` yalnız `islem` ister.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 *   400 gecersiz_govde · invalid (alan: islem | onay | cevap)
 *   403 confirm_mismatch · wrong_answer · locked
 *   409 zaten_aktif / zaten_kapali
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();
  if (!ACCESS_GATES_ENABLED) return kapilarKapaliYanit();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "gecersiz_govde", { beklenen: "application/json" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "gecersiz_govde", { sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  const islem = String(g.islem ?? "");
  if (!(ISLEMLER as readonly string[]).includes(islem)) {
    return mobileError(400, "invalid", {
      alan: "islem",
      gecerli: ISLEMLER,
      gelen: g.islem ?? null,
      aciklama:
        "'ac' = anahtarı ÇEK → SİSTEM KAPANIR (patron hariç herkes düşer). " +
        "'kapa' = anahtarı geri al → sistem eski hâline döner.",
    });
  }

  const durumOnce = await getKillSwitchState();

  // ── GERİ ALMA ────────────────────────────────────────────────────────────
  if (islem === "kapa") {
    if (!durumOnce.active) {
      return mobileError(409, "zaten_kapali", {
        aciklama: "Anahtar zaten çekili değil; sistem açık.",
        sistemDurumu: "acik",
      });
    }
    const r = await anahtarGeriAl(guard.actor.worker.id);
    if (!r.ok) return mobileError(503, "db_error", { sebep: r.error ?? "hata" });

    let panelTazelendi = true;
    try {
      revalidatePath("/admin/guvenlik");
    } catch {
      panelTazelendi = false;
    }
    const sonra = await getKillSwitchState();
    return Response.json({
      ok: true,
      ...katmanDurumu(),
      islem,
      anahtarAktif: sonra.active,
      /** İstemci kelimeye değil BUNA baksın. */
      sistemDurumu: sonra.active ? "kapali" : "acik",
      panelTazelendi,
    });
  }

  // ── ANAHTARI ÇEK (SİSTEMİ KAPAT) ─────────────────────────────────────────
  if (durumOnce.active) {
    return mobileError(409, "zaten_aktif", {
      aciklama: "Anahtar zaten çekili; sistem kapalı.",
      sistemDurumu: "kapali",
      aktifOlduAn: durumOnce.activatedAt,
    });
  }

  const onay = g.onay === undefined || g.onay === null ? "" : String(g.onay);
  const cevap = g.cevap === undefined || g.cevap === null ? "" : String(g.cevap);
  const sebep = g.sebep === undefined || g.sebep === null ? null : String(g.sebep).slice(0, 300);

  if (!cevap.trim()) {
    return mobileError(400, "invalid", {
      alan: "cevap",
      sebep: "bos",
      soru: (await anahtarKurulumu()).soru,
      kalanHak: durumOnce.kalanHak,
      aciklama: "Boş cevap DENEME OLARAK SAYILMAZ; hak yakılmadan reddedilir.",
    });
  }

  const ip = clientIpFromHeaders(req.headers);
  const r = await anahtarCek(guard.actor.worker.id, ip, onay, cevap, sebep);

  if (!r.ok) {
    const sonra = await getKillSwitchState();
    if (r.error === "confirm_mismatch") {
      return mobileError(403, "confirm_mismatch", {
        alan: "onay",
        beklenen: ANAHTAR_ONAY_METNI,
        asama: r.asama,
        /** Onay metni yanlışsa gizli soru HİÇ denenmez — hak yanmaz. */
        kalanHak: sonra.kalanHak,
        sistemDurumu: "acik",
      });
    }
    if (r.error === "locked") {
      return mobileError(403, "locked", {
        asama: r.asama,
        kilitliBitis: r.lockedUntil ?? null,
        kalanHak: 0,
        sistemDurumu: "acik",
        aciklama: "Üç yanlış cevap → 24 saat kilit. Doğru cevapla bile çekilemez.",
      });
    }
    if (r.error === "wrong_answer") {
      return mobileError(403, "wrong_answer", {
        asama: r.asama,
        kalanHak: r.kalanHak ?? sonra.kalanHak,
        sistemDurumu: "acik",
        aciklama: "Cevap yanlış. Bir hak yakıldı; üçüncü yanlışta 24 saat kilit.",
      });
    }
    return mobileError(503, "db_error", { sebep: r.error ?? "hata" });
  }

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/guvenlik");
  } catch {
    panelTazelendi = false;
  }
  const sonra = await getKillSwitchState();
  return Response.json({
    ok: true,
    ...katmanDurumu(),
    islem,
    anahtarAktif: sonra.active,
    sistemDurumu: sonra.active ? "kapali" : "acik",
    aktifOlduAn: sonra.activatedAt,
    sebep: sonra.reason,
    /** Patron hariç herkesin oturumu düştü — `dropNonOwnerSessions`. */
    oturumlarDusuruldu: true,
    panelTazelendi,
  });
}
