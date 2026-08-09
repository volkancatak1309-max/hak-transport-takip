/**
 * TÜREV METRİK EŞİKLERİ — TEK KAYNAK (22.07.2026 veri bütünlüğü denetimi).
 *
 * NEDEN BU DOSYA VAR
 * ------------------
 * Panelde bölme/oranlama yapan 16 metrik var. Denetimde 10'unun aynı hastalığı
 * taşıdığı çıktı: `payda > 0` kontrolü var ama `payda ≥ ANLAMLI` kontrolü yok.
 * Sonuç canlıda görüldü — 2 litre tüketim 2,5 km'ye bölününce ekranda
 * "80,0 L/100km" yazdı. Bir dizel minibüs ne 80 ne 4 L/100km yakar.
 *
 * Eşikler bugüne kadar koda dağılmıştı (yalnız güvenlik skorunda vardı,
 * lib/analytics.ts içinde). Artık HEPSİ burada: kalibrasyon tartışması hep aynı
 * dosyada geçsin, "acaba başka nerede bir eşik var" sorusu bir daha sorulmasın.
 *
 * KURAL
 * -----
 * Bir metrik eşiğin altındaysa EKRANDA SAYI GÖSTERİLMEZ. Ama boş "—" de
 * bırakılmaz: SEBEBİ yazılır ("mesafe yetersiz (12 km)"). Sebebi yazılmayan
 * boşluk yöneticiye "panel bozuk" dedirtir; sebebi yazılan boşluk ona iş verir.
 *
 * Bu panel ödeme yapan bir müşterinin elinde. Güvenilmez bir sayı göstermek,
 * hiç göstermemekten daha kötüdür.
 */

// ── GÜVENLİK SKORU ──────────────────────────────────────────────────────────

/**
 * Güvenlik skoru KALİBRE EDİLDİ Mİ? — false iken skor HİÇBİR YERDE gösterilmez
 * (Analiz "Şoför Güvenlik Skoru" bölümü + Raporlar › Performans skor kolonu,
 * ortalama skor kartı, en iyi şoför kartı, PDF skor sütunu).
 *
 * ═══ AÇILDI — 27.07.2026 (Volkan kararı, ölçümle) ═══
 *
 * Eski formül `100 − ceza/(km/1000)` doğrusaldı ve tabana çakılıyordu: canlı
 * ölçümde ceza/1000km'nin EN İYİ şoförde bile 194 olduğu görüldü, yani
 * `max(0, 100−194)` ⇒ 18 şoförün 18'i de 0. Sıfır bir ölçüm değil, taban
 * çarpmasıydı — ve bu sayı bir İNSAN hakkında.
 *
 * Yeni formül: `100 × K / (K + ceza)` — hiperbolik, tabana çakılmaz, sıfıra
 * asimptot yaklaşır. Ceza = 1000 km başına düşen ağırlıklı ceza puanı (km'ye
 * bölme korundu: çok süren şoför doğal olarak çok olay üretir).
 *
 * K = 500: yeni eşik döneminin (23.07.2026 21:38 sonrası) canlı MEDYANI
 * 496,1 ölçüldü, yuvarlandı. Anlamı: medyan şoför 50 puan alır; K arttıkça
 * herkes yukarı, azaldıkça aşağı kayar. Ölçülen dağılımda skorlar 6–72
 * aralığına yayılıyor — sıkışma yok.
 *
 * ⚠️ EŞİKLERE DOKUNULMADI (Volkan): alarm eşikleri 22.07'deki hâliyle duruyor.
 * Ölçüm alarm/araç-gün'ü 6,24 buldu (hedef ~3,5 idi, ulaşılmadı) — yani skor
 * MUTLAK bir kalite ölçüsü değil, aynı dönemde şoförleri KIYASLAYAN bir
 * sıralamadır. Ekrandaki (i) balonu bunu açıkça söyler.
 */
// Kalibrasyon MÜŞTERİYE ÖZELDİR (31.07.2026): aşağıdaki K, HAK61 filosunun
// canlı medyanından ve HAK61'in Teltonika eşik parametrelerinden türetildi.
// Başka bir filoda aynı K ile üretilen skor mutlak bir anlam taşımaz; yeni
// kurulumda kapalı başlar ve kendi medyanı ölçülene kadar kapalı kalır.
export { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant";

/**
 * Skor eğrisinin yarılanma sabiti. `ceza = K` olan şoför 50 puan alır.
 * 27.07.2026'da canlı medyandan (496,1) türetildi. Filo davranışı değişirse
 * yeniden ölçülüp güncellenmeli — tek kaynak burası.
 */
export const SAFETY_SCORE_K = 500;

/**
 * Güvenlik skoru için "yeterli sürüş" eşiği — GÜN BAŞINA minimum güvenilir km.
 * Toplam eşik aralığa göre ölçeklenir (scoreMinKmForRange): günlük ~40 km,
 * haftalık ~280 km, aylık ~1200 km. Sabit 150 km günlük görünümde neredeyse
 * herkesi "veri yok" yapardı.
 *
 * (22.07.2026'da lib/analytics.ts'ten BURAYA taşındı — davranış aynı.)
 */
export const SCORE_MIN_KM_PER_DAY = 40;

/**
 * SKOR İÇİN MUTLAK KM TABANI (09.08.2026, Volkan kararı).
 *
 * Çalışılan-gün ölçeklemesi (scoreMinKmForWorkedDays) tek başına PAYDAYI
 * küçültebiliyordu: 3 gün çalışan şoför 120 km'lik çıtayla listeye giriyor ve
 * skoru 159 km'ye bölünüyordu. O paydada TEK sert fren 75 ceza/1000km demek —
 * skor sürüşü değil, ölçümün kısalığını yansıtıyordu.
 *
 * ÖLÇÜLDÜ (HAK61, 30 gün, bayrak açıkken, taban YOKKEN): listeye 4 yerine 10
 * şoför giriyordu ama ORTALAMA SKOR 20'den 15'e düşüyordu — yeni girenlerin
 * çoğu 3-6 puanla dibe yapışıyordu. Ekrem Gyuler 159 km / 3 gün → 5 puan.
 * Yani kapı gevşedikçe skorlar iyileşmiyor, GÜRÜLTÜLENİYORDU.
 *
 * 300 km neden: 1000 km başına ceza hesabında payda 300'ün altına inince tek
 * bir olayın katkısı 1/3'ten büyük oluyor. 300 km, ölçülen filoda ~4-5 günlük
 * normal sürüşe denk ve K=500 kalibrasyonunun anlamlı kaldığı en düşük payda.
 *
 * Eşik = max(SCORE_MIN_KM_FLOOR, SCORE_MIN_KM_PER_DAY × çalışılan gün).
 * Yani gün ölçeklemesi yalnız YUKARI çeker, aşağı çekemez.
 */
export const SCORE_MIN_KM_FLOOR = 300;

/**
 * "En iyi şoför" kartının çıkması için gereken EN AZ skorlanmış şoför sayısı.
 * 1 kişilik bir listede "en iyi" demek sıralama iddiası değil, tek adayı
 * ödüllendirmektir. Kart ayrıca beraberlik varsa ve en yüksek skor 0 ise de
 * gösterilmez (bkz. PerformanceClient).
 */
export const TOP_DRIVER_MIN_SCORED = 2;

// ── YAKIT (L/100km) ─────────────────────────────────────────────────────────

/**
 * L/100km için asgari PAYDA (km, dönem toplamı).
 * 50 km altında tek bir dolum bile oranı iki katına çıkarır. Canlı vaka:
 * DO-818HF 2 L ÷ 2,5 km × 100 = 80,0 L/100km.
 */
export const FUEL_MIN_KM = 50;

/**
 * "En çok yakan" KARTI için asgari mesafe (km, dönem toplamı).
 *
 * FUEL_MIN_KM (50) oranın HESAPLANABİLİR olduğu tabandır; bu ise oranla
 * SIRALAMA yapmanın tabanıdır ve daha yüksek olmalı. Gerekçe: cihaz yakıt
 * seviyesini tam sayı yüzde gönderiyor, ~70 L tankta 1 puan = 0,7 L. 50 km'de
 * tek bir kuantizasyon adımı oranı ±1,4 L/100km oynatır — yani 8,0 ile 9,4
 * arasındaki fark ölçüm gürültüsünün kendisidir ve "filo birincisi" iddiası
 * kura çekmeye döner. 200 km'de aynı adım oranı yalnız ±0,35 L/100km oynatır
 * (%4'ün altı), sıralama anlamlı hâle gelir.
 *
 * 200 km ≈ bir aracın 1-1,5 günlük normal seyri (canlı medyan ~1.900 km/ay);
 * yani haftalık aralıkta filonun büyük kısmı eşiği geçer, yalnız gerçekten az
 * giden araçlar sıralamanın dışında kalır — ki zaten onların oranı sapıktır.
 */
export const THIRSTIEST_MIN_KM = 200;

/**
 * L/100km için asgari PAY (tüketim, yüzde puanı).
 *
 * Cihaz yakıt seviyesini TAM SAYI YÜZDE olarak gönderiyor: ~70 L'lik tankta
 * 1 puan = 0,7 L, yani ölçüm çözünürlüğü 0,7 L. Üstüne migration 026'daki
 * dolum eşiği +10 puan var — 10 puandan küçük yakıt alımları tüketim hesabına
 * hiç girmiyor. 15 puan (~10 L) = gürültü tabanının ~14 katı; altındaki her
 * değer sensörün kendi belirsizliğiyle aynı büyüklükte.
 * Canlı vaka: DO-282HF 4 L ÷ 100 km → 4,0 L/100km (dizel minibüs ~10 yakar).
 */
export const FUEL_MIN_CONSUMED_PCT = 15;

/**
 * PAY ile PAYDANIN aynı zamanı ölçmesi şartı (0–1).
 *
 * En sinsi kök sebep buydu: `km` odometre okumaları DOLU olan ilk/son satırdan,
 * tüketim ise yakıt yüzdesi DOLU olan satırlardan geliyor. Cihaz odometreyi
 * seyrek, yakıtı sık gönderirse "3 günlük yakıt düşüşü ÷ 2,5 km'lik odometre
 * penceresi" olur ve kimse fark etmez.
 *
 * Ölçüm: odometre penceresi, yakıt penceresinin en az %80'ini kapsamalı.
 * Kapsamıyorsa L/100km gösterilmez ("ölçüm pencereleri uyuşmuyor").
 */
export const FUEL_MIN_WINDOW_OVERLAP_RATIO = 0.8;

/**
 * L/100km kolonunun görünmesi için gereken EN AZ aralık uzunluğu (gün).
 *
 * Tam sayı yüzde sensörüyle GÜNLÜK araç bazlı yakıt tüketimi ÖLÇÜLEMEZ — bunu
 * "düzeltiriz" demek yalan olurdu. Bir günde ne 50 km'lik güvenli payda ne 15
 * puanlık pay birikir. 7 gün ve üstünde metrik anlamlı hâle gelir; altında
 * kolon HİÇ ÇIKMAZ (boş kolon da soru işareti doğurur).
 */
export const FUEL_L100_MIN_DAYS = 7;

// ── HIZ (aşırı hız / 100 km) ────────────────────────────────────────────────

/**
 * "Aşırı hız / 100 km" için asgari payda (km). L/100km ile AYNI payda
 * (odometre farkı) kullanıldığı için eşik de bilerek aynı — iki rapor aynı
 * araçta farklı sebeplerle veri göstermesin.
 */
export const SPEED_MIN_KM = FUEL_MIN_KM;

// ── KAPSAM DIŞI (bilinçli) ──────────────────────────────────────────────────
//
// CO₂ g/km ve yakıt-fişi zinciri L/100km (app/actions/fuel.ts) de aynı payda
// hastalığını taşıyor, AMA HAK61 araçları araç tanıma sistemine bağlı olduğu
// için fiş modülü bu müşteride kullanılmıyor (20.07.2026 kararı). Ölü bir yolda
// eşik kurmak yerine bu dosyaya not düşüldü; modül başka bir firmada
// açıldığında eşikleri buraya eklenir.
