import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { mapBounded } from "@/lib/db-fanout";
import { listVehicleTrack } from "@/lib/telemetry";
import { workedMs, viennaDayKey } from "@/lib/format";
import { touchesNightWindow } from "@/lib/azg-rules";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { UNRESTRICTED, onlyFleet, type FleetScope } from "@/lib/fleet-scope";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { listExpiringDocuments, type ExpiringDocument } from "@/lib/documents-db";
import {
  KURAL_SETLERI,
  VARSAYILAN_KADEME,
  kademeDenetle,
  kuralDurumu,
  setinTemeli,
  soforDurumu,
  type Kademe,
  type KademeAyari,
  type KuralSeti,
  VARDIYA_BAYAT_MS,
  type OlcumGirdi,
  type SoforDurumu,
} from "@/lib/mevzuat";

/**
 * MEVZUAT ERKEN UYARI — VERİ KATMANI (migration 086).
 *
 * Saf kural motoru `lib/mevzuat.ts`te. Burada ÖLÇÜM ve GÖNDERİM var.
 *
 * ⚠️ BU DOSYA `time_entries`, `device_telemetry` VE AZG RAPORUNA AİT HİÇBİR
 * TABLOYA YAZMAZ. Yalnız `mevzuat_uyarilari` tablosuna yazar. Geçmişe dönük
 * AZG raporu bu katmandan hiç etkilenmez.
 */

const TABLO_YOK = new Set(["PGRST205", "42P01"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

// ═════════════════════════ KİRACI AYARI ══════════════════════════════════

export type MevzuatAyari = {
  kuralSeti: KuralSeti;
  surusTahmini: boolean;
  kademe: KademeAyari;
  /** migration 086 yok → ayar okunamadı, varsayılan kullanıldı. */
  tabloYok: boolean;
};

export const VARSAYILAN_AYAR: MevzuatAyari = {
  kuralSeti: "AT_AZG",
  surusTahmini: false,
  kademe: { ...VARSAYILAN_KADEME },
  tabloYok: true,
};

export async function mevzuatAyari(): Promise<MevzuatAyari> {
  const { data, error } = await supabaseAdmin
    .from("tenant_mevzuat")
    .select("kural_seti, surus_tahmini, kademe_erken_dk, kademe_yaklasti_dk, kademe_son_dk")
    .eq("id", "singleton")
    .maybeSingle();

  if (error || !data) return { ...VARSAYILAN_AYAR, tabloYok: tabloYokMu(error) };

  const r = data as {
    kural_seti: string;
    surus_tahmini: boolean;
    kademe_erken_dk: number;
    kademe_yaklasti_dk: number;
    kademe_son_dk: number;
  };
  return {
    kuralSeti: r.kural_seti as KuralSeti,
    surusTahmini: r.surus_tahmini === true,
    kademe: {
      erken: Number(r.kademe_erken_dk),
      yaklasti: Number(r.kademe_yaklasti_dk),
      son: Number(r.kademe_son_dk),
    },
    tabloYok: false,
  };
}

// ═════════════════════ SÜRÜŞ SÜRESİ TAHMİNİ ══════════════════════════════

/**
 * Telemetri sessizliği bu süreden uzunsa köprü kurulmaz — o band NE SÜRÜŞ
 * NE DURAK sayılır. `lib/metrics-distance.ts`teki GAP_MAX_MS ile aynı değer
 * ve aynı gerekçe: bilmediğimiz yeri uydurmuyoruz.
 */
export const SURUS_BOSLUK_TAVAN_MS = 10 * 60_000;

export type SurusTahmini = {
  /** Hareket görülen toplam süre (ms). null → hiç telemetri yok. */
  surusMs: number | null;
  /** Sessizlik bandı (ms) — ne sürüş ne durak. */
  belirsizMs: number | null;
  nokta: number;
};

/**
 * SÜRÜŞ SÜRESİ — TELEMETRİ HAREKETİNDEN TAHMİN.
 *
 * 🔴 BU BİR ÖLÇÜM DEĞİL. Takograf yok; kart okuması, mühür ve yasal kayıt
 * yok. ÖLÇÜLDÜ (HAK61, 7 gün, 12 vardiya): sürüş/vardiya oranı medyan %46,5;
 * telemetri boşluğu medyan vardiya süresinin %32,2'si; 12 vardiyanın 3'ünde
 * HİÇ telemetri yok. Yani ortalama bir vardiyanın üçte biri sınıflanamıyor.
 *
 * Belirsizlik bandı ayrı döndürülür ve ekrana basılır — gizlenirse tahmin
 * ölçüm gibi okunur.
 */
export async function surusTahminiOlc(
  vehicleId: string | null,
  bas: string,
  bit: string
): Promise<SurusTahmini> {
  if (!vehicleId) return { surusMs: null, belirsizMs: null, nokta: 0 };

  const track = await listVehicleTrack(vehicleId, bas, bit);
  if (track.length === 0) return { surusMs: null, belirsizMs: null, nokta: 0 };

  let surus = 0;
  let belirsiz = 0;
  for (let i = 1; i < track.length; i++) {
    const dt = Date.parse(track[i].recorded_at) - Date.parse(track[i - 1].recorded_at);
    if (!(dt > 0)) continue;
    if (dt > SURUS_BOSLUK_TAVAN_MS) {
      belirsiz += dt;
      continue;
    }
    const hareket = (track[i - 1].speed_kmh ?? 0) > 0 || (track[i].speed_kmh ?? 0) > 0;
    if (hareket) surus += dt;
  }
  return { surusMs: surus, belirsizMs: belirsiz, nokta: track.length };
}

// ═══════════════════════ CANLI DURUM ═════════════════════════════════════

export type MevzuatPanosu = {
  ayar: MevzuatAyari;
  /** Şu an sahada olan (açık vardiyalı) şoförler. */
  satirlar: SoforDurumu[];
  /** Açık vardiyası olmayan şoför sayısı — kapsama kanıtı. */
  vardiyasiz: number;
  /**
   * 24 saatten uzun süredir açık kayıt sayısı. Bunlara uyarı GİTMEZ; asıl
   * yapılacak iş vardiyayı kapatmaktır ve ekran bunu söyler.
   */
  bayatVardiya: number;
  /** Sürüş tahmini kapalı ama set onu istiyor mu — ekran uyarısı. */
  surusEkseniKapali: boolean;
  olculduAn: string;
};

type AcikVardiya = {
  id: string;
  worker_id: string;
  vehicle_id: string | null;
  started_at: string;
  ended_at: string | null;
  break_minutes: number | null;
};

/**
 * CANLI DURUM — şu an sahada kim, ne kadar süresi kaldı.
 *
 * Yalnız AÇIK vardiyalar taranır: kapanmış vardiyanın "kalan süresi" diye
 * bir şey yok, o geçmişe dönük raporun konusu.
 *
 * ═══ `fleetScope` — EKLENDİ (Faz D-4), VARSAYILANI BUGÜNKÜ DAVRANIŞ ═══
 *
 * Parametre verilmezse `UNRESTRICTED` geçerlidir, yani panelin ve tarama
 * cron'unun davranışı **bir satır bile değişmez**. Mobil uç kendi kapısından
 * (`requireMobileFleetView`) çıkan kapsamı AÇIKÇA veriyor.
 *
 * ⚠️ PANEL BU PARAMETREYİ BUGÜN GEÇMİYOR ve bu bilinçli bir SINIRDIR, bir
 * paklama değil: `/admin/mevzuat` `requireFleetView` ile şefi içeri alıyor
 * ama satırları filoya daraltmıyor — yani şef panelde bugün TÜM açık
 * vardiyaları görüyor. O davranışı bu turda değiştirmedik (canlı müşteride
 * bir şefin ekranını sessizce daraltmak ayrı bir karardır); mobil uç ise
 * fail-closed tarafta durup kapsamı UYGULUYOR. Fark yanıtta `kapsam`
 * bloğuyla GÖRÜNÜR — bkz. docs/MEVZUAT-UCLARI.md §3.
 */
export async function mevzuatPanosu(
  simdi: Date = new Date(),
  fleetScope: FleetScope = UNRESTRICTED
): Promise<MevzuatPanosu> {
  const ayar = await mevzuatAyari();
  const scope = await getTestScope();

  const { data, error } = await onlyFleet(
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, started_at, ended_at, break_minutes")
        .is("ended_at", null)
        .limit(500),
      "worker_id",
      scope.workerIds
    ),
    "worker_id",
    fleetScope.workerIds,
    fleetScope
  );

  const acik = (error ? [] : ((data ?? []) as AcikVardiya[])).filter((r) => r.worker_id);

  // test-visible: yalnız İSİM ETİKETİ sözlüğü — hiçbir sayıyı etkilemez.
  // Satırların test kapsamı yukarıdaki `withoutTestRows(..., "worker_id", ...)`
  // ile ZATEN uygulandı; test hesabının vardiyası buraya hiç gelmez. Sözlüğü
  // süzmek tek bir kalan süreyi bile değiştirmez.
  const { data: wData } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .eq("is_active", true);
  const adlar = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  const kurallar = KURAL_SETLERI[ayar.kuralSeti];
  const surusGerek = setinTemeli(ayar.kuralSeti) === "surus_tahmini" && ayar.surusTahmini;

  const satirlar = await mapBounded(acik, async (e): Promise<SoforDurumu> => {
    const calismaMs = workedMs(e, simdi.getTime());
    const gece = touchesNightWindow(e.started_at, e.ended_at, simdi);

    /**
     * 🔴 KAPANMAMIŞ KAYIT — açık kalma süresi ham, molasız ölçülür.
     *
     * `workedMs` kayıtlı molayı düşer; bayatlık ölçüsü ise "bu satır ne
     * kadardır AÇIK" sorusudur, molayla ilgisi yok. 8 saatlik molası olan
     * 30 saatlik bir kayıt yine kapanmamış kayıttır.
     */
    const acikMs = simdi.getTime() - Date.parse(e.started_at);
    const bayat = acikMs > VARDIYA_BAYAT_MS;

    // Bayat kayıtta telemetri turu ATLANIR: sonucu zaten kullanılmayacak.
    const surus =
      surusGerek && !bayat
        ? await surusTahminiOlc(e.vehicle_id, e.started_at, simdi.toISOString())
        : { surusMs: null, belirsizMs: null, nokta: 0 };

    const girdi: OlcumGirdi = {
      calismaMs,
      gece,
      // ⚠️ null = KAYIT YOK. 0 yazmak "mola vermedi" demek olurdu ve ölçülmüş
      // gibi görünürdü; 30 günde 6 saati aşan 391 vardiyanın 241'inde kayıt yok.
      molaDk: e.break_minutes === null || e.break_minutes === undefined ? null : e.break_minutes,
      surusMs: surus.surusMs,
      surusBelirsizMs: surus.belirsizMs,
      vardiyaBayat: bayat,
    };

    return soforDurumu(
      e.worker_id,
      adlar.get(e.worker_id) ?? "—",
      e.id,
      ayar.kuralSeti,
      kurallar.map((k) => kuralDurumu(k, girdi, ayar.kademe)),
      bayat
    );
  });

  // Kritiklik sırası: ihlal → son → yaklaştı → erken → risk yok.
  const AGIRLIK: Record<string, number> = { ihlal: 4, son: 3, yaklasti: 2, erken: 1 };
  satirlar.sort((a, b) => {
    const fa = a.enKritik ? AGIRLIK[a.enKritik] : 0;
    const fb = b.enKritik ? AGIRLIK[b.enKritik] : 0;
    if (fa !== fb) return fb - fa;
    return (a.enYakinKalanDk ?? 1e9) - (b.enYakinKalanDk ?? 1e9);
  });

  /**
   * ⚠️ BU SAYI EKRANDA GÖRÜNÜYOR ("N şoförün açık vardiyası yok"), o yüzden
   * test hesabı ELENMELİ. Yukarıdaki isim sözlüğünün aksine burası bir
   * ETİKET değil bir SAYI — kalıcı test şoförü paydayı bir kişi şişirirdi.
   */
  const { count: aktifSayi } = await onlyFleet(
    withoutTestRows(
      supabaseAdmin.from("workers").select("id", { count: "exact", head: true }).eq("is_active", true),
      "id",
      scope.workerIds
    ),
    "id",
    fleetScope.workerIds,
    fleetScope
  );

  return {
    ayar,
    satirlar,
    vardiyasiz: Math.max(0, (aktifSayi ?? 0) - satirlar.length),
    bayatVardiya: satirlar.filter((s) => s.vardiyaBayat).length,
    surusEkseniKapali: setinTemeli(ayar.kuralSeti) === "surus_tahmini" && !ayar.surusTahmini,
    olculduAn: simdi.toISOString(),
  };
}

// ═══════════════════════ UYARI GÖNDERİMİ ═════════════════════════════════

export type TaramaSonucu = {
  tabloYok: boolean;
  taranan: number;
  /** Kademe koşulu sağlayan (kural, şoför) çifti sayısı. */
  aday: number;
  /** GERÇEKTEN yazılan (yani daha önce gönderilmemiş) uyarı sayısı. */
  yazilan: number;
  /** Tekil indekse takılan — yani spam ENGELLENDİ. */
  tekrar: number;
  gonderilenler: {
    workerId: string;
    ad: string;
    kural: string;
    kademe: Kademe;
    kalanDk: number | null;
    soforJeton: number;
    yoneticiJeton: number;
  }[];
  hata: string | null;
};

/**
 * TARAMA — kademe koşulunu sağlayan her (şoför, kural) için BİR uyarı.
 *
 * ⚠️ SPAM ŞEMA DÜZEYİNDE ENGELLENİYOR: `mevzuat_uyari_tekil` indeksi
 * (worker_id, gun, kural, kademe) tekil. İkinci insert 23505 döner, gönderim
 * YAPILMAZ. Kod tarafında "gönderdim mi" kontrolü de var ama tek başına
 * yeterli değildi: iki tur çakışırsa (cron gecikmesi) ikisi de gönderirdi.
 */
export async function mevzuatTara(
  simdi: Date = new Date(),
  kuru = false
): Promise<TaramaSonucu> {
  const pano = await mevzuatPanosu(simdi);
  const sonuc: TaramaSonucu = {
    tabloYok: pano.ayar.tabloYok,
    taranan: pano.satirlar.length,
    aday: 0,
    yazilan: 0,
    tekrar: 0,
    gonderilenler: [],
    hata: null,
  };
  if (pano.ayar.tabloYok) return sonuc;

  const gun = viennaDayKey(simdi.toISOString());
  const { mevzuatUyarisiBildir } = await import("@/lib/push");

  for (const s of pano.satirlar) {
    for (const k of s.kurallar) {
      if (!k.kademe) continue;
      sonuc.aday++;
      if (kuru) continue;

      /**
       * ÖNCE YAZ, SONRA GÖNDER.
       *
       * Sıra kritik: önce gönderip sonra yazsaydık, yazma başarısız olduğunda
       * bir sonraki tur AYNI bildirimi tekrar gönderirdi. Tekil indeks
       * gönderimin KAPISIDIR.
       */
      const { data: yeni, error } = await supabaseAdmin
        .from("mevzuat_uyarilari")
        .insert({
          worker_id: s.workerId,
          time_entry_id: s.entryId,
          gun,
          kural_seti: s.kuralSeti,
          kural: k.kural,
          kademe: k.kademe,
          olcum_temeli: k.temel,
          kalan_dk: k.kalanDk,
          esik_dk: k.esikDk,
          olculen_dk: k.olculenDk,
          surus_belirsiz_dk: k.belirsizDk,
        })
        .select("id")
        .single();

      if (error) {
        // 23505 = bu kademe bu şoföre bugün ZATEN gönderildi. Sessiz ve doğru.
        if (error.code === "23505") sonuc.tekrar++;
        else sonuc.hata = error.message.slice(0, 160);
        continue;
      }

      sonuc.yazilan++;
      const b = await mevzuatUyarisiBildir({ workerId: s.workerId, ad: s.ad, kural: k, kademe: k.kademe });
      await supabaseAdmin
        .from("mevzuat_uyarilari")
        .update({
          sofor_jeton: b.soforJeton,
          yonetici_jeton: b.yoneticiJeton,
          bildirim_hata: b.hata,
        })
        .eq("id", (yeni as { id: string }).id);

      sonuc.gonderilenler.push({
        workerId: s.workerId,
        ad: s.ad,
        kural: k.kural,
        kademe: k.kademe,
        kalanDk: k.kalanDk,
        soforJeton: b.soforJeton,
        yoneticiJeton: b.yoneticiJeton,
      });
    }
  }

  return sonuc;
}

// ═══════════════════════ GEÇMİŞ ══════════════════════════════════════════

export type UyariKaydi = {
  id: string;
  workerId: string;
  gun: string;
  kural: string;
  kademe: Kademe;
  olcumTemeli: string;
  kalanDk: number | null;
  esikDk: number;
  olculenDk: number | null;
  soforJeton: number | null;
  yoneticiJeton: number | null;
  createdAt: string;
};

export async function uyariGecmisi(
  gunSayisi = 7
): Promise<{ satirlar: UyariKaydi[]; tabloYok: boolean }> {
  const bas = new Date(Date.now() - gunSayisi * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("mevzuat_uyarilari")
    .select("*")
    .gte("gun", bas)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return { satirlar: [], tabloYok: tabloYokMu(error) };

  return { tabloYok: false, satirlar: (data ?? []).map(uyariCevir) };
}

/** Defter satırı → API biçimi. Panel geçmişi ve mobil liste TEK çeviriciyi kullanır. */
function uyariCevir(ham: unknown): UyariKaydi {
  const r = ham as Record<string, unknown>;
  const sayiVeyaNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    workerId: String(r.worker_id),
    gun: String(r.gun),
    kural: String(r.kural),
    kademe: String(r.kademe) as Kademe,
    olcumTemeli: String(r.olcum_temeli),
    kalanDk: sayiVeyaNull(r.kalan_dk),
    esikDk: Number(r.esik_dk),
    olculenDk: sayiVeyaNull(r.olculen_dk),
    soforJeton: sayiVeyaNull(r.sofor_jeton),
    yoneticiJeton: sayiVeyaNull(r.yonetici_jeton),
    createdAt: String(r.created_at),
  };
}

/** Ayar yazma — yalnız yönetici yolundan çağrılır. */
export async function mevzuatAyariYaz(
  girdi: { kuralSeti: KuralSeti; surusTahmini: boolean; kademe: KademeAyari },
  workerId: string | null
): Promise<{ ok: boolean; hata?: string }> {
  const { kademe } = girdi;
  // Sıra kuralı SAF katmanda (lib/mevzuat.ts kademeDenetle) — mobil PATCH ucu
  // 400 döndürebilmek için aynı fonksiyonu yazmadan ÖNCE çağırıyor.
  const sira = kademeDenetle(kademe);
  if (sira) return { ok: false, hata: sira };
  const { error } = await supabaseAdmin
    .from("tenant_mevzuat")
    .update({
      kural_seti: girdi.kuralSeti,
      surus_tahmini: girdi.surusTahmini,
      kademe_erken_dk: kademe.erken,
      kademe_yaklasti_dk: kademe.yaklasti,
      kademe_son_dk: kademe.son,
      updated_at: new Date().toISOString(),
      updated_by: workerId,
    })
    .eq("id", "singleton");

  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  return { ok: true };
}

// ═══════════════ MOBİL PANO OKUMALARI (Faz D-4) ══════════════════════════

export type UyariListesi = {
  satirlar: UyariKaydi[];
  /** Süzgeçten geçen TOPLAM satır (sayfa değil) — PostgREST `count: "exact"`. */
  toplam: number;
  tabloYok: boolean;
};

/**
 * GÖNDERİLMİŞ UYARI DEFTERİ — süzgeçli ve SAYFALI okuma.
 *
 * `uyariGecmisi`nin (panel, son 7 gün, 300 satır tavanı) mobil ikizi. İki fark
 * ve ikisi de bilinçli:
 *
 *   1. **SAYFALI.** Telefon 300 satırlık bir gövdeyi ne indirmeli ne çizmeli.
 *      `total` sunucudan gelen GERÇEK sayıdır (`count: "exact"`), istemci
 *      "kaç tane var"ı tahmin etmez — lib/mobile-list.ts sözleşmesi.
 *   2. **KAPSAMLI.** Şef kendi filosu dışındaki şoförün uyarısını görmez.
 *      `mevzuatPanosu`daki gerekçenin aynısı (o fonksiyonun başlığı).
 *
 * ⚠️ `durum=acik|kapali` DİYE BİR SÜZGEÇ YOK ÇÜNKÜ ÜRÜNDE KAPANIŞ YOK.
 * `mevzuat_uyarilari` bir DEFTERDİR ve bilerek DEĞİŞMEZDİR: gönderilmiş bir
 * bildirimi kapatmak/silmek onu gönderilmemiş gibi gösterir ve tekil indeksin
 * spam korumasını bozar (kural `scripts/check-crud-ekranlari.mjs` MUAF
 * listesinde yazılı, panelde de kapatma düğmesi YOK). Uç bu yüzden `?durum=`
 * geldiğinde 400 döner — sessizce yutup "süzdüm" demez.
 */
export async function uyariListesi(s: {
  gunSayisi: number;
  soforId: string | null;
  limit: number;
  offset: number;
  fleetScope: FleetScope;
}): Promise<UyariListesi> {
  const bas = new Date(Date.now() - s.gunSayisi * 86_400_000).toISOString().slice(0, 10);

  let q = supabaseAdmin
    .from("mevzuat_uyarilari")
    .select("*", { count: "exact" })
    .gte("gun", bas);
  if (s.soforId) q = q.eq("worker_id", s.soforId);
  q = onlyFleet(q, "worker_id", s.fleetScope.workerIds, s.fleetScope);

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(s.offset, s.offset + s.limit - 1);

  if (error) return { satirlar: [], toplam: 0, tabloYok: tabloYokMu(error) };
  return { satirlar: (data ?? []).map(uyariCevir), toplam: count ?? 0, tabloYok: false };
}

export type MevzuatBelgeleri = {
  satirlar: ExpiringDocument[];
  /** Süresi DOLMUŞ (days < 0). */
  dolmus: number;
  /** Eşiğe girmiş ama henüz dolmamış. */
  yaklasan: number;
  /** Kiracının tanımlı AKTİF belge türü sayısı — "0 satır"ın sebebini ayırır. */
  turSayisi: number;
  /** migration 078 yok → belge ekseni hiç okunamadı. */
  tabloYok: boolean;
};

/**
 * SÜRESİ DOLMUŞ / YAKLAŞAN ŞOFÖR BELGELERİ (migration 078).
 *
 * ═══ 🔴 "EKSİK BELGE" DİYE BİR KAVRAM ÜRÜNDE YOK — ÖLÇÜLDÜ ═══
 *
 * 078'de bir belge türünün ZORUNLU olduğunu söyleyen hiçbir alan yok
 * (`document_types`: `code, label, warn_days, requires_number, active,
 * sort_order` — `requires_number` belgenin NUMARASININ zorunluluğudur, kendisinin
 * değil). Yani "Ali'de SRC yok" cümlesini kuracak veri yok: sistem yalnız
 * GİRİLMİŞ belgelerin tarihini bilir. Bu eksen bilerek böyle — tür listesi
 * kiracıya ait (TR'de SRC + psikoteknik, DACH'ta Aufenthaltstitel, AB'de CPC)
 * ve "kimde hangisi zorunlu" sorusu ülkeye ve yüke göre değişir.
 *
 * Uç bu yüzden ÖLÇÜLEBİLENİ döndürür: süresi dolmuş + eşiğe girmiş belgeler.
 * `turSayisi` ile birlikte "0 satır" okunabilir hâle gelir: tür hiç tanımlı
 * değilse eksen kapalıdır, tanımlıysa gerçekten temizdir.
 *
 * ═══ KAPSAM — /admin (Dikkat panosu) İLE AYNI ÜÇLÜ ═══
 *
 * `withoutTestRows` (test hesabı) → `onlyDrivers` (yönetici şoför değildir,
 * `counts_as_driver` muafiyetiyle) → `onlyFleet` (şefin filosu). Üçü de kendi
 * tek kaynağından geliyor; hiçbiri burada yeniden yazılmadı. Kapsam boş
 * çıkarsa `listExpiringDocuments` BOŞ döner (fail-closed), kısıtsıza düşmez.
 */
export async function mevzuatBelgeleri(
  fleetScope: FleetScope,
  simdi: Date = new Date()
): Promise<MevzuatBelgeleri> {
  const [scope, driverScope] = await Promise.all([getTestScope(), getDriverScope()]);

  const { data } = await onlyFleet(
    onlyDrivers(
      withoutTestRows(
        supabaseAdmin.from("workers").select("id").eq("is_active", true),
        "id",
        scope.workerIds
      ),
      "id",
      driverScope
    ),
    "id",
    fleetScope.workerIds,
    fleetScope
  );
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);

  const { listDocumentTypes } = await import("@/lib/documents-db");
  const [{ items, tabloYok }, { types }] = await Promise.all([
    listExpiringDocuments(ids, simdi),
    listDocumentTypes(true),
  ]);

  return {
    satirlar: items,
    dolmus: items.filter((d) => d.days < 0).length,
    yaklasan: items.filter((d) => d.days >= 0).length,
    turSayisi: types.length,
    tabloYok,
  };
}
