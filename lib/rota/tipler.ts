/**
 * ROTA OPTİMİZASYONU — sağlayıcıdan bağımsız tipler (Faz 1, tek araç).
 *
 * ═══ NEDEN AYRI DOSYA ═══
 *
 * Bu dosya SAF: ne `server-only` ne veritabanı ne ağ. İstemci bileşeni
 * (öneri ekranı) yalnız buradan `import type` yapar; sağlayıcı kodu
 * (`lib/rota/vroom.ts`, `lib/rota/google.ts`) ve anahtarlar istemci paketine
 * hiçbir yoldan giremez. `scripts/check-rota.mjs` bunu denetliyor.
 *
 * ═══ ZAMAN BİRİMİ: GÜN BAŞINDAN SANİYE ═══
 *
 * Sağlayıcıya giden her zaman, seferin günündeki KİRACI DUVAR SAATİDİR
 * (gece yarısından saniye: 09:30 → 34200). VROOM tam olarak bu biçimi
 * bekliyor; mutlak zamana ihtiyaç duyan (Google, ekran) `anMs` ile çevirir —
 * o çevirici yaz saati geçişini bilir (lib/format.ts `tenantDuvarSaatiUtc`).
 * Mutlak damgayı sağlayıcıya taşımak, gün sınırı sorusunu her sağlayıcıda
 * yeniden doğururdu.
 */

/** Coğrafi nokta — açık alan adları; [lon, lat] sırası yalnız sağlayıcının içinde. */
export type Konum = { lat: number; lng: number };

export type SaglayiciKodu = "vroom" | "google" | "sahte";

/** Sıralanacak bir durak — sağlayıcının gördüğü TEK biçim. */
export type RotaDuragi = {
  /** `sefer_duraklari.id` — sağlayıcı yalnız geri döndürür, yorumlamaz. */
  id: string;
  konum: Konum;
  /** Durakta geçen süre (sn). Boşsa kiracı varsayılanı (TAKIP_VARSAYILAN_SERVIS_DK). */
  servisSn: number;
  /**
   * Zaman penceresi — gün başından saniye. Uçlardan biri boş olabilir
   * ("12:00'dan önce" da "14:00'ten sonra" da gerçek kısıt; 082 kararı).
   */
  pencere: { bas: number | null; bit: number | null } | null;
};

/** Tek araçlık sıralama problemi. */
export type SiralamaProblemi = {
  /** Duvar saati (gece yarısından sn) → UTC epoch ms; yaz saatini bilir. */
  anMs: (sn: number) => number;
  /** Aracın çıktığı yer — her zaman verilir (sıradaki durak ya da seçilen bölge). */
  baslangic: Konum;
  /** Aracın döneceği yer; `null` = rota son durakta biter. */
  bitis: Konum | null;
  /** Hareket anı (gün başından sn). */
  hareketSn: number;
  /** Sırası değişebilecek duraklar (başlangıç durağı HARİÇ). */
  duraklar: RotaDuragi[];
};

export type SiralamaCevabi = {
  /** Önerilen sıra — girdi kimliklerinin alt kümesi. */
  sira: string[];
  /** Sağlayıcının yerleştiremediği duraklar (tipik sebep: pencereye yetişilemez). */
  atanamayan: string[];
};

export type RotaBacagi = { mesafeM: number; sureSn: number };

/** Sabit sıralı bir noktalar dizisinin yol hesabı. */
export type RotaHesabi = {
  /** `noktalar.length - 1` bacak. */
  bacaklar: RotaBacagi[];
  /** Kodlanmış çoklu çizgi (Google polyline, 5 hane) — yoksa null. */
  geometri: string | null;
  /**
   * Her girdi noktasının yola "yapışma" mesafesi (m). OSRM verir; Google
   * vermez (null). Harita kapsamı dışındaki noktayı yakalamanın tek yolu bu:
   * OSRM kapsam dışındaki bir noktayı HATA VERMEDEN en yakın yola oturtur
   * (03.10.2026 ölçümü: Lindau 3,4 km, Vaduz 8,6 km öteye oturdu).
   */
  yapismaM: (number | null)[] | null;
  /** Bu hesap için atılan HTTP isteği (maliyet tahmini için; sahtede 0). */
  istekSayisi: number;
};

/**
 * SAĞLAYICI SÖZLEŞMESİ — servis bağımsızlığın tek noktası.
 *
 * İki iş, iki metot:
 *   · `sirala`      → sıra (optimizasyon)
 *   · `rotaHesapla` → sabit sıranın km/süre/geometrisi (önce ve sonra İÇİN AYNI motor)
 *
 * Önce/sonra karşılaştırması iki tarafı da `rotaHesapla` ile ölçer: farklı iki
 * motorun sayısını yan yana koymak, kazancı motor farkıyla karıştırırdı.
 */
export interface RotaOptimizasyonSaglayici {
  readonly kod: SaglayiciKodu;
  /** Ekranda görünen ad ("VROOM + OSRM", "Google Maps Platform"). */
  readonly ad: string;
  /**
   * Sonuç Google DIŞI bir haritada çizilebilir mi (lisans sorusu).
   * OSM türevi (VROOM/OSRM) ve sahte → evet. Google → yalnız EEA koşullarında
   * (Service Specific Terms §18.2 / EEA ToS) — bkz. lib/rota/saglayici.ts.
   */
  readonly haritaSerbest: boolean;
  sirala(p: SiralamaProblemi): Promise<SiralamaCevabi>;
  rotaHesapla(noktalar: Konum[]): Promise<RotaHesabi>;
  /** Bu çağrının tahmini DIŞ maliyeti (USD) — kendi sunucumuzda 0. */
  maliyetUsd(c: { siralananDurak: number; rotaIstegi: number }): number;
}

/** Sağlayıcı arızasının türü — ürünün cevabını belirler. */
export type SaglayiciHataTuru =
  /** Ağ, zaman aşımı, 5xx — servise ulaşılamadı (yedek denenebilir). */
  | "erisilemedi"
  /** 401/403 — anahtar/sır yanlış. Yeniden denemek işe yaramaz. */
  | "yetkisiz"
  /** 4xx ya da motorun "girdi geçersiz" cevabı. */
  | "reddedildi"
  /** 200 döndü ama gövde beklenen biçimde değil. */
  | "gecersiz_cevap";

export class SaglayiciHatasi extends Error {
  readonly tur: SaglayiciHataTuru;
  constructor(tur: SaglayiciHataTuru, mesaj: string) {
    super(mesaj);
    this.name = "SaglayiciHatasi";
    this.tur = tur;
  }
}

// ── EKRANA GİDEN BİÇİM ────────────────────────────────────────────────────

/** Ekranın ayarı — istemciden gelir, sunucuda doğrulanır. */
export type RotaAyari = {
  /** "sonraki" = sıradaki bekleyen durak sabit; aksi hâlde başlangıç bölgesinin id'si. */
  baslangic: string;
  bitis: "acik" | "donus";
  /** Hareket saati "HH:MM" (kiracı saat dilimi, seferin günü). */
  hareket: string;
};

/** Plan içindeki bir durak — önce ya da sonra. */
export type PlanDuragi = {
  id: string;
  ad: string;
  /** Şimdiki sıradaki numarası (sefer_duraklari.sira). */
  eskiSira: number;
  /** Varış (UTC epoch ms). */
  varisMs: number;
  /** Bekleme (pencere açılmadan varıldıysa), sn. */
  beklemeSn: number;
  /** Pencere kapandıktan sonra varış, sn (0 = zamanında). */
  gecikmeSn: number;
  servisSn: number;
  /** "HH:MM" — ekranda gösterilir. */
  pencere: { bas: string | null; bit: string | null } | null;
  /** Başlangıç durağı (sıradaki durak sabit seçildiyse) — sırası değişmez. */
  baslangicDuragi: boolean;
  konum: Konum;
};

export type PlanOzeti = {
  mesafeM: number;
  surusSn: number;
  servisSn: number;
  beklemeSn: number;
  /** Hareketten (bitiş noktasına ya da son durağın çıkışına) toplam süre. */
  toplamSn: number;
  gecikenDurak: number;
  bitisMs: number;
};

export type RotaPlani = {
  duraklar: PlanDuragi[];
  ozet: PlanOzeti;
  geometri: string | null;
};

export type RotaHaritaVerisi = {
  once: string | null;
  sonra: string | null;
  baslangic: Konum;
  bitis: Konum | null;
  /** Önerilen sıradaki duraklar (1..N). */
  noktalar: { id: string; ad: string; konum: Konum; yeniSira: number }[];
};

export type RotaOnerisi = {
  saglayici: { kod: SaglayiciKodu; ad: string; yedekKullanildi: boolean };
  ayar: { baslangicAd: string; bitis: "acik" | "donus"; hareketMs: number };
  once: RotaPlani;
  sonra: RotaPlani;
  /** once − sonra: pozitif = kazanç. */
  fark: { mesafeM: number; toplamSn: number; gecikenDurak: number };
  /** Önerilen sıra şimdikinden farklı mı. */
  degisti: boolean;
  /** TAM kimlik listesi (kapanmış duraklar başta) — "Uygula" bunu yazar. */
  yeniSira: string[];
  /** Hesap anındaki durak kümesinin izi — arada değişiklik olduysa "Uygula" reddedilir. */
  parmakIzi: string;
  /** Kapanmış (varıldı/tamamlandı/atlandı) ve yerinde kalan durak sayısı. */
  sabitDurak: number;
  /** Harita çizilebilirse veri; lisans izin vermiyorsa null (sunucu karar verir). */
  harita: RotaHaritaVerisi | null;
  sureMs: number;
};

export type RotaHataKodu =
  | "modul_kapali"
  | "servis_yok"
  | "kapsam_disi"
  | "sefer_kapali"
  | "tablo_yok"
  | "az_durak"
  | "cok_durak"
  | "konumsuz"
  | "harita_disi"
  | "kota_doldu"
  | "kota_okunamadi"
  | "servis_hatasi"
  | "degisti"
  | "gecersiz"
  | "hata";

export type RotaOneriSonuc =
  | { ok: true; oneri: RotaOnerisi }
  | { ok: false; hata: RotaHataKodu; duraklar?: string[]; limit?: number };

export type RotaUygulaSonuc = { ok: true } | { ok: false; hata: RotaHataKodu };

/** Ekranın bilmesi gereken yetenek — SUNUCUDA hesaplanır, sır taşımaz. */
export type RotaYetenegi = {
  /** Sağlayıcı yapılandırılmış mı; değilse ekran "Rota servisi tanımlı değil" der. */
  servisHazir: boolean;
  saglayiciAdi: string | null;
  /** Sahte (test) sağlayıcı — ekran bunu açıkça etiketler. */
  test: boolean;
  gunlukTavan: number;
  azamiDurak: number;
  /** Süresi boş durakta sayılan dakika (TAKIP_VARSAYILAN_SERVIS_DK). */
  varsayilanServisDk: number;
};
