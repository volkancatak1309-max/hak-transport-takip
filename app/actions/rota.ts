"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED, type FleetScope } from "@/lib/fleet-scope";
import { getSeferById, ACIK_DURUMLAR, type SeferRow } from "@/lib/sefer-db";
import {
  listDuraklar,
  durakHedefleri,
  siralaDuraklar,
  type DurakRow,
} from "@/lib/sefer-duraklari";
import { kiraciAyarlari } from "@/lib/tenant-settings";
import { tenantDuvarSaatiUtc } from "@/lib/format";
import {
  ROTA_AZAMI_DURAK,
  ROTA_OPTIMIZASYONU_ENABLED,
  TAKIP_VARSAYILAN_SERVIS_DK,
} from "@/lib/tenant";
import { audit } from "@/lib/security-log";
import { rotaSaglayicilari } from "@/lib/rota/saglayici";
import { rotaKotaDus } from "@/lib/rota/kota";
import { rotaCagrisiKaydet } from "@/lib/rota/kayit";
import {
  parmakIziMetni,
  rotaCekirdegi,
  saatSn,
  snSaat,
  tamSira,
  type CekirdekDuragi,
  type CekirdekGirdisi,
  type CekirdekSonucu,
} from "@/lib/rota/plan";
import {
  SaglayiciHatasi,
  type Konum,
  type RotaAyari,
  type RotaOneriSonuc,
  type RotaOnerisi,
  type RotaOptimizasyonSaglayici,
  type RotaUygulaSonuc,
} from "@/lib/rota/tipler";

/**
 * ROTA OPTİMİZASYONU — sunucu eylemleri (Faz 1, tek araç).
 *
 * ═══ KAPI SIRASI — DEĞİŞTİRİLMEZ ═══
 *
 *   1. `requireFleetView` + KAPSAM (şef yalnız kendi filosunun seferi) —
 *      app/actions/duraklar.ts ile aynı kural, aynı eksen (şoför).
 *   2. MODÜL bayrağı (`ROTA_OPTIMIZASYONU`) — kapalıysa hiçbir sorgu atılmaz.
 *   3. SAĞLAYICI tanımlı mı — değilse "Rota servisi tanımlı değil".
 *   4. Girdi + durak doğrulaması (açık sefer, ≥3 bekleyen, konum, tavan).
 *   5. KOTA — doğrulamadan SONRA (geçersiz istek kredi yakmasın), sağlayıcıdan
 *      ÖNCE (hata veren istek bedava olmasın).
 *   6. Sağlayıcı — birincil ulaşılamazsa ve yedek tanımlıysa yedek.
 *   7. KAYIT — her denemede (başarılı/başarısız) bir satır.
 *
 * ═══ HESAP YAZMAZ ═══
 *
 * `rotaOner` veritabanına yalnız iki şey yazar: kota sayacı ve çağrı kaydı.
 * Durak sırası YALNIZ `rotaUygula` ile değişir — "Vazgeç" hiçbir iz bırakmaz.
 *
 * ⚠️ Bu dosyadan TİP dışa aktarılmaz (Next 16 "use server" dönüşümü,
 * 02.10.2026 olayı — bkz. scripts/check-use-server-tip.mjs). Tipler
 * lib/rota/tipler.ts'te.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function kapsamAl(): Promise<{ workerId: string | null; scope: FleetScope }> {
  const { session, fleet } = await requireFleetView();
  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  return { workerId: session.worker_id ?? null, scope };
}

async function kapsamdakiSefer(seferId: string, scope: FleetScope): Promise<SeferRow | null> {
  const s = await getSeferById(seferId);
  if (!s) return null;
  return scope.isFleetWorker(s.worker_id) ? s : null;
}

const iz = (duraklar: DurakRow[]) =>
  createHash("sha256").update(parmakIziMetni(duraklar)).digest("hex").slice(0, 32);

function cekirdekDuragi(d: DurakRow, konum: Konum): CekirdekDuragi {
  const bas = saatSn(d.pencere_bas);
  const bit = saatSn(d.pencere_bit);
  const pencereVar = bas !== null || bit !== null;
  return {
    id: d.id,
    ad: d.ad,
    sira: d.sira,
    konum,
    // Süre boşsa takip ETA'sının kullandığı kiracı varsayılanı — iki ekran
    // aynı durağa iki farklı süre biçmesin.
    servisSn: (d.tahmini_sure_dk ?? TAKIP_VARSAYILAN_SERVIS_DK) * 60,
    pencere: pencereVar ? { bas, bit } : null,
    pencereMetin: pencereVar
      ? { bas: bas !== null ? snSaat(bas) : null, bit: bit !== null ? snSaat(bit) : null }
      : null,
  };
}

/** Başlangıç bölgesi — aktif ve arşivlenmemiş olmalı. */
async function bolgeKonumu(id: string): Promise<{ ad: string; konum: Konum } | null> {
  const { data } = await supabaseAdmin
    .from("geofences")
    .select("id, name, center_lat, center_lng, active, archived_at")
    .eq("id", id)
    .maybeSingle();
  const z = data as {
    name: string;
    center_lat: number;
    center_lng: number;
    active: boolean;
    archived_at: string | null;
  } | null;
  if (!z || !z.active || z.archived_at) return null;
  return { ad: z.name, konum: { lat: Number(z.center_lat), lng: Number(z.center_lng) } };
}

function ayarGecerli(a: RotaAyari | null | undefined): a is RotaAyari {
  return (
    !!a &&
    (a.baslangic === "sonraki" || UUID.test(a.baslangic ?? "")) &&
    (a.bitis === "acik" || a.bitis === "donus") &&
    saatSn(a.hareket) !== null
  );
}

/**
 * ÖNERİ — iki sırayı hesaplar, hiçbir sırayı DEĞİŞTİRMEZ.
 */
export async function rotaOner(seferId: string, ayar: RotaAyari): Promise<RotaOneriSonuc> {
  const { workerId, scope } = await kapsamAl();
  if (!ROTA_OPTIMIZASYONU_ENABLED) return { ok: false, hata: "modul_kapali" };

  const { birincil, yedek } = rotaSaglayicilari();
  if (!birincil) return { ok: false, hata: "servis_yok" };

  if (!UUID.test(seferId ?? "") || !ayarGecerli(ayar)) return { ok: false, hata: "gecersiz" };

  // Saat dilimi tablo değeriyle (108) — gün sınırı ve duvar saati ondan.
  await kiraciAyarlari();

  const sefer = await kapsamdakiSefer(seferId, scope);
  if (!sefer) return { ok: false, hata: "kapsam_disi" };
  if (!ACIK_DURUMLAR.includes(sefer.durum)) return { ok: false, hata: "sefer_kapali" };

  const { duraklar, tabloYok } = await listDuraklar(seferId);
  if (tabloYok) return { ok: false, hata: "tablo_yok" };

  const bekleyen = duraklar.filter((d) => d.durum === "bekliyor").sort((a, b) => a.sira - b.sira);
  if (bekleyen.length < 3) return { ok: false, hata: "az_durak" };
  if (bekleyen.length > ROTA_AZAMI_DURAK) {
    return { ok: false, hata: "cok_durak", limit: ROTA_AZAMI_DURAK };
  }

  /**
   * KONUM — bölge merkezi ya da durağın kendi koordinatı (082). Yalnız ADRESİ
   * olan durak (082'de meşru) jeokodlanmaz: adres bir etiket, koordinat bir
   * ölçüm. Ekran durağın adını söyler, sıra değişmez.
   */
  const geo = await durakHedefleri(bekleyen);
  const konumsuz = bekleyen.filter((d) => !geo.has(d.id)).map((d) => d.ad);
  if (konumsuz.length > 0) return { ok: false, hata: "konumsuz", duraklar: konumsuz };

  const cekirdek = bekleyen.map((d) => {
    const h = geo.get(d.id)!;
    return cekirdekDuragi(d, { lat: h.lat, lng: h.lng });
  });

  let baslangic: CekirdekGirdisi["baslangic"];
  let siralanacak: CekirdekDuragi[];
  if (ayar.baslangic === "sonraki") {
    baslangic = { tur: "durak", durak: cekirdek[0] };
    siralanacak = cekirdek.slice(1);
  } else {
    const b = await bolgeKonumu(ayar.baslangic);
    if (!b) return { ok: false, hata: "gecersiz" };
    baslangic = { tur: "nokta", konum: b.konum, ad: b.ad };
    siralanacak = cekirdek;
  }

  const anMs = (sn: number) => tenantDuvarSaatiUtc(sefer.tarih, sn)?.getTime() ?? NaN;
  if (!Number.isFinite(anMs(0))) return { ok: false, hata: "gecersiz" };
  const girdi: CekirdekGirdisi = {
    anMs,
    hareketSn: saatSn(ayar.hareket)!,
    baslangic,
    donus: ayar.bitis === "donus",
    siralanacak,
  };

  // ── KOTA: doğrulamadan sonra, sağlayıcıdan önce ───────────────────────
  const kota = await rotaKotaDus();
  if (!kota.ok) {
    return kota.kod === "kota_doldu"
      ? { ok: false, hata: "kota_doldu", limit: kota.tavan }
      : { ok: false, hata: "kota_okunamadi" };
  }

  const t0 = Date.now();
  const kaydet = (
    sonuc: string,
    s: RotaOptimizasyonSaglayici | null,
    c: { siralananDurak: number; rotaIstegi: number } | null,
    yedekKullanildi = false
  ) =>
    rotaCagrisiKaydet({
      workerId,
      seferId,
      durak: bekleyen.length,
      saglayici: s?.kod ?? null,
      yedekKullanildi,
      maliyetUsd: s && c ? s.maliyetUsd(c) : 0,
      rotaIstegi: c?.rotaIstegi ?? 0,
      sonuc,
      sureMs: Date.now() - t0,
    });

  let kullanilan = birincil;
  let yedekKullanildi = false;
  let sonuc: CekirdekSonucu;
  try {
    sonuc = await rotaCekirdegi(birincil, girdi);
  } catch (e) {
    const tur = e instanceof SaglayiciHatasi ? e.tur : "erisilemedi";
    // Hata metni koordinat taşıyabilir (VROOM "Unfound route(s) from location
    // [lon,lat]", fetch "Failed to parse URL …") — günlüğe maskeli yazılır.
    const metin = String((e as Error)?.message ?? e).replace(/-?\d{1,3}\.\d{3,}/g, "…");
    console.error(`[rota] ${birincil.kod} başarısız (${tur}): ${metin.slice(0, 200)}`);
    // Yalnız ULAŞILAMAYAN servis yedeğe devredilir: reddedilen girdi ya da
    // yanlış anahtar yedekte de aynı sonucu verir ya da sorunu gizler.
    if (!yedek || tur !== "erisilemedi") {
      await kaydet(`hata:${tur}`, birincil, null);
      return { ok: false, hata: "servis_hatasi" };
    }
    try {
      sonuc = await rotaCekirdegi(yedek, girdi);
      kullanilan = yedek;
      yedekKullanildi = true;
    } catch (e2) {
      const tur2 = e2 instanceof SaglayiciHatasi ? e2.tur : "erisilemedi";
      console.error(`[rota] yedek ${yedek.kod} de başarısız (${tur2})`);
      await kaydet(`hata:${tur}+yedek:${tur2}`, yedek, null, true);
      return { ok: false, hata: "servis_hatasi" };
    }
  }

  if (!sonuc.ok) {
    await kaydet("harita_disi", kullanilan, null, yedekKullanildi);
    return { ok: false, hata: "harita_disi", duraklar: sonuc.duraklar };
  }

  const yeniSira = tamSira(duraklar, sonuc.bekleyenSira);
  const simdiki = [...duraklar].sort((a, b) => a.sira - b.sira).map((d) => d.id);
  const sabitDurak = duraklar.length - bekleyen.length;
  const baslangicKonum = baslangic.tur === "durak" ? baslangic.durak.konum : baslangic.konum;

  /**
   * HARİTA — sunucu karar verir. Lisans izin vermiyorsa (Google, EEA dışı)
   * geometri gövdeye HİÇ konmaz; istemcinin "çizmemesi"ne güvenilmez.
   */
  const haritaSerbest = kullanilan.haritaSerbest;
  const geometrisiz = <T extends { geometri: string | null }>(p: T): T =>
    haritaSerbest ? p : { ...p, geometri: null };

  const oneri: RotaOnerisi = {
    saglayici: { kod: kullanilan.kod, ad: kullanilan.ad, yedekKullanildi },
    ayar: {
      baslangicAd: baslangic.tur === "durak" ? baslangic.durak.ad : baslangic.ad,
      bitis: ayar.bitis,
      hareketMs: anMs(girdi.hareketSn),
    },
    once: geometrisiz(sonuc.once),
    sonra: geometrisiz(sonuc.sonra),
    fark: {
      mesafeM: Math.round(sonuc.once.ozet.mesafeM - sonuc.sonra.ozet.mesafeM),
      toplamSn: Math.round(sonuc.once.ozet.toplamSn - sonuc.sonra.ozet.toplamSn),
      gecikenDurak: sonuc.once.ozet.gecikenDurak - sonuc.sonra.ozet.gecikenDurak,
    },
    degisti: yeniSira.some((id, i) => id !== simdiki[i]),
    yeniSira,
    parmakIzi: iz(duraklar),
    sabitDurak,
    harita: haritaSerbest
      ? {
          once: sonuc.once.geometri,
          sonra: sonuc.sonra.geometri,
          baslangic: baslangicKonum,
          bitis: ayar.bitis === "donus" ? baslangicKonum : null,
          noktalar: sonuc.sonra.duraklar.map((d, i) => ({
            id: d.id,
            ad: d.ad,
            konum: d.konum,
            yeniSira: sabitDurak + i + 1,
          })),
        }
      : null,
    sureMs: Date.now() - t0,
  };

  await kaydet(
    "ok",
    kullanilan,
    { siralananDurak: sonuc.siralananDurak, rotaIstegi: sonuc.rotaIstegi },
    yedekKullanildi
  );
  return { ok: true, oneri };
}

/**
 * UYGULA — önerilen TAM sırayı yazar (082'nin `sefer_duraklari_sirala`
 * fonksiyonu; yalnız `sira` kolonu, eşzamanlı durum değişikliği ezilmez).
 *
 * ⚠️ PARMAK İZİ: hesaptan sonra duraklar değiştiyse (eklendi, silindi, şoför
 * bir durağı kapattı, pencere düzeltildi) öneri artık bu listeye ait değildir;
 * yazılmaz, ekran yeniden hesap ister.
 */
export async function rotaUygula(
  seferId: string,
  yeniSira: string[],
  parmakIzi: string
): Promise<RotaUygulaSonuc> {
  const { workerId, scope } = await kapsamAl();
  if (!ROTA_OPTIMIZASYONU_ENABLED) return { ok: false, hata: "modul_kapali" };
  if (
    !UUID.test(seferId ?? "") ||
    !Array.isArray(yeniSira) ||
    !yeniSira.every((id) => typeof id === "string" && UUID.test(id)) ||
    typeof parmakIzi !== "string"
  ) {
    return { ok: false, hata: "gecersiz" };
  }

  const sefer = await kapsamdakiSefer(seferId, scope);
  if (!sefer) return { ok: false, hata: "kapsam_disi" };
  if (!ACIK_DURUMLAR.includes(sefer.durum)) return { ok: false, hata: "sefer_kapali" };

  const { duraklar, tabloYok } = await listDuraklar(seferId);
  if (tabloYok) return { ok: false, hata: "tablo_yok" };
  if (iz(duraklar) !== parmakIzi) return { ok: false, hata: "degisti" };

  // Kapanmış duraklar başta ve şimdiki sıralarıyla — öneri bunu garanti
  // ediyor; elle kurcalanmış bir liste onları araya taşıyamaz.
  const kapanmis = duraklar
    .filter((d) => d.durum !== "bekliyor")
    .sort((a, b) => a.sira - b.sira)
    .map((d) => d.id);
  if (!kapanmis.every((id, i) => yeniSira[i] === id)) return { ok: false, hata: "gecersiz" };

  const r = await siralaDuraklar(seferId, yeniSira);
  if (!r.ok) {
    return {
      ok: false,
      hata: r.sebep === "eksik_id" ? "degisti" : r.sebep === "tablo_yok" ? "tablo_yok" : "hata",
    };
  }

  await audit(workerId, "update", `sefer_durak_sira:${seferId}`, { kaynak: "rota_optimizasyonu" });
  revalidatePath("/admin/seferler");
  revalidatePath("/panel/seferler");
  return { ok: true };
}
