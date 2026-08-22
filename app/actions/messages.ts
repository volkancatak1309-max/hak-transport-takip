"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView, requireAdmin, effectiveViewerId } from "@/lib/session";
import { getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import {
  hedefCoz,
  erisimCozKonusma,
  konusmaGetir,
  konusmaListesi,
  konusmaGecmisi,
  govdeCoz,
  onizleme,
  sonMesajiIsle,
  makbuzYaz,
  type MesajAktoru,
  type KonusmaSatiri,
  type MesajSatiri,
} from "@/lib/messaging";
import { READ_RECEIPTS_ENABLED } from "@/lib/tenant";
import { audit } from "@/lib/security-log";

/**
 * PANEL MESAJLAŞMA EYLEMLERİ (/admin/mesajlar).
 *
 * Kural kümesi MOBİLLE ORTAK: erişim `erisimCoz`, liste `konusmaListesi`,
 * geçmiş `konusmaGecmisi`, makbuz `makbuzYaz` — hepsi lib/messaging.ts'te.
 * Burada yalnız OTURUM çözülür ve sonuç panelin beklediği şekle sarılır.
 * İkinci bir kural kopyası yazsaydık panel ile telefon aynı filoyu farklı
 * gösterirdi; bu depoda o hata daha önce yaşandı (bkz. lib/shift-end.ts notu).
 */

export type MesajRol = "admin" | "fleet_chief";

export type MesajSonuc<T> = { ok: true; data: T } | { ok: false; error: string };

/** Oturumdan MesajAktoru + rol/kapsam. Panelin tek kimlik çözümü. */
async function panelAktoru(): Promise<{
  actor: MesajAktoru;
  rol: MesajRol;
  kapsam: string[] | null;
  viewerId: string;
}> {
  // requireFleetView zaten şefliği çözüyor — ikinci kez getManagedFleet
  // çağırmak aynı sorguyu tekrarlamak olurdu.
  const { session, fleet, isChief: sessionChief } = await requireFleetView();
  const viewerId = effectiveViewerId(session) ?? session.worker_id!;

  // ⚠️ `is_admin` ÇEREZDEN DEĞİL DB'DEN. Çerez 30 gün yaşıyor; yetkisi alınan
  // biri o süre boyunca yönetici gibi yazabilirdi. lib/fleet-scope.ts'in
  // dosya başındaki kuralın aynısı.
  const { data: w } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin, counts_as_driver")
    .eq("id", viewerId)
    .maybeSingle();

  const isAdmin = w?.is_admin === true;
  const isChief = !isAdmin && sessionChief && fleet !== null;
  const fleetScope = isChief ? await getFleetScope(fleet) : UNRESTRICTED;

  return {
    actor: {
      worker: {
        id: viewerId,
        is_admin: isAdmin,
        counts_as_driver: w?.counts_as_driver === true,
      },
      isChief,
      fleetScope,
    },
    rol: isAdmin ? "admin" : "fleet_chief",
    kapsam: isChief ? fleetScope.workerIds : null,
    viewerId,
  };
}

/** Sayfanın açılışta çektiği liste. Sunucu bileşeninden de çağrılabilir. */
export async function listeAction(): Promise<
  MesajSonuc<{ rol: MesajRol; satirlar: KonusmaSatiri[]; okunduBilgisi: boolean }>
> {
  const { actor, rol, kapsam } = await panelAktoru();
  // 500: panelde sayfalama yok — filo bu ölçeğin çok altında ve liste tek
  // ekranda kayıyor. Dolarsa PostgREST 1000 tavanına DAYANMADAN önce burada
  // kesilir ve bu bilinçli bir tavandır, sessiz kırpma değil.
  const r = await konusmaListesi(actor, rol, kapsam, { limit: 500, offset: 0 });
  if (!r.ok) return { ok: false, error: r.code };
  return {
    ok: true,
    data: { rol, satirlar: r.satirlar, okunduBilgisi: READ_RECEIPTS_ENABLED },
  };
}

/**
 * Seçili konuşmanın geçmişi. Aynı çağrıda okundu İŞARETLENMEZ (ayrı eylem).
 *
 * `adres` KONUŞMA kimliği ya da ŞOFÖR kimliği olabilir — `hedefCoz` ikisini de
 * tek sorguyla çözer (bkz. lib/messaging.ts). Grup da birebir de bu yoldan.
 */
export async function gecmisAction(adres: string): Promise<
  MesajSonuc<{
    mesajlar: MesajSatiri[];
    konusmaId: string | null;
    baslik: string;
    tur: "birebir" | "grup";
    yazabilir: boolean;
    arsivlendiMi: boolean;
  }>
> {
  const { actor } = await panelAktoru();

  const h = await hedefCoz(adres, actor.worker.id);
  if (!h.ok) return { ok: false, error: h.code };
  const hedef = h.hedef;

  const e = await erisimCozKonusma(actor, hedef);
  if (!e.ok) return { ok: false, error: e.code };

  if (hedef.konusmaId === null) {
    return {
      ok: true,
      data: {
        mesajlar: [], konusmaId: null, baslik: hedef.baslik,
        tur: hedef.tur, yazabilir: e.yazabilir, arsivlendiMi: false,
      },
    };
  }

  const g = await konusmaGecmisi(hedef.konusmaId, { limit: 200, offset: 0 }, hedef.pencereSonu);
  if (!g.ok) return { ok: false, error: g.code };
  return {
    ok: true,
    data: {
      mesajlar: g.mesajlar, konusmaId: hedef.konusmaId, baslik: hedef.baslik,
      tur: hedef.tur, yazabilir: e.yazabilir, arsivlendiMi: hedef.arsivlendiMi,
    },
  };
}

export async function gonderAction(
  adres: string,
  govdeHam: string
): Promise<MesajSonuc<{ mesaj: MesajSatiri; konusmaId: string }>> {
  const { actor, viewerId } = await panelAktoru();

  const h = await hedefCoz(adres, viewerId);
  if (!h.ok) return { ok: false, error: h.code };
  const hedef = h.hedef;

  const e = await erisimCozKonusma(actor, hedef);
  if (!e.ok) return { ok: false, error: e.code };

  // ARŞİV KİLİDİ / çıkarılmış üye — şemada tetikleyici de var (073, HK001);
  // bu kapı onun ÖNÜNDE, kullanıcıya ham DB hatası yerine anlamlı cevap için.
  if (!e.yazabilir) {
    return { ok: false, error: hedef.arsivlendiMi ? "conversation_archived" : "read_only" };
  }

  const govde = govdeCoz(govdeHam);
  if (!govde.ok) return { ok: false, error: govde.code };

  // Grupta konuşma zaten var; birebirde ilk mesajda açılır.
  let konusmaId = hedef.konusmaId;
  if (konusmaId === null) {
    const k = await konusmaGetir(hedef.soforId as string, true);
    if (!k.ok || !k.id) return { ok: false, error: "db_error" };
    konusmaId = k.id;
  }

  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: konusmaId,
      sender_worker_id: viewerId,
      // Rol KAPIDAN türer — formdan değil.
      sender_role: e.role,
      body: govde.body,
    })
    .select("id, created_at")
    .single();
  if (error) {
    // Tetikleyici arşiv kilidi (073). Kapı yukarıda tutuyor; buraya düşmek
    // ancak grup tam bu arada arşivlenirse mümkün — sessiz başarı ASLA.
    if (error.code === "HK001") return { ok: false, error: "conversation_archived" };
    return { ok: false, error: error.message };
  }

  await sonMesajiIsle(konusmaId, govde.body, e.role, data.created_at as string);
  await audit(viewerId, "message_send", adres);
  revalidatePath("/admin/mesajlar");

  const { data: ben } = await supabaseAdmin
    .from("workers").select("name").eq("id", viewerId).maybeSingle();

  return {
    ok: true,
    data: {
      konusmaId,
      mesaj: {
        id: data.id as string,
        gonderenId: viewerId,
        gonderenRol: e.role,
        gonderenAd: (ben?.name as string | null) ?? null,
        govde: govde.body,
        duyuruMu: false,
        an: data.created_at as string,
        okuyanlar: READ_RECEIPTS_ENABLED ? [] : null,
      },
    },
  };
}

/** Konuşmayı okundu işaretle. Bayrak kapalıysa hiçbir satır yazılmaz. */
export async function okunduAction(
  adres: string
): Promise<MesajSonuc<{ yeniOkundu: number }>> {
  const { actor, viewerId } = await panelAktoru();

  const h = await hedefCoz(adres, viewerId);
  if (!h.ok) return { ok: false, error: h.code };

  const e = await erisimCozKonusma(actor, h.hedef);
  if (!e.ok) return { ok: false, error: e.code };

  // Okumak ARŞİVDE DE serbest — kilit yalnız YAZMAYA. Arşivlenmiş grubun
  // geçmişi okunabilir olmalı, yoksa arşivlemek silmekle aynı şey olurdu.
  if (h.hedef.konusmaId === null) return { ok: true, data: { yeniOkundu: 0 } };

  const r = await makbuzYaz(h.hedef.konusmaId, viewerId);
  return { ok: true, data: { yeniOkundu: r.yazildi } };
}

/**
 * FİLO DUYURUSU — YALNIZ PATRON.
 *
 * `requireAdmin()`: şef panelde bu butonu görmez ve görse de sunucu reddeder.
 * Butonu gizlemek yetmezdi — eylem ağdan çağrılabilir bir uçtur.
 */
export async function duyuruAction(
  govdeHam: string
): Promise<MesajSonuc<{ alici: number; broadcastId: string }>> {
  const session = await requireAdmin();
  const viewerId = effectiveViewerId(session) ?? session.worker_id!;

  const govde = govdeCoz(govdeHam);
  if (!govde.ok) return { ok: false, error: govde.code };

  // test-filtered: duyuru test hesabina GITMEZ.
  const { data: hedefler, error: hErr } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("is_active", true)
    .not("is_test", "is", true)
    .or("is_admin.eq.false,counts_as_driver.eq.true");
  if (hErr) return { ok: false, error: "db_error" };

  const soforIds = ((hedefler ?? []) as { id: string }[]).map((w) => w.id);
  if (soforIds.length === 0) return { ok: false, error: "no_recipients" };

  // `kind=direct`: duyuru BİREBİR konuşmalara dağıtılır, gruplara ASLA.
  const { data: mevcut } = await supabaseAdmin
    .from("conversations")
    .select("id, worker_id")
    .eq("kind", "direct")
    .in("worker_id", soforIds);
  const kMap = new Map(
    ((mevcut ?? []) as { id: string; worker_id: string }[]).map((c) => [c.worker_id, c.id])
  );
  const eksik = soforIds.filter((w) => !kMap.has(w));
  if (eksik.length > 0) {
    await supabaseAdmin
      .from("conversations")
      .upsert(eksik.map((w) => ({ worker_id: w })), {
        onConflict: "worker_id",
        ignoreDuplicates: true,
      });
    const { data: tekrar } = await supabaseAdmin
      .from("conversations")
      .select("id, worker_id")
      .eq("kind", "direct")
      .in("worker_id", eksik);
    for (const c of (tekrar ?? []) as { id: string; worker_id: string }[]) {
      kMap.set(c.worker_id, c.id);
    }
  }

  const konusmalar = soforIds.map((w) => kMap.get(w)).filter(Boolean) as string[];
  if (konusmalar.length === 0) return { ok: false, error: "db_error" };

  const broadcastId = crypto.randomUUID();
  const atIso = new Date().toISOString();
  const { data: yazilan, error: yErr } = await supabaseAdmin
    .from("messages")
    .insert(
      konusmalar.map((cid) => ({
        conversation_id: cid,
        sender_worker_id: viewerId,
        sender_role: "admin",
        body: govde.body,
        broadcast_id: broadcastId,
        created_at: atIso,
      }))
    )
    .select("id");
  if (yErr) return { ok: false, error: yErr.message };

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: atIso,
      last_message_preview: onizleme(govde.body),
      last_sender_role: "admin",
    })
    .in("id", konusmalar);

  await audit(viewerId, "message_broadcast", `${(yazilan ?? []).length} alıcı`);
  revalidatePath("/admin/mesajlar");
  return { ok: true, data: { alici: (yazilan ?? []).length, broadcastId } };
}
