"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView, requireWorker, effectiveViewerId } from "@/lib/session";
import { getFleetScope, UNRESTRICTED, type FleetScope } from "@/lib/fleet-scope";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";
import { viennaDayKey, startOfDayViennaFromYmd } from "@/lib/format";
import {
  listSeferByDay,
  listSeferByRange,
  insertSefer,
  iptalSefer,
  acikSeferVarMi,
  getSeferById,
  type SeferRow,
} from "@/lib/sefer-db";
import {
  createTakipLink,
  listTakipLinks,
  revokeTakipLink,
  type TakipLink,
} from "@/lib/takip-db";
import { TAKIP_LINK_TTL_MIN } from "@/lib/tenant";
import { audit } from "@/lib/security-log";

/**
 * PANEL SEFER EKRANI — sunucu eylemleri.
 *
 * ═══ NEDEN MOBİL UÇLARI ÇAĞIRMIYOR ═══
 *
 * Sefer uçları (`/api/mobile/sefer/**`) zaten var ama onlar TAŞIYICI JETONLA
 * konuşuyor; panelin elinde jeton değil ÇEREZ var. Panelin kendi sunucusundan
 * kendi HTTP ucuna istek atması, aynı işlem için ikinci bir ağ atlaması ve
 * ikinci bir kimlik biçimi demekti. Doğru paylaşım noktası uç değil VERİ
 * KATMANI: iki yüzey de `lib/sefer-db.ts` ve `lib/takip-db.ts` çağırıyor,
 * kural tek yerde yaşıyor.
 *
 * ═══ KAPI: YÖNETİCİ VEYA FİLO ŞEFİ ═══
 *
 * `requireFleetView` — patron kısıtsız, şef YALNIZ kendi filosu. Mobil uçta
 * sefer oluşturmak yalnız yöneticide (066 kararı); panelde şefe de açılıyor
 * çünkü şefin işi tam olarak kendi filosunun günlük dağıtımını kurmak. Kapsam
 * boşluğu bırakmadan: şef kendi filosu DIŞINDAKİ şoföre ya da araca sefer
 * açamaz ve o seferleri göremez.
 *
 * ⚠️ KAPSAM İKİ EKSENDE DENETLENİYOR — şoför VE araç. Yalnız şoföre bakmak
 * yetmezdi: şef kendi şoförünü BAŞKA filonun aracına yazabilir, araç o filonun
 * takip linkine konu olurdu.
 */

export type SeferSatir = SeferRow & {
  sofor_ad: string;
  arac_plaka: string | null;
  bolge_ad: string | null;
  /** Takip linki üretilebilir mi — araç VE hedef bölge şart. */
  takip_uygun: boolean;
};

export type SeferGunu = {
  tarih: string;
  seferler: SeferSatir[];
  /** Şef ise filo kodu, patron ise null — ekran bunu söylüyor. */
  fleet: string | null;
};

export type SeferSecenek = { id: string; ad: string; ikincil?: string | null };

export type SeferSecenekleri = {
  soforler: SeferSecenek[];
  araclar: SeferSecenek[];
  /** Müşteri bölgeleri ÖNCE, depolar sonra (ikincil alanı türü söyler). */
  bolgeler: SeferSecenek[];
  /** Takip linki ömrü (dk) — form "2 saat geçerli" diyebilsin. */
  takipTtlDk: number;
};

export type SeferSonuc =
  | { ok: true; id: string }
  | { ok: false; hata: "kapsam_disi" | "acik_sefer_var" | "gecersiz" | "hata"; mesaj?: string };

/** Şefin kapsamı; patronda UNRESTRICTED. */
async function kapsam(): Promise<{
  session: Awaited<ReturnType<typeof requireFleetView>>["session"];
  scope: FleetScope;
  fleet: string | null;
}> {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  return { session, scope, fleet };
}

/** Günün seferleri + görüntüleme için gereken adlar. */
export async function getSeferGunu(tarih?: string): Promise<SeferGunu> {
  const { session, scope, fleet } = await kapsam();
  const gun = tarih && startOfDayViennaFromYmd(tarih) ? tarih : viennaDayKey(new Date());
  await audit(session.worker_id ?? null, "page_view", `/admin/seferler?tarih=${gun}`);

  const ham = await listSeferByDay(gun);

  // Test şoförünün seferleri panelde görünmez (028 deseni: eleme kimlik
  // kümesiyle, `seferler`e ikinci bir bayrak eklenmeden).
  const test = await getTestScope();
  const kapsamli = ham.filter(
    (s) => !test.isTestWorker(s.worker_id) && scope.isFleetWorker(s.worker_id)
  );

  const soforIds = [...new Set(kapsamli.map((s) => s.worker_id))];
  const aracIds = [...new Set(kapsamli.map((s) => s.vehicle_id).filter(Boolean))] as string[];
  const bolgeIds = [...new Set(kapsamli.map((s) => s.zone_id).filter(Boolean))] as string[];

  const [w, v, z] = await Promise.all([
    soforIds.length
      ? supabaseAdmin.from("workers").select("id, name").in("id", soforIds)
      : Promise.resolve({ data: [] }),
    aracIds.length
      ? supabaseAdmin.from("vehicles").select("id, plate").in("id", aracIds)
      : Promise.resolve({ data: [] }),
    bolgeIds.length
      ? supabaseAdmin.from("geofences").select("id, name").in("id", bolgeIds)
      : Promise.resolve({ data: [] }),
  ]);
  const ad = new Map(((w.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const plaka = new Map(((v.data ?? []) as { id: string; plate: string }[]).map((r) => [r.id, r.plate]));
  const bolge = new Map(((z.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

  return {
    tarih: gun,
    fleet,
    seferler: kapsamli.map((s) => ({
      ...s,
      sofor_ad: ad.get(s.worker_id) ?? "—",
      arac_plaka: s.vehicle_id ? (plaka.get(s.vehicle_id) ?? "—") : null,
      bolge_ad: s.zone_id ? (bolge.get(s.zone_id) ?? "—") : null,
      takip_uygun: Boolean(s.vehicle_id && s.zone_id),
    })),
  };
}

/**
 * Form seçenekleri.
 *
 * ⚠️ HEDEF BÖLGE SIRASI ANLAMLI: müşteri bölgeleri önce. Depo da seçilebilir
 * (bazı seferler depoya dönüşle biter) ama listenin başında müşteri durmalı —
 * seferin hedefi tipik olarak müşteridir ve ilk seçenek varsayılanı belirler.
 */
export async function getSeferSecenekleri(): Promise<SeferSecenekleri> {
  const { session, scope } = await kapsam();
  const test = await getTestScope();
  const driverScope = await getDriverScope();
  const ownerScope = await getOwnerScope(effectiveViewerId(session));

  // driver-scoped: sefer bir ŞOFÖR görevi; yönetici hesapları seçicide çıkmaz.
  // owner-filtered: patron gizliyse listede de olmaz.
  const { data: wRows } = await withoutOwner(
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin.from("workers").select("id, name, fleet").eq("is_active", true).order("name"),
        "id",
        test.workerIds
      ),
      "id",
      driverScope
    ),
    "id",
    ownerScope
  );
  const soforler = ((wRows ?? []) as { id: string; name: string; fleet: string | null }[])
    .filter((r) => scope.isFleetWorker(r.id))
    .map((r) => ({ id: r.id, ad: r.name, ikincil: r.fleet }));

  // test-visible: araç listesi test aracını ELEMELİ — panelden gerçek bir
  // sefere test aracı bağlanması, takip linkinin sahte bir araca bakması olurdu.
  const { data: vRows } = await withoutTestRows(
    supabaseAdmin
      .from("vehicles")
      .select("id, plate, fleet, status")
      .neq("status", "inactive")
      .order("plate"),
    "id",
    test.vehicleIds
  );
  const araclar = ((vRows ?? []) as { id: string; plate: string; fleet: string | null }[])
    .filter((r) => scope.isFleetVehicle(r.id))
    .map((r) => ({ id: r.id, ad: r.plate, ikincil: r.fleet }));

  const { data: zRows } = await supabaseAdmin
    .from("geofences")
    .select("id, name, purpose, active, archived_at")
    .eq("active", true)
    .order("name");
  type ZRow = { id: string; name: string; purpose: string | null; archived_at: string | null };
  const zonlar = ((zRows ?? []) as ZRow[]).filter((z) => !z.archived_at);
  const bolgeler = [
    ...zonlar.filter((z) => z.purpose === "customer"),
    ...zonlar.filter((z) => z.purpose !== "customer"),
  ].map((z) => ({ id: z.id, ad: z.name, ikincil: z.purpose }));

  return { soforler, araclar, bolgeler, takipTtlDk: TAKIP_LINK_TTL_MIN };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Yeni sefer.
 *
 * ⚠️ ARAÇ ve HEDEF BÖLGE ZORUNLU DEĞİL — bilerek. Sabah atamasında araç
 * belli olmayabilir; zorunlu kılmak yöneticiyi sahte bir araç seçmeye iterdi.
 * Ama ikisi dolu değilse TAKİP LİNKİ ÜRETİLEMEZ ve ekran bunu söylüyor
 * (`takip_uygun`). Teşvik ediliyor, dayatılmıyor.
 */
export async function seferOlustur(girdi: {
  tarih: string;
  worker_id: string;
  vehicle_id?: string | null;
  zone_id?: string | null;
  paket_hedef?: number | null;
  notlar?: string | null;
}): Promise<SeferSonuc> {
  const { session, scope } = await kapsam();

  if (!YMD.test(girdi.tarih) || !startOfDayViennaFromYmd(girdi.tarih)) {
    return { ok: false, hata: "gecersiz", mesaj: "tarih" };
  }
  if (!girdi.worker_id) return { ok: false, hata: "gecersiz", mesaj: "sofor" };

  // KAPSAM — iki eksende. Şef kendi filosu dışına atayamaz.
  if (!scope.isFleetWorker(girdi.worker_id)) return { ok: false, hata: "kapsam_disi", mesaj: "sofor" };
  if (girdi.vehicle_id && !scope.isFleetVehicle(girdi.vehicle_id)) {
    return { ok: false, hata: "kapsam_disi", mesaj: "arac" };
  }

  // İK1 (066): aynı şoföre aynı gün ikinci AÇIK sefer yok.
  const acik = await acikSeferVarMi(girdi.worker_id, girdi.tarih);
  if (acik) return { ok: false, hata: "acik_sefer_var", mesaj: acik.id };

  try {
    const s = await insertSefer({
      tarih: girdi.tarih,
      worker_id: girdi.worker_id,
      vehicle_id: girdi.vehicle_id ?? null,
      zone_id: girdi.zone_id ?? null,
      paket_hedef: girdi.paket_hedef ?? null,
      notlar: girdi.notlar?.trim() ? girdi.notlar.trim().slice(0, 500) : null,
      created_by: session.worker_id!,
    });
    await audit(session.worker_id ?? null, "create", `sefer:${s.id}`);
    revalidatePath("/admin/seferler");
    return { ok: true, id: s.id };
  } catch (e) {
    return { ok: false, hata: "hata", mesaj: String(e).slice(0, 120) };
  }
}

/** Seferi iptal eder (yalnız açık sefer — geçiş kuralı lib/sefer-db'de). */
export async function seferIptalEt(id: string): Promise<SeferSonuc> {
  const { session, scope } = await kapsam();
  const s = await getSeferById(id);
  if (!s) return { ok: false, hata: "gecersiz", mesaj: "sefer" };
  if (!scope.isFleetWorker(s.worker_id)) return { ok: false, hata: "kapsam_disi" };

  const r = await iptalSefer(id);
  if (!r || r.ok !== true) {
    return { ok: false, hata: "hata", mesaj: r && r.ok === false ? r.kod : "yok" };
  }
  await audit(session.worker_id ?? null, "delete", `sefer:${id}`);
  revalidatePath("/admin/seferler");
  return { ok: true, id };
}

// ── ŞOFÖR YÜZEYİ ──────────────────────────────────────────────────────────

export type SoforSeferi = {
  id: string;
  tarih: string;
  durum: SeferRow["durum"];
  arac_plaka: string | null;
  bolge_ad: string | null;
  paket_hedef: number | null;
  paket_gerceklesen: number | null;
  notlar: string | null;
  kabul_at: string | null;
  yolda_at: string | null;
  vardi_at: string | null;
  tamamlandi_at: string | null;
  /** Bu sefere bırakılmış kanıt sayısı (080 yoksa 0). */
  kanitSayisi: number;
};

/**
 * ŞOFÖRÜN KENDİ SEFERLERİ — /panel/seferler.
 *
 * ═══ NEDEN AYRI FONKSİYON, getSeferGunu'ya BAYRAK DEĞİL ═══
 *
 * İkisinin KAPISI farklı: yönetim yüzeyi `requireFleetView`, şoför yüzeyi
 * `requireWorker`. Aynı fonksiyona "mine" bayrağı koymak, iki yetki modelini
 * tek gövdede yaşatmak olurdu — bayrağı geçmeyi unutan bir çağrı, şoföre
 * herkesin seferini gösterirdi. Ayrı fonksiyon, ayrı kapı.
 *
 * ═══ NEDEN DÖNEN ALANLAR DAR ═══
 *
 * Şoför kendi seferini görüyor; `worker_id`, `created_by` ve takip linkleri
 * BURADAN ÇIKMAZ. Linkler yönetim kararıdır (kim müşteriye ne gönderdi) ve
 * şoförün ekranında işi yok.
 */
export async function getSoforSeferleri(
  ay?: string
): Promise<{ ay: string; seferler: SoforSeferi[] }> {
  const session = await requireWorker();
  const workerId = session.worker_id!;

  // Ay penceresi: "YYYY-MM" → ayın ilk ve son günü.
  const simdi = new Date();
  const gecerli = ay && /^\d{4}-\d{2}$/.test(ay) ? ay : viennaDayKey(simdi).slice(0, 7);
  const [yil, aySay] = gecerli.split("-").map(Number);
  const ilk = `${gecerli}-01`;
  const sonGun = new Date(Date.UTC(yil, aySay, 0)).getUTCDate();
  const son = `${gecerli}-${String(sonGun).padStart(2, "0")}`;

  const satirlar = await listSeferByRange(ilk, son, workerId);

  const aracIds = [...new Set(satirlar.map((s) => s.vehicle_id).filter(Boolean))] as string[];
  const bolgeIds = [...new Set(satirlar.map((s) => s.zone_id).filter(Boolean))] as string[];
  const [v, z] = await Promise.all([
    aracIds.length
      ? supabaseAdmin.from("vehicles").select("id, plate").in("id", aracIds)
      : Promise.resolve({ data: [] }),
    bolgeIds.length
      ? supabaseAdmin.from("geofences").select("id, name").in("id", bolgeIds)
      : Promise.resolve({ data: [] }),
  ]);
  const plaka = new Map(((v.data ?? []) as { id: string; plate: string }[]).map((r) => [r.id, r.plate]));
  const bolge = new Map(((z.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));

  /**
   * KANIT SAYISI — tek sorguda, sefer başına değil.
   *
   * 080 uygulanmamışsa sorgu hata döner ve sayaç 0'da kalır: takvim çalışmaya
   * devam eder, yalnız kanıt rozeti çıkmaz (kademeli düşüş deseni).
   */
  const kanitSayaci = new Map<string, number>();
  if (satirlar.length > 0) {
    const { data: kRows } = await supabaseAdmin
      .from("teslimatlar")
      .select("sefer_id")
      .in("sefer_id", satirlar.map((s) => s.id));
    for (const k of (kRows ?? []) as { sefer_id: string }[]) {
      kanitSayaci.set(k.sefer_id, (kanitSayaci.get(k.sefer_id) ?? 0) + 1);
    }
  }

  return {
    ay: gecerli,
    seferler: satirlar.map((s) => ({
      id: s.id,
      tarih: s.tarih,
      durum: s.durum,
      arac_plaka: s.vehicle_id ? (plaka.get(s.vehicle_id) ?? "—") : null,
      bolge_ad: s.zone_id ? (bolge.get(s.zone_id) ?? "—") : null,
      paket_hedef: s.paket_hedef,
      paket_gerceklesen: s.paket_gerceklesen,
      notlar: s.notlar,
      kabul_at: s.kabul_at,
      yolda_at: s.yolda_at,
      vardi_at: s.vardi_at,
      tamamlandi_at: s.tamamlandi_at,
      kanitSayisi: kanitSayaci.get(s.id) ?? 0,
    })),
  };
}

// ── TAKİP LİNKLERİ ────────────────────────────────────────────────────────

export type TakipLinkGorunum = {
  id: string;
  url: string;
  bitis: string;
  iptalEdildi: boolean;
  aliciNot: string | null;
  acilma: number;
};

function linkGorunum(l: TakipLink, taban: string): TakipLinkGorunum {
  return {
    id: l.id,
    url: `${taban}/takip/${l.token}`,
    bitis: l.expiresAt,
    iptalEdildi: l.revokedAt !== null,
    aliciNot: l.aliciNot,
    acilma: l.hitCount,
  };
}

/**
 * Linkin TAM adresi sunucuda kurulur.
 *
 * `NEXT_PUBLIC_APP_URL` kiracının kendi alan adı; yoksa boş bırakılır ve ekran
 * göreli yolu gösterir. İstemcide `location.origin` ile kurmak, yöneticinin
 * localhost'tan ürettiği linki müşteriye localhost olarak göndermesine yol
 * açardı.
 */
function linkTabani(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "").replace(/\/+$/, "");
}

async function seferKapsamda(id: string, scope: FleetScope): Promise<SeferRow | null> {
  const s = await getSeferById(id);
  if (!s) return null;
  return scope.isFleetWorker(s.worker_id) ? s : null;
}

export async function takipLinkleriGetir(
  seferId: string
): Promise<{ linkler: TakipLinkGorunum[]; tabloYok: boolean }> {
  const { scope } = await kapsam();
  if (!(await seferKapsamda(seferId, scope))) return { linkler: [], tabloYok: false };
  const { linkler, tabloYok } = await listTakipLinks(seferId);
  const taban = linkTabani();
  return { linkler: linkler.map((l) => linkGorunum(l, taban)), tabloYok };
}

export type TakipLinkSonuc =
  | { ok: true; link: TakipLinkGorunum }
  | {
      ok: false;
      hata: "kapsam_disi" | "tablo_yok" | "sefer_kapali" | "eksik_alan" | "hata";
      mesaj?: string;
    };

export async function takipLinkiUret(
  seferId: string,
  aliciNot?: string | null
): Promise<TakipLinkSonuc> {
  const { session, scope } = await kapsam();
  const s = await seferKapsamda(seferId, scope);
  if (!s) return { ok: false, hata: "kapsam_disi" };

  /**
   * ⚠️ ARAÇ VE HEDEF ŞART — ama seferin kendisi için değil, LİNK için.
   * Araçsız bir link boş harita, hedefsiz bir link ETA'sız bir sayfa gösterirdi;
   * ikisi de müşteriye "bozuk" görünür. Sefer araçsız yaşayabilir, link yaşayamaz.
   */
  if (!s.vehicle_id || !s.zone_id) {
    return { ok: false, hata: "eksik_alan", mesaj: !s.vehicle_id ? "arac" : "bolge" };
  }

  const r = await createTakipLink(seferId, session.worker_id ?? null, aliciNot?.trim() || null);
  if (!r.ok) {
    const h =
      r.sebep === "tablo_yok" ? "tablo_yok" : r.sebep === "sefer_kapali" ? "sefer_kapali" : "hata";
    return { ok: false, hata: h, mesaj: r.mesaj };
  }
  await audit(session.worker_id ?? null, "create", `takip_linki:${seferId}`);
  revalidatePath("/admin/seferler");
  return { ok: true, link: linkGorunum(r.veri, linkTabani()) };
}

export async function takipLinkiIptalEt(
  seferId: string,
  linkId: string
): Promise<{ ok: boolean; hata?: string }> {
  const { session, scope } = await kapsam();
  if (!(await seferKapsamda(seferId, scope))) return { ok: false, hata: "kapsam_disi" };

  // Link GERÇEKTEN bu seferin mi — yol/gövde uyuşmazlığı imkânsız olsun.
  const { linkler } = await listTakipLinks(seferId);
  if (!linkler.some((l) => l.id === linkId)) return { ok: false, hata: "link_bu_sefere_ait_degil" };

  const r = await revokeTakipLink(linkId, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.sebep };
  await audit(session.worker_id ?? null, "delete", `takip_linki:${linkId}`);
  revalidatePath("/admin/seferler");
  return { ok: true };
}
