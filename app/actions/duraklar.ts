"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView, requireWorker } from "@/lib/session";
import { getFleetScope, UNRESTRICTED, type FleetScope } from "@/lib/fleet-scope";
import { getSeferById, ACIK_DURUMLAR, type SeferRow } from "@/lib/sefer-db";
import {
  listDuraklar,
  insertDurak,
  patchDurak,
  deleteDurak,
  siralaDuraklar,
  ilerletDurak,
  durumSifirla,
  getDurak,
  durakOzeti,
  type DurakRow,
  type DurakDurum,
  type DurakGirdi,
  type DurakOzeti,
} from "@/lib/sefer-duraklari";
import { audit } from "@/lib/security-log";

/**
 * SEFER DURAKLARI — sunucu eylemleri (migration 082).
 *
 * ═══ İKİ YÜZEY, İKİ KAPI ═══
 *
 * YÖNETİCİ/ŞEF (`requireFleetView`) durak listesini KURAR: ekler, düzenler,
 * sıralar, siler, yanlış basılmış bir durumu sıfırlar.
 * ŞOFÖR (`requireWorker`) durak listesini İLERLETİR ve yalnız KENDİ seferinde.
 *
 * Kapılar ayrı fonksiyonlarda; tek fonksiyona "mine" bayrağı koymak iki yetki
 * modelini tek gövdede yaşatmak olurdu (app/actions/seferler.ts'teki aynı
 * gerekçe).
 *
 * ═══ KAPSAM ŞOFÖR EKSENİNDE ═══
 *
 * Durağın kendi filo alanı yok; kapsam seferin şoförü üzerinden çözülüyor —
 * `seferler` tarafındaki kuralın aynısı. Şef kendi filosu dışındaki bir seferin
 * durağına dokunamaz.
 */

export type DurakGorunum = DurakRow & {
  /** Bölge adı — bölge silinmişse null (durak yaşar, hedefi boşalır). */
  bolge_ad: string | null;
  /** Bu durağa bırakılmış GEÇERLİ kanıt var mı (080/082). */
  kanitVar: boolean;
};

export type DurakListesi = {
  duraklar: DurakGorunum[];
  ozet: DurakOzeti;
  /** 082 uygulanmamış — ekran "bu kurulumda kapalı" der. */
  tabloYok: boolean;
};

export type DurakSonuc =
  | { ok: true; id?: string }
  | {
      ok: false;
      hata:
        | "kapsam_disi"
        | "sefer_yok"
        | "sefer_kapali"
        | "durak_yok"
        | "tablo_yok"
        | "sira_cakismasi"
        | "eksik_id"
        | "gecersiz_gecis"
        | "kapali_durak"
        | "sebep_gerekli"
        | "kullanimda"
        | "gecersiz"
        | "hata";
      mesaj?: string;
    };

const BOS_LISTE: DurakListesi = {
  duraklar: [],
  ozet: durakOzeti([]),
  tabloYok: false,
};

// ── ORTAK ─────────────────────────────────────────────────────────────────

async function yonetimKapsami(): Promise<{
  workerId: string | null;
  scope: FleetScope;
}> {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  return { workerId: session.worker_id ?? null, scope };
}

/** Seferi kapsam denetimiyle getirir — yoksa/kapsam dışıysa null. */
async function kapsamdakiSefer(seferId: string, scope: FleetScope): Promise<SeferRow | null> {
  const s = await getSeferById(seferId);
  if (!s) return null;
  return scope.isFleetWorker(s.worker_id) ? s : null;
}

/**
 * Durakları görüntüye çevirir — bölge adları ve kanıt bayrağı TEK sorguda.
 *
 * Durak başına sorgu atmak (N+1) 80 duraklı bir günde 160 gidiş dönüş demekti.
 * İki toplu okuma yeterli.
 */
async function gorunumeCevir(duraklar: DurakRow[]): Promise<DurakGorunum[]> {
  if (duraklar.length === 0) return [];

  const zoneIds = [...new Set(duraklar.map((d) => d.zone_id).filter(Boolean))] as string[];
  const [z, k] = await Promise.all([
    zoneIds.length
      ? supabaseAdmin.from("geofences").select("id, name").in("id", zoneIds)
      : Promise.resolve({ data: [] }),
    // 080 uygulanmamışsa hata döner ve bayrak false'ta kalır — kademeli düşüş.
    supabaseAdmin
      .from("teslimatlar")
      .select("durak_id")
      .in("durak_id", duraklar.map((d) => d.id))
      .is("iptal_at", null),
  ]);

  const ad = new Map(((z.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const kanitli = new Set(
    ((k.data ?? []) as { durak_id: string | null }[]).map((r) => r.durak_id).filter(Boolean) as string[]
  );

  return duraklar.map((d) => ({
    ...d,
    bolge_ad: d.zone_id ? (ad.get(d.zone_id) ?? null) : null,
    kanitVar: kanitli.has(d.id),
  }));
}

// ── YÖNETİCİ / ŞEF ────────────────────────────────────────────────────────

export async function getSeferDuraklari(seferId: string): Promise<DurakListesi> {
  const { scope } = await yonetimKapsami();
  if (!(await kapsamdakiSefer(seferId, scope))) return BOS_LISTE;

  const { duraklar, tabloYok } = await listDuraklar(seferId);
  return {
    duraklar: await gorunumeCevir(duraklar),
    ozet: durakOzeti(duraklar),
    tabloYok,
  };
}

/**
 * YENİ DURAK.
 *
 * ⚠️ KAPANMIŞ SEFERE DURAK EKLENMEZ. Tamamlanmış ya da iptal edilmiş bir
 * seferin planını sonradan büyütmek, bitmiş bir günün kaydını değiştirmektir.
 */
export async function durakEkle(seferId: string, girdi: DurakGirdi): Promise<DurakSonuc> {
  const { workerId, scope } = await yonetimKapsami();
  const sefer = await kapsamdakiSefer(seferId, scope);
  if (!sefer) return { ok: false, hata: "kapsam_disi" };
  if (!ACIK_DURUMLAR.includes(sefer.durum)) return { ok: false, hata: "sefer_kapali" };

  const r = await insertDurak(seferId, girdi);
  if (!r.ok) return { ok: false, hata: r.sebep, mesaj: r.mesaj };

  await audit(workerId, "create", `sefer_durak:${r.durak.id}`);
  revalidatePath("/admin/seferler");
  revalidatePath("/panel/seferler");
  return { ok: true, id: r.durak.id };
}

export async function durakGuncelle(durakId: string, girdi: DurakGirdi): Promise<DurakSonuc> {
  const { workerId, scope } = await yonetimKapsami();
  const mevcut = await getDurak(durakId);
  if (!mevcut) return { ok: false, hata: "durak_yok" };
  if (!(await kapsamdakiSefer(mevcut.sefer_id, scope))) return { ok: false, hata: "kapsam_disi" };

  const r = await patchDurak(durakId, girdi);
  if (!r.ok) return { ok: false, hata: r.sebep, mesaj: r.mesaj };

  await audit(workerId, "update", `sefer_durak:${durakId}`);
  revalidatePath("/admin/seferler");
  revalidatePath("/panel/seferler");
  return { ok: true, id: durakId };
}

/**
 * DURAK SİLME.
 *
 * Silinen durağa bırakılmış teslimat kanıtı SİLİNMEZ — bağı boşalır
 * (`teslimatlar.durak_id on delete set null`). Delil, plan satırından uzun
 * yaşar (080'in duruşu). Ekran kanıtı olan durakta uyarıyor.
 */
export async function durakSil(durakId: string): Promise<DurakSonuc> {
  const { workerId, scope } = await yonetimKapsami();
  const mevcut = await getDurak(durakId);
  if (!mevcut) return { ok: false, hata: "durak_yok" };
  if (!(await kapsamdakiSefer(mevcut.sefer_id, scope))) return { ok: false, hata: "kapsam_disi" };

  const r = await deleteDurak(durakId);
  if (!r.ok) {
    const h = r.sebep === "kullanimda" ? "kullanimda" : r.sebep === "tablo_yok" ? "tablo_yok" : "hata";
    return { ok: false, hata: h, mesaj: r.mesaj };
  }
  await audit(workerId, "delete", `sefer_durak:${durakId}`);
  revalidatePath("/admin/seferler");
  revalidatePath("/panel/seferler");
  return { ok: true, id: durakId };
}

/** YENİDEN SIRALAMA — istemcinin verdiği TAM kimlik sırası. */
export async function duraklariSirala(seferId: string, sirali: string[]): Promise<DurakSonuc> {
  const { workerId, scope } = await yonetimKapsami();
  if (!(await kapsamdakiSefer(seferId, scope))) return { ok: false, hata: "kapsam_disi" };

  const r = await siralaDuraklar(seferId, sirali);
  if (!r.ok) return { ok: false, hata: r.sebep, mesaj: r.mesaj };

  await audit(workerId, "update", `sefer_durak_sira:${seferId}`);
  revalidatePath("/admin/seferler");
  revalidatePath("/panel/seferler");
  return { ok: true, id: seferId };
}

/**
 * YÖNETİCİ DÜZELTMESİ — yanlış basılmış durumu `bekliyor`a alır.
 *
 * Şoför ileri gider, yönetici düzeltir. Damgalar temizlenir: yanlış bir
 * "vardı 14:20", düzeltmeden sonra doğru sanılabilecek bir zaman taşımamalı.
 * İz `audit`te: kim, ne zaman, hangi durağı sıfırladı.
 */
export async function durakDurumSifirla(durakId: string): Promise<DurakSonuc> {
  const { workerId, scope } = await yonetimKapsami();
  const mevcut = await getDurak(durakId);
  if (!mevcut) return { ok: false, hata: "durak_yok" };
  if (!(await kapsamdakiSefer(mevcut.sefer_id, scope))) return { ok: false, hata: "kapsam_disi" };

  const r = await durumSifirla(durakId);
  if (!r.ok) return { ok: false, hata: r.sebep === "tablo_yok" ? "tablo_yok" : "hata" };

  await audit(workerId, "update", `sefer_durak_sifirla:${durakId}:${mevcut.durum}`);
  revalidatePath("/admin/seferler");
  revalidatePath("/panel/seferler");
  return { ok: true, id: durakId };
}

// ── ŞOFÖR ─────────────────────────────────────────────────────────────────

/** ŞOFÖR: kendi seferinin durakları. Başkasının seferinde BOŞ liste döner. */
export async function getSoforDuraklari(seferId: string): Promise<DurakListesi> {
  const session = await requireWorker();
  const sefer = await getSeferById(seferId);
  if (!sefer || sefer.worker_id !== session.worker_id) return BOS_LISTE;

  const { duraklar, tabloYok } = await listDuraklar(seferId);
  return {
    duraklar: await gorunumeCevir(duraklar),
    ozet: durakOzeti(duraklar),
    tabloYok,
  };
}

/**
 * ŞOFÖR: durağı ilerletir.
 *
 * ⚠️ SEFERİN SAHİBİ DENETLENİYOR — yol parametresi değil, veritabanındaki
 * `worker_id` konuşuyor. Başkasının durağını ilerletmek, o işi yapmış gibi
 * görünmektir.
 *
 * ⚠️ KAPANMIŞ SEFERDE DURAK İLERLEMEZ: tamamlanmış/iptal edilmiş bir seferin
 * durağına sonradan damga basmak, olaydan sonra kayıt üretmektir (teslimat
 * kanıtındaki aynı kural).
 *
 * `varis_kaynak` daima `sofor`: bu yol elle basmadır. Otomatik damga yalnız
 * köprüden gelir (lib/sefer-bridge.ts).
 */
export async function durakIlerlet(
  durakId: string,
  hedef: DurakDurum,
  sebep?: string | null
): Promise<DurakSonuc> {
  const session = await requireWorker();
  const durak = await getDurak(durakId);
  if (!durak) return { ok: false, hata: "durak_yok" };

  const sefer = await getSeferById(durak.sefer_id);
  if (!sefer) return { ok: false, hata: "sefer_yok" };
  if (sefer.worker_id !== session.worker_id) return { ok: false, hata: "kapsam_disi" };
  if (!ACIK_DURUMLAR.includes(sefer.durum)) return { ok: false, hata: "sefer_kapali" };

  const r = await ilerletDurak(durakId, hedef, { sebep, kaynak: "sofor" });
  if (!r.ok) {
    const h =
      r.sebep === "gecersiz_gecis"
        ? "gecersiz_gecis"
        : r.sebep === "kapali_durak"
          ? "kapali_durak"
          : r.sebep === "sebep_gerekli"
            ? "sebep_gerekli"
            : r.sebep === "tablo_yok"
              ? "tablo_yok"
              : r.sebep === "yok"
                ? "durak_yok"
                : "hata";
    return { ok: false, hata: h, mesaj: r.mesaj };
  }

  await audit(session.worker_id ?? null, "update", `sefer_durak_durum:${durakId}:${hedef}`);
  revalidatePath("/panel/seferler");
  return { ok: true, id: durakId };
}
