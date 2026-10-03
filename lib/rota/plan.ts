/**
 * ROTA OPTİMİZASYONU — alan katmanı (SAF: veritabanı yok, ağ yalnız verilen
 * sağlayıcı üzerinden).
 *
 * ═══ AKIŞ — ÜÇ ÇAĞRI, BİR KARAR ═══
 *
 *   1. ŞİMDİKİ sıranın yol hesabı (`rotaHesapla`) — "önce" sayıları VE harita
 *      kapsamı denetimi aynı çağrıdan çıkıyor.
 *   2. Sıralama (`sirala`).
 *   3. ÖNERİLEN sıranın yol hesabı (`rotaHesapla`) — sıra aynıysa ATLANIR.
 *
 * Önce ve sonra AYNI motorla ölçülüyor. Optimizasyon motorunun kendi
 * özetini "sonra" diye göstermek, iki farklı hesabı yan yana koymak olurdu:
 * kazanç kısmen motor farkından gelirdi ve ekran bunu ayırt edemezdi.
 *
 * ═══ ZAMAN ÇİZELGESİ BİZDE HESAPLANIYOR ═══
 *
 * Varış saatleri sağlayıcıdan değil `programHesapla`dan gelir: bacak süresi +
 * durak süresi + pencere beklemesi. İki sıra için de AYNI formül çalışır, yani
 * "önce 3 durak geç, sonra 0" cümlesi aynı ölçüyle kurulmuş olur.
 * Formül takip linkinin ETA zinciriyle aynı ailedendir (lib/takip-eta.ts).
 *
 * ═══ KAPANMIŞ DURAKLAR YERİNDE KALIR ═══
 *
 * `varildi` / `tamamlandi` / `atlandi` duraklar sıralamaya GİRMEZ: yapılmış işin
 * sırasını değiştirmek geçmişi yeniden yazmak olurdu. Yeni sırada başa
 * (şimdiki sıralarıyla) konurlar; yalnız `bekliyor` olanlar sıralanır.
 */
import type {
  Konum,
  PlanDuragi,
  RotaBacagi,
  RotaDuragi,
  RotaOptimizasyonSaglayici,
  RotaPlani,
  SiralamaProblemi,
} from "./tipler";
import { SaglayiciHatasi } from "./tipler";

/**
 * Bir noktanın yola oturma mesafesi bunu aşarsa nokta harita KAPSAMI DIŞINDA
 * sayılır. 03.10.2026 ölçümü (Avusturya verisi): Avusturya'daki noktalar
 * 1-9 m'de oturuyor; Lindau (DE) 3.380 m, Vaduz (LI) 8.574 m. 1.000 m, kırsal
 * bir çiftliğin yola uzaklığını yanlış alarm saymayacak kadar geniş, sınır
 * ötesindeki bir şehri yakalayacak kadar dar.
 */
export const YAPISMA_SINIRI_M = 1000;

/** Hareket saatinin üst sınırı yok ama pencere dışı ufuk: 2 gün. */
const UFUK_SN = 2 * 86_400;

export type DurakDurumu = "bekliyor" | "varildi" | "tamamlandi" | "atlandi";

/** Alan katmanının durak biçimi — veritabanı satırından türetilir. */
export type CekirdekDuragi = {
  id: string;
  ad: string;
  sira: number;
  konum: Konum;
  servisSn: number;
  pencere: { bas: number | null; bit: number | null } | null;
  /** Ekrana "HH:MM" olarak giden pencere. */
  pencereMetin: { bas: string | null; bit: string | null } | null;
};

/** "HH:MM" ya da "HH:MM:SS" → gün başından saniye. Geçersizse null. */
export function saatSn(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const sa = Number(m[1]);
  const dk = Number(m[2]);
  const sn = Number(m[3] ?? 0);
  if (sa > 23 || dk > 59 || sn > 59) return null;
  return sa * 3600 + dk * 60 + sn;
}

/** Gün başından saniye → "HH:MM" (pencere metni için). */
export function snSaat(sn: number): string {
  const s = Math.max(0, Math.round(sn / 60));
  return `${String(Math.floor(s / 60) % 24).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function rotaDuragi(d: CekirdekDuragi, pencereYok = false): RotaDuragi {
  return {
    id: d.id,
    konum: d.konum,
    servisSn: d.servisSn,
    pencere: pencereYok ? null : d.pencere,
  };
}

/**
 * ZAMAN ÇİZELGESİ — saf hesap.
 *
 * Noktalar: P0 = başlangıç (durak ya da bölge), P1..Pn = `sira`, P(n+1) =
 * dönüş noktası (`bitisVar`). Bacak k, P(k) → P(k+1).
 *
 * Pencere kuralı (sektör: "erken gelen bekler, geç gelen geç kalmıştır"):
 *   · varış < pencere başı → bekler, hizmet pencere başında başlar
 *   · varış > pencere sonu → GEÇ; gecikme = varış − pencere sonu
 */
export function programHesapla(a: {
  /** Duvar saati (gece yarısından sn) → UTC epoch ms; yaz saatini bilir. */
  anMs: (sn: number) => number;
  hareketSn: number;
  baslangicDuragi: CekirdekDuragi | null;
  sira: CekirdekDuragi[];
  bacaklar: RotaBacagi[];
  bitisVar: boolean;
  geometri: string | null;
}): RotaPlani {
  const beklenenBacak = a.sira.length + (a.bitisVar ? 1 : 0);
  if (a.bacaklar.length !== beklenenBacak) {
    throw new SaglayiciHatasi(
      "gecersiz_cevap",
      `bacak sayısı ${a.bacaklar.length}, beklenen ${beklenenBacak}`
    );
  }

  const duraklar: PlanDuragi[] = [];
  let t = a.hareketSn;

  const ugra = (d: CekirdekDuragi, baslangicDuragi: boolean) => {
    const varis = t;
    const bas = d.pencere?.bas ?? null;
    const bit = d.pencere?.bit ?? null;
    const bekleme = bas !== null && varis < bas ? bas - varis : 0;
    const gecikme = bit !== null && varis > bit ? varis - bit : 0;
    duraklar.push({
      id: d.id,
      ad: d.ad,
      eskiSira: d.sira,
      varisMs: a.anMs(varis),
      beklemeSn: bekleme,
      gecikmeSn: gecikme,
      servisSn: d.servisSn,
      pencere: d.pencereMetin,
      baslangicDuragi,
      konum: d.konum,
    });
    t = varis + bekleme + d.servisSn;
  };

  if (a.baslangicDuragi) ugra(a.baslangicDuragi, true);
  a.sira.forEach((d, k) => {
    t += a.bacaklar[k].sureSn;
    ugra(d, false);
  });
  if (a.bitisVar) t += a.bacaklar[a.sira.length].sureSn;

  const topla = (f: (x: PlanDuragi) => number) => duraklar.reduce((s, x) => s + f(x), 0);
  return {
    duraklar,
    geometri: a.geometri,
    ozet: {
      mesafeM: a.bacaklar.reduce((s, b) => s + b.mesafeM, 0),
      surusSn: a.bacaklar.reduce((s, b) => s + b.sureSn, 0),
      servisSn: topla((x) => x.servisSn),
      beklemeSn: topla((x) => x.beklemeSn),
      toplamSn: t - a.hareketSn,
      gecikenDurak: duraklar.filter((x) => x.gecikmeSn > 0).length,
      bitisMs: a.anMs(t),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ÇEKİRDEK — sağlayıcıyı çağıran tek yer
// ══════════════════════════════════════════════════════════════════════════

export type CekirdekGirdisi = {
  /** Duvar saati (gece yarısından sn) → UTC epoch ms; yaz saatini bilir. */
  anMs: (sn: number) => number;
  hareketSn: number;
  /** Sıradaki durak sabit mi, yoksa bir bölgeden mi çıkılıyor. */
  baslangic:
    | { tur: "durak"; durak: CekirdekDuragi }
    | { tur: "nokta"; konum: Konum; ad: string };
  /** Rota başlangıca dönerek mi bitiyor. */
  donus: boolean;
  /** Sırası değişebilecek bekleyen duraklar — ŞİMDİKİ sırayla. */
  siralanacak: CekirdekDuragi[];
};

export type CekirdekSonucu =
  | {
      ok: true;
      once: RotaPlani;
      sonra: RotaPlani;
      /** Önerilen sıra: başlangıç durağı (varsa) + sıralanan duraklar. */
      bekleyenSira: string[];
      /** Pencereyle yerleştirilemeyen, pencere gevşetilerek yerleşen duraklar. */
      gevsetilen: string[];
      rotaIstegi: number;
      /** Sağlayıcıya sıralama için gönderilen toplam durak (gevşetme turu dahil) — maliyet. */
      siralananDurak: number;
    }
  | { ok: false; hata: "harita_disi"; duraklar: string[] };

/**
 * Sağlayıcının cevabı girdiyle TUTARLI mı — kör güven yok. Eksik, fazla ya da
 * ikilenmiş bir kimlik, uygulanırsa durak kaybettiren bir sıra demektir.
 */
function cevapDenetle(ids: string[], sira: string[], atanamayan: string[]): void {
  const beklenen = new Set(ids);
  const gelen = [...sira, ...atanamayan];
  const gorulen = new Set<string>();
  for (const id of gelen) {
    if (!beklenen.has(id) || gorulen.has(id)) {
      throw new SaglayiciHatasi("gecersiz_cevap", `beklenmeyen ya da ikilenmiş durak: ${id}`);
    }
    gorulen.add(id);
  }
  if (gorulen.size !== beklenen.size) {
    throw new SaglayiciHatasi(
      "gecersiz_cevap",
      `cevapta ${beklenen.size - gorulen.size} durak eksik`
    );
  }
}

export async function rotaCekirdegi(
  saglayici: RotaOptimizasyonSaglayici,
  g: CekirdekGirdisi
): Promise<CekirdekSonucu> {
  const baslangicKonum = g.baslangic.tur === "durak" ? g.baslangic.durak.konum : g.baslangic.konum;
  const bitis = g.donus ? baslangicKonum : null;
  const basDurak = g.baslangic.tur === "durak" ? g.baslangic.durak : null;

  const noktalarOf = (sira: CekirdekDuragi[]): Konum[] => [
    baslangicKonum,
    ...sira.map((d) => d.konum),
    ...(bitis ? [bitis] : []),
  ];

  // ── 1) ŞİMDİKİ SIRA — "önce" + kapsam denetimi ─────────────────────────
  const onceHesap = await saglayici.rotaHesapla(noktalarOf(g.siralanacak));
  let istek = onceHesap.istekSayisi;

  if (onceHesap.yapismaM) {
    const adlar: string[] = [];
    const noktaAdi = (i: number): string => {
      if (i === 0) return basDurak ? basDurak.ad : (g.baslangic as { ad: string }).ad;
      if (i <= g.siralanacak.length) return g.siralanacak[i - 1].ad;
      return basDurak ? basDurak.ad : (g.baslangic as { ad: string }).ad;
    };
    onceHesap.yapismaM.forEach((m, i) => {
      if (m !== null && m > YAPISMA_SINIRI_M) adlar.push(noktaAdi(i));
    });
    if (adlar.length > 0) {
      return { ok: false, hata: "harita_disi", duraklar: [...new Set(adlar)] };
    }
  }

  // ── 2) SIRALAMA ──────────────────────────────────────────────────────
  // Başlangıç durağında harcanan süre hareketi öteler: araç orada hizmet
  // verip yola çıkar. Pencere beklemesi de burada sayılır.
  let cikisSn = g.hareketSn;
  if (basDurak) {
    const bas = basDurak.pencere?.bas ?? null;
    cikisSn = Math.max(cikisSn, bas ?? cikisSn) + basDurak.servisSn;
  }
  const problem: SiralamaProblemi = {
    anMs: g.anMs,
    baslangic: baslangicKonum,
    bitis,
    hareketSn: cikisSn,
    duraklar: g.siralanacak.map((d) => rotaDuragi(d)),
  };
  const ids = g.siralanacak.map((d) => d.id);
  let cevap = await saglayici.sirala(problem);
  cevapDenetle(ids, cevap.sira, cevap.atanamayan);
  let siralanan = ids.length;

  /**
   * PENCEREYE YETİŞİLEMEYEN DURAK — DURAK DÜŞMEZ.
   *
   * Motorlar sert pencereyi çözemeyince durağı "atanamayan" diye dışarıda
   * bırakır. Seferin bir durağını sessizce plandan çıkarmak kabul edilemez:
   * o durakların penceresi kaldırılıp BİR kez daha sıralanır; ekran onları
   * "geç" olarak işaretler (çizelge gecikmeyi kendisi hesaplıyor).
   * İkinci turda da yerleşmeyen (olmamalı) şimdiki sırasıyla sona eklenir.
   */
  let gevsetilen: string[] = [];
  if (cevap.atanamayan.length > 0) {
    gevsetilen = [...cevap.atanamayan];
    const gevsek = new Set(cevap.atanamayan);
    cevap = await saglayici.sirala({
      ...problem,
      duraklar: g.siralanacak.map((d) => rotaDuragi(d, gevsek.has(d.id))),
    });
    cevapDenetle(ids, cevap.sira, cevap.atanamayan);
    siralanan += ids.length;
  }
  const yerlesen = new Set(cevap.sira);
  const sonraIds = [...cevap.sira, ...ids.filter((id) => !yerlesen.has(id))];

  const byId = new Map(g.siralanacak.map((d) => [d.id, d]));
  const sonraSira = sonraIds.map((id) => byId.get(id)!);

  // ── 3) ÖNERİLEN SIRA — aynıysa ikinci hesap yok ───────────────────────
  const ayni = sonraIds.every((id, i) => id === ids[i]);
  const sonraHesap = ayni ? onceHesap : await saglayici.rotaHesapla(noktalarOf(sonraSira));
  if (!ayni) istek += sonraHesap.istekSayisi;

  const plan = (sira: CekirdekDuragi[], h: typeof onceHesap) =>
    programHesapla({
      anMs: g.anMs,
      hareketSn: g.hareketSn,
      baslangicDuragi: basDurak,
      sira,
      bacaklar: h.bacaklar,
      bitisVar: bitis !== null,
      geometri: h.geometri,
    });

  return {
    ok: true,
    once: plan(g.siralanacak, onceHesap),
    sonra: plan(sonraSira, sonraHesap),
    bekleyenSira: [...(basDurak ? [basDurak.id] : []), ...sonraIds],
    gevsetilen,
    rotaIstegi: istek,
    siralananDurak: siralanan,
  };
}

/**
 * Yeni TAM sıra — kapanmış duraklar başta (şimdiki sıralarıyla), ardından
 * önerilen bekleyen sıra. `sefer_duraklari_sirala` tam liste istiyor (082).
 */
export function tamSira(
  tumu: { id: string; sira: number; durum: DurakDurumu }[],
  bekleyenSira: string[]
): string[] {
  const kapanmis = tumu
    .filter((d) => d.durum !== "bekliyor")
    .sort((a, b) => a.sira - b.sira)
    .map((d) => d.id);
  return [...kapanmis, ...bekleyenSira];
}

/**
 * Parmak izinin girdisi — hesabı etkileyen her alan, sıraya göre.
 *
 * Kimlik + sıra + durum "liste değişti mi"yi, konum/pencere/süre ise "öneri
 * hâlâ bu veri için mi"yi yakalar: hesaptan sonra bir durağın penceresi
 * değiştiyse öneri artık o güne ait değildir ve "Uygula" yeniden hesap ister.
 */
export function parmakIziMetni(
  tumu: {
    id: string;
    sira: number;
    durum: string;
    zone_id?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    pencere_bas?: string | null;
    pencere_bit?: string | null;
    tahmini_sure_dk?: number | null;
  }[]
): string {
  return [...tumu]
    .sort((a, b) => a.sira - b.sira)
    .map((d) =>
      [
        d.id,
        d.sira,
        d.durum,
        d.zone_id ?? "",
        d.latitude ?? "",
        d.longitude ?? "",
        d.pencere_bas ?? "",
        d.pencere_bit ?? "",
        d.tahmini_sure_dk ?? "",
      ].join(":")
    )
    .join("|");
}

export { UFUK_SN };
