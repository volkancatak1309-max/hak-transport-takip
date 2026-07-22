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
 * NEDEN KAPALI (22.07.2026 kararı, Volkan onaylı):
 * Yürürlükteki formül `100 − ceza/(km/1000)` doğrusal ve tabana çakılıyor —
 * günde ~11 alarm × 12-25 ceza puanı ÷ ~100 km ⇒ ceza/1000km birkaç bin ⇒
 * `max(0, …)` ⇒ HERKES 0. Sıfır bir ölçüm değil, taban çarpmasıydı.
 *
 * Onaylanan yeni formül `100 × K/(K + ceza)` bilinçli olarak HENÜZ YAZILMADI:
 * K'yi bugün seçmek imkânsız, çünkü elimizdeki tek referans ESKİ eşiklerle
 * üretilmiş 10,97 alarm/araç-gün. Alarm eşikleri 22.07'de gevşedi
 * (2.2/2.5/2.9 → 3.3/3.3/4.5 m/s², 90 → 120 km/h); eski gürültüye göre kalibre
 * edilmiş bir K yeni dünyada herkesi 95+ yapar — bu sefer TERS yönde yalan.
 *
 * Ve en önemlisi: bu sayı bir İNSAN hakkında. Yakıt rakamı yanlışsa araç yanlış
 * görünür; skor yanlışsa PERSONEL yanlış görünür. Geçici/uydurma bir K ile
 * açmak yerine kolon kapalı durur, sebebi ekranda yazar.
 *
 * AÇILIŞ ŞARTI: yeni eşiklerle en az 2 haftalık alarm verisi biriksin, K o
 * veriyle kalibre edilsin, formül `100 × K/(K + ceza)` olarak yazılsın —
 * SONRA bu bayrak true'ya çekilsin.
 */
export const SAFETY_SCORE_CALIBRATED = false;

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
