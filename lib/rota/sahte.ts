import { haversineM } from "@/lib/geo";
import { polylineKodla } from "./polyline";
import type {
  Konum,
  RotaBacagi,
  RotaDuragi,
  RotaHesabi,
  RotaOptimizasyonSaglayici,
  SiralamaCevabi,
  SiralamaProblemi,
} from "./tipler";

/**
 * SAHTE SAĞLAYICI — testler ve anahtarsız arayüz denemesi için.
 *
 * Kuş uçuşu × yol katsayısı, sabit hız. Gerçek yol DEĞİL: ekran bu
 * sağlayıcıyla hesaplanmış sonucu "TEST — kuş uçuşu" diye etiketliyor ve
 * üretim dağıtımında (VERCEL_ENV=production) fabrika onu hiç kurmuyor
 * (lib/rota/saglayici.ts). Satış demosunda bu sayıları göstermek "abartı yok"
 * kuralını çiğnerdi.
 *
 * Sıralama: en yakın komşu + 2-opt, maliyet = toplam süre + pencere gecikmesi
 * cezası. Gerçek bir optimizer değil ama deterministik ve pencereye duyarlı —
 * alan katmanının (kapanmış durak, başlangıç/bitiş, pencere gevşetme)
 * davranışını sınamaya yetiyor.
 */
export class SahteSaglayici implements RotaOptimizasyonSaglayici {
  readonly kod = "sahte" as const;
  readonly ad = "Sahte sağlayıcı (kuş uçuşu)";
  readonly haritaSerbest = true;

  private readonly hizKmSa: number;
  private readonly yolKatsayisi: number;

  constructor(hizKmSa = 40, yolKatsayisi = 1.3) {
    this.hizKmSa = hizKmSa;
    this.yolKatsayisi = yolKatsayisi;
  }

  bacak(a: Konum, b: Konum): RotaBacagi {
    const m = haversineM(a.lat, a.lng, b.lat, b.lng) * this.yolKatsayisi;
    return { mesafeM: Math.round(m), sureSn: Math.round(m / (this.hizKmSa / 3.6)) };
  }

  async rotaHesapla(noktalar: Konum[]): Promise<RotaHesabi> {
    const bacaklar: RotaBacagi[] = [];
    for (let i = 0; i + 1 < noktalar.length; i++) bacaklar.push(this.bacak(noktalar[i], noktalar[i + 1]));
    return {
      bacaklar,
      geometri: noktalar.length > 1 ? polylineKodla(noktalar.map((k) => [k.lat, k.lng])) : null,
      yapismaM: noktalar.map(() => 0),
      istekSayisi: 0,
    };
  }

  /** Bir sıranın maliyeti: toplam süre + 10 × pencere gecikmesi. */
  private maliyet(p: SiralamaProblemi, sira: RotaDuragi[]): number {
    let t = p.hareketSn;
    let gec = 0;
    let konum = p.baslangic;
    for (const d of sira) {
      t += this.bacak(konum, d.konum).sureSn;
      const bas = d.pencere?.bas ?? null;
      const bit = d.pencere?.bit ?? null;
      if (bit !== null && t > bit) gec += t - bit;
      if (bas !== null && t < bas) t = bas;
      t += d.servisSn;
      konum = d.konum;
    }
    if (p.bitis) t += this.bacak(konum, p.bitis).sureSn;
    return t - p.hareketSn + 10 * gec;
  }

  async sirala(p: SiralamaProblemi): Promise<SiralamaCevabi> {
    // 1) En yakın komşu.
    const kalan = [...p.duraklar];
    const sira: RotaDuragi[] = [];
    let konum = p.baslangic;
    while (kalan.length > 0) {
      let en = 0;
      let enSure = Infinity;
      kalan.forEach((d, i) => {
        const s = this.bacak(konum, d.konum).sureSn;
        if (s < enSure) {
          enSure = s;
          en = i;
        }
      });
      const [d] = kalan.splice(en, 1);
      sira.push(d);
      konum = d.konum;
    }
    // 2) 2-opt — iyileşme kalmayana kadar (üst sınırlı).
    let enIyi = this.maliyet(p, sira);
    for (let tur = 0; tur < 50; tur++) {
      let iyilesti = false;
      for (let i = 0; i < sira.length - 1; i++) {
        for (let j = i + 1; j < sira.length; j++) {
          const aday = [...sira.slice(0, i), ...sira.slice(i, j + 1).reverse(), ...sira.slice(j + 1)];
          const m = this.maliyet(p, aday);
          if (m + 1e-9 < enIyi) {
            sira.splice(0, sira.length, ...aday);
            enIyi = m;
            iyilesti = true;
          }
        }
      }
      if (!iyilesti) break;
    }
    return { sira: sira.map((d) => d.id), atanamayan: [] };
  }

  maliyetUsd(): number {
    return 0;
  }
}
