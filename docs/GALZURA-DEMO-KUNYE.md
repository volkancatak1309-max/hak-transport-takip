# Galzura Fleet — demo künyesi

> Sayılar **8 Ağustos 2026** itibarıyla. Araçlar çalıştıkça artar; ekrandaki
> güncel değer geçerlidir.

---

## 1. Giriş

- **demo.galzura.com**
- Telefon numarası + 6 haneli PIN
- Giriş bilgisi ayrıca iletilir

---

## 2. Ekranlar

| Sekme | İçerik | Kayıt |
|---|---|---|
| **Yönetici** | Günün panosu: aktif vardiyalar, dikkat kalemleri, filo özeti | canlı |
| **Harita** | Araçların anlık konumu, hız, atanmış şoför | 29 araç |
| **Araçlar** | Araç listesi + araç detayı (km, motor saati, rölanti, rota, arıza kodu) | 29 araç |
| **Alarmlar** | Sürüş olayları ve rölanti epizotları, araç/şoför ekseninde | 1.282 olay · 250 rölanti |
| **Analiz** | Haftalık/aylık toplamlar, araç sıralamaları, güvenlik skoru | 7 gün |
| **Raporlar** | AZG (çalışma süresi), CO₂, yakıt, performans, mesafe — PDF çıktılı | 5 rapor |
| **Bölgeler** | Coğrafi bölge tanımları (depo, yasak/izinli alan) | — |
| **Seferler** | Sefer planlama ve takibi; durum, güzergâh, paket | 120 sefer |
| **Çalışanlar** | Personel listesi ve personel dosyası | 29 şoför |
| **İzinler** | İzin takvimi ve onay akışı | — |

Bölgeler ve İzinler kayıt sayıları ölçülmedi.

---

## 3. Veri durumu

**Kapsam:** 7 günlük geçmiş · 29 araç · **342.557** telemetri kaydı ·
153 vardiya · 120 sefer (109 tamamlandı, 9 iptal, 2 devam ediyor)

**Geçmişi dolu araçlar**

| Plaka | Öne çıkan |
|---|---|
| W-GF-126 | 552 sürüş olayı — filonun %43'ü |
| W-GF-123 | 232 olay |
| W-GF-120 | 125 olay |
| W-GF-119 | 118 olay |
| W-GF-105 | Filodaki en yüksek rölanti kaydı |

**Veri üretmeyen araçlar:** W-GF-104 · W-GF-122 · W-GF-115 · W-GF-112 ·
W-GF-125 — cihaz bağlı, o hafta kullanılmamışlar. Ekranları boş görünür.

**Sürüş olayı dağılımı**

| Tür | Adet | Pay |
|---|---|---|
| Sert hızlanma | 799 | %62 |
| Sert viraj | 241 | %19 |
| Hız aşımı | 184 | %14 |
| Sert fren | 57 | %4 |
| Sinyal karıştırma | 1 | — |
| **Toplam** | **1.282** | |

**Rölanti:** 250 epizot, 17 araçta. Ayrı bir kayıt türü — sürüş olaylarına
dahil değil.

**Hafta sonu:** kayıt yok. Filo çalışmıyor, veri eksikliği değil.

---

## 4. Saat

- Avusturya, Türkiye'den **1 saat geri**
- Şoförler ~**05:00–13:00** (Avusturya saati) çalışıyor
- **TR saatiyle 07:00–14:00** → araçlar yolda, harita hareketli
- Sonrası → araçlar park hâlinde; cihazlar saatte bir konum gönderir, harita
  durgun görünür
- **Analiz ve Raporlar** geçmişe bakar, saatten etkilenmez

---

## 5. Kimlik

- **Telemetri gerçek** — çalışan araçlardan, gerçek cihazlardan gelen kayıtlar
- **Plakalar ve isimler takma**
- Kaynak firma adı paylaşılmıyor
- Demo kurulumunda üretilen PDF'lerde görünür filigran var:
  *GALZURA DEMO — kullanıcı adı — tarih/saat*
- Demo kurulumunda CSV dışa aktarma kapalı, PDF açık

---

## 6. Teknik cevaplar

**Kurulum süresi**
Cihaz araca takıldığı gün veri akmaya başlar. Filo büyüklüğüne göre birkaç gün.

**Şoför telefonu**
Konum araç cihazından gelir; şoförün telefonuna bağlı değildir. Şoför paneli
yalnız mesai başlat/bitir ve sefer takibi için kullanılır.

**Çevrimdışı durum**
Cihaz kaydı kendi belleğinde tutar, bağlantı gelince gönderir. Kayıp olmaz.

**Araç sınırı**
Yok. Demo 29 araçla çalışıyor.

**Veri saklama**
Telemetri ve vardiya kayıtları silinmez. Personel kayıtları Avusturya mevzuatı
gereği 7 yıl saklanır (§ 132 BAO); işten ayrılan personel geçmiş raporlarda
görünmeye devam eder.

**Rapor formatı**
PDF. Dil sabit **Almanca** — arayüz Türkçe olsa da rapor Almanca çıkar. Şirket
anteti ve UID numarası künyede yer alır.

**Konum verisi kapsamı**
Takip araç eksenlidir, kişi değil. Araç park hâlindeyken konum akışı da durur.
