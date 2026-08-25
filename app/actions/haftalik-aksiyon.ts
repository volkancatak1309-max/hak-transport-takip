"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED, type FleetScope } from "@/lib/fleet-scope";
import {
  getTur,
  listTurlar,
  aksiyonKapat,
  type HaftalikAksiyon,
  type HaftalikTur,
} from "@/lib/haftalik-aksiyon-db";
import { HAFTALIK_SUSTURMA_GUN, HAFTALIK_TAVAN, type Tarama } from "@/lib/haftalik-aksiyon";
import { audit } from "@/lib/security-log";

/**
 * HAFTALIK AKSİYON PANELİ — sunucu eylemleri (migration 084).
 *
 * ═══ KAPI: YÖNETİCİ VEYA FİLO ŞEFİ ═══
 *
 * `requireFleetView`. Şef de görür ama KAPSAMLI: kalemin öznesi kendi
 * filosunda değilse satır ona GÖNDERİLMEZ. Filo geneli kalemler (özne yok)
 * herkese açık — "bu hafta 9 vardiya kapanmadı" bir filo gerçeği.
 *
 * ⚠️ Kapsam SUNUCUDA süzülüyor, ekranda gizlenmiyor: şefin göremeyeceği bir
 * aracın plakası gövdeye hiç girmiyor.
 */

export type AksiyonGorunum = HaftalikAksiyon & {
  /** Öznenin okunur adı — şoför adı ya da plaka. */
  ozneAd: string | null;
  /** Bu kural+özne için susturma ne zaman biter (ilgisiz kapatıldıysa). */
  susturmaBitis: string | null;
};

export type HaftalikPanel = {
  tur: HaftalikTur | null;
  aksiyonlar: AksiyonGorunum[];
  /** Geçmiş haftalar — seçici için. */
  haftalar: { haftaBasi: string; aksiyonSayisi: number; acikSayisi: number }[];
  /** 084 uygulanmamış. */
  tabloYok: boolean;
  /** Şef ise filo kodu. */
  fleet: string | null;
  /** Panelin kendi sabitleri — ekran sayıları GÖMMESİN. */
  tavan: number;
  susturmaGun: number;
};

async function kapsam(): Promise<{
  workerId: string | null;
  scope: FleetScope;
  fleet: string | null;
}> {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  return { workerId: session.worker_id ?? null, scope, fleet };
}

/**
 * Kalem bu kapsamda görünür mü — özne yoksa (filo geneli) HERKESE açık.
 *
 * ⚠️ MÜŞTERİ ÖZNESİ (085) FİLOYA BÖLÜNMEZ. Bir müşteri bordo ve mavi filonun
 * ikisiyle de çalışabilir; kalemi bir filoya atamak keyfî olurdu. Kârlılık
 * bir FİLO GERÇEĞİ değil ŞİRKET gerçeğidir — o yüzden filo geneli kalemlerle
 * aynı kolda: şef de görür.
 */
function kapsamda(a: HaftalikAksiyon, scope: FleetScope): boolean {
  if (a.workerId) return scope.isFleetWorker(a.workerId);
  if (a.vehicleId) return scope.isFleetVehicle(a.vehicleId);
  return true;
}

/**
 * PANELİ GETİR — verilen hafta ya da EN SON tur.
 *
 * Özne adları TEK sorguda çözülüyor: kalem başına sorgu (N+1) 5 satır için
 * 5 gidiş dönüş olurdu ve panel bir "hızlı bakış" ekranı.
 */
export async function getHaftalikPanel(haftaBasiGunu?: string): Promise<HaftalikPanel> {
  const { workerId, scope, fleet } = await kapsam();
  await audit(workerId, "page_view", `/admin/haftalik${haftaBasiGunu ? `?hafta=${haftaBasiGunu}` : ""}`);

  const [{ tur, aksiyonlar, tabloYok }, { turlar }] = await Promise.all([
    getTur(haftaBasiGunu),
    listTurlar(12),
  ]);

  const gorunur = aksiyonlar.filter((a) => kapsamda(a, scope));

  // ── Özne adları
  const workerIds = [...new Set(gorunur.map((a) => a.workerId).filter(Boolean))] as string[];
  const vehicleIds = [...new Set(gorunur.map((a) => a.vehicleId).filter(Boolean))] as string[];
  const musteriIds = [...new Set(gorunur.map((a) => a.musteriId).filter(Boolean))] as string[];
  const [w, v, m] = await Promise.all([
    workerIds.length
      ? supabaseAdmin.from("workers").select("id, name").in("id", workerIds)
      : Promise.resolve({ data: [] }),
    vehicleIds.length
      ? supabaseAdmin.from("vehicles").select("id, plate").in("id", vehicleIds)
      : Promise.resolve({ data: [] }),
    musteriIds.length
      ? supabaseAdmin.from("musteriler").select("id, ad").in("id", musteriIds)
      : Promise.resolve({ data: [] }),
  ]);
  const ad = new Map(((w.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const plaka = new Map(
    ((v.data ?? []) as { id: string; plate: string }[]).map((r) => [r.id, r.plate])
  );
  // 085 uygulanmamış kurulumda sorgu hata döner ve `data` boş kalır — kalem
  // yine görünür, yalnız adı çözülmez. Ekran "—" gösterir, çökmez.
  const musteriAd = new Map(
    ((m.data ?? []) as { id: string; ad: string }[]).map((r) => [r.id, r.ad])
  );

  return {
    tur,
    aksiyonlar: gorunur.map((a) => ({
      ...a,
      ozneAd: a.workerId
        ? (ad.get(a.workerId) ?? null)
        : a.vehicleId
          ? (plaka.get(a.vehicleId) ?? null)
          : a.musteriId
            ? (musteriAd.get(a.musteriId) ?? null)
            : null,
      susturmaBitis:
        a.durum === "ilgisiz" && a.kapatildiAt
          ? new Date(Date.parse(a.kapatildiAt) + HAFTALIK_SUSTURMA_GUN * 86_400_000).toISOString()
          : null,
    })),
    haftalar: turlar.map((t) => ({
      haftaBasi: t.haftaBasi,
      aksiyonSayisi: t.aksiyonSayisi,
      // Açık sayısı yalnız GÖRÜNTÜLENEN turda kesin; listede tur toplamı yeter.
      acikSayisi: t.aksiyonSayisi,
    })),
    tabloYok,
    fleet,
    tavan: HAFTALIK_TAVAN,
    susturmaGun: HAFTALIK_SUSTURMA_GUN,
  };
}

export type KapatSonuc =
  | { ok: true }
  | { ok: false; hata: "kapsam_disi" | "yok" | "zaten_kapali" | "tablo_yok" | "hata" };

/**
 * AKSİYONU KAPAT — "yaptım" ya da "ilgisiz".
 *
 * ⚠️ KAPSAM ÖNCE: şef kendi filosu dışındaki bir kalemi kapatamaz. Kalem
 * gövdesine hiç girmemiş olsa bile kimliğini tahmin edip kapatmayı denemek
 * mümkün — kapı burada.
 */
export async function haftalikAksiyonKapat(
  id: string,
  durum: "yapildi" | "ilgisiz",
  not?: string | null
): Promise<KapatSonuc> {
  const { workerId, scope } = await kapsam();

  const { data } = await supabaseAdmin
    .from("haftalik_aksiyonlar")
    .select("id, kural, worker_id, vehicle_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, hata: "yok" };
  const satir = data as { kural: string; worker_id: string | null; vehicle_id: string | null };
  const kalem = {
    workerId: satir.worker_id,
    vehicleId: satir.vehicle_id,
  } as HaftalikAksiyon;
  if (!kapsamda(kalem, scope)) return { ok: false, hata: "kapsam_disi" };

  const r = await aksiyonKapat(id, durum, workerId, not);
  if (!r.ok) return { ok: false, hata: r.sebep === "tablo_yok" ? "tablo_yok" : r.sebep === "zaten_kapali" ? "zaten_kapali" : r.sebep === "yok" ? "yok" : "hata" };

  await audit(workerId, "update", `haftalik_aksiyon:${durum}:${satir.kural}:${id}`);
  revalidatePath("/admin/haftalik");
  return { ok: true };
}

/** Tarama sayaçları — ekranın "kural çalıştı mı" bölümü. */
export type TaramaGorunum = { kural: string; aday: number; gecen: number; esik: string; atlandi: string | null };

export async function getTaramaOzeti(tarama: Tarama): Promise<TaramaGorunum[]> {
  return Object.entries(tarama).map(([kural, v]) => ({
    kural,
    aday: v?.aday ?? 0,
    gecen: v?.gecen ?? 0,
    esik: v?.esik ?? "",
    atlandi: v?.atlandi ?? null,
  }));
}
