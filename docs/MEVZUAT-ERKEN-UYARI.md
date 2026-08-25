# Mevzuat erken uyarı — canlı katman

**Migration 086 · `/admin/mevzuat` · `/api/cron/mevzuat-tarama`**

AZG raporu (geçmişe dönük) yerinde duruyor. Bu modül onun **üstüne** canlı bir
katman ekliyor: ihlal **olmadan önce** uyarı.

> Bu belge ölçümlerin kaydıdır. Sayılar 25.08.2026'da HAK61 canlı verisinde
> ölçüldü; eşik değiştirmeden önce yeniden ölçün.

---

## 0 · 🔴 BU MODÜL UYUM GARANTİSİ DEĞİL

Filoda **takograf yok**. Takograf, sürüş süresini kartla ve mühürlü cihazla
kaydeden, denetimde **kanıt** sayılan bir alettir; bizim ölçtüğümüz o değil.

Ölçebildiğimiz iki ayrı büyüklük var ve **aynı değiller**:

| | Ne | Durum |
|---|---|---|
| **Çalışma süresi** (Arbeitszeit) | vardiya başlangıcı → bitiş, eksi kayıtlı mola | **ÖLÇÜLÜR** — AZG ve ArbZG tam olarak bunu düzenler |
| **Sürüş süresi** (Lenkzeit) | telemetride hareket görülen süre | **TAHMİN** — AB 561/2006 bunu düzenler ama takograf olmadan üretilen sayı kanıt değildir |

Ayrım `olcum_temeli` kolonuyla her kayıtta, `TAHMİN` rozetiyle her satırda ve
sayfanın en üstündeki kaldırılamaz uyarıda taşınır. Bildirim metninde de
"(tahmini)" kelimesi vardır ve çıkarılamaz.

### Sürüş tahmininin gerçek hata payı (ÖLÇÜLDÜ, 7 gün, 12 vardiya)

| | Değer |
|---|---|
| sürüş / vardiya oranı | medyan **%46,5** (min %0 · max %61) |
| **telemetri boşluğu** | medyan vardiya süresinin **%32,2**'si |
| hiç telemetrisi olmayan | **3/12** vardiya → sürüş süresi ölçülemez |

Ortalama bir vardiyanın **üçte biri** ne sürüş ne durak olarak sınıflanabiliyor:
cihaz susuyor. Bu banda "0 sürüş" demek de "sürüş" demek de uydurmadır;
`surus_belirsiz_dk` kolonu bandı sayı olarak taşır ve ekranda `±N dk belirsiz`
diye görünür.

---

## 1 · Mevcut AZG motoru canlı hesaba nasıl uyarlandı

`lib/azg-rules.ts` bugün **geçmişe dönük** çalışıyor: bir dönem verilir,
şoför-gün kovaları toplanır, tavanı aşan günler sayılır. Canlı hesap için
eksik olan üç şeydi:

1. **Kalan süre kavramı yok.** Rapor "aşıldı mı" der; canlı katman "ne kadar
   kaldı" demeli. `kuralDurumu()` bunu ekliyor: `kalan = eşik − ölçülen`.
2. **Kademe yok.** Rapor ikili (ihlal/temiz); uyarı için dörtlü bir merdiven
   gerekiyor.
3. **Mola yükümlülüğünün karşılanıp karşılanmadığı ayrı bir soru.** Rapor
   toplam süreye bakar; canlı katman "molasını verdi mi, vermediyse ne kadar
   kaldı" diye sorar.

**Eşikler KOPYALANMADI, İTHAL EDİLDİ.** `AZG_DAILY_MAX_MS` ve
`AZG_NIGHT_DAILY_MAX_MS` doğrudan `lib/azg-rules.ts`ten alınıyor. İki dosyada
iki farklı 12 saat olsaydı rapor ile canlı katman ayrışırdı ve ayrışma sessiz
olurdu — 14.08'de satır/gün ekseni ayrışmasının yaptığı gibi.

---

## 2 · AB 561/2006 — resmî kaynaktan

| Madde | Kural |
|---|---|
| Art. 2 | **Kapsam:** yük >3,5 t · yolcu >9 kişi |
| Art. 6(1) | Günlük sürüş **9 sa**; haftada **2 kez 10 sa** |
| Art. 6(2)(3) | Haftalık **56 sa** · iki haftada **90 sa** |
| Art. 7 | **4,5 sa** sürüşten sonra **45 dk** mola; **15 + 30** olarak bölünebilir |
| Art. 8 | Günlük dinlenme **11 sa**, haftada en çok **3 kez 9 sa**; haftalık **45 sa**, iki haftada bir **24 sa** |

Kaynaklar: [Avrupa Komisyonu — Driving time and rest periods](https://transport.ec.europa.eu/transport-modes/road/social-provisions/driving-time-and-rest-periods_en) ·
[EUR-Lex özeti](https://eur-lex.europa.eu/EN/legal-content/summary/driving-time-and-rest-periods-in-the-road-transport-sector.html) ·
[EUR-Lex — takograf kapsamı](https://eur-lex.europa.eu/EN/legal-content/summary/tachographs-in-road-transport.html)

⚠️ **01.07.2026'dan beri** >2,5 t araçlar da **uluslararası taşıma ve
kabotajda** kapsamda (2020/1054) ve ikinci nesil akıllı takograf zorunlu.
**Yurt içi taşıma kapsam dışı** — orada ulusal mevzuat geçerli.

**HAK61 için ölçüldü** (Volkan teyidi 22.07.2026, `lib/azg-rules.ts` başlığı):
araçların hepsi **2,5 t altında** ve **sınır geçmiyor** → 561/2006 **uygulanmaz**.
Varsayılan kural seti bu yüzden `AT_AZG`; `EU_561` kiracı açıkça seçmedikçe
kapalı.

---

## 3 · Almanya ArbZG ↔ Avusturya AZG farkları

| | Avusturya AZG | Almanya ArbZG |
|---|---|---|
| Günlük tavan | **12 sa** (§ 9 Abs. 1) | **8 sa**; 24 hafta / 6 ay ortalaması korunursa **10 sa** (§ 3) |
| Gece | 10 sa (§ 14 Abs. 2) | ayrı günlük tavan yok |
| Mola | >6 sa → 30 dk · >9 sa → 45 dk (§ 13c Abs. 1) | >6–9 sa → 30 dk · >9 sa → 45 dk (§ 4) |
| Dinlenme | 11 sa (§ 12 Abs. 1) | 11 sa; **taşıma işletmelerinde 1 saat kısaltılabilir**, bir ay/4 hafta içinde 12 saate uzatılarak telafi (§ 5 Abs. 1–2) |

Kaynak: [§ 3 ArbZG](https://www.gesetze-im-internet.de/arbzg/__3.html) ·
[§ 5 ArbZG](https://www.gesetze-im-internet.de/arbzg/__5.html)

**En keskin fark günlük tavan: 12 ↔ 10 saat.** Aynı vardiya Almanya'da ihlal,
Avusturya'da temiz olabilir.

⚠️ **8 saatlik normal eşik uyarı olarak kullanılmıyor.** § 3'ün 8 saati
**ortalama** üzerinden yükümlülük doğurur; tek bir günün 8'i aşması tek başına
ihlal değildir. Tek güne bakan bir motorun ihlal diyebileceği tek sayı 10
saattir. Ortalama denetimi geçmişe dönük raporun işidir.

### Ülke bazlı mı, kiracı ayarı mı → **kiracı ayarı**

`tenant_mevzuat` tablosu, `076`daki gerekçenin aynısı: env değiştirmek deploy
ister, kiracı kendi hukukunu bize e-posta atarak değiştiremez. Ayrıca merkezi
Avusturya'da olup Almanya'da çalıştıran bir filo ülke kodundan türetilemez.

---

## 4 · Elimizdeki veri — ne ölçüyoruz, ne tahmin ediyoruz

| Veri | Durum |
|---|---|
| Vardiya başlangıcı/bitişi | **ölçülür** (`time_entries`) |
| Kayıtlı mola | **kısmen** — 30 günde 6 saati aşan **391** vardiyanın yalnız **150**'sinde mola kaydı var |
| Sefer penceresi | var ama sefer modülü canlıda henüz boş |
| Telemetri hareketi | var, **%32,2 boşluk bandıyla** |
| Takograf | **YOK** |

### Mola kaydı yokluğu "mola yok" demek değildir

241 vardiyayı "mola vermedi" saymak 241 sahte ihlal üretirdi. `molaKarsilandi`
bu yüzden **üç durumlu**: `true` verildi · `false` yetersiz · `null` **kayıt yok**.

⚠️ **Ama önleyici yönde bu güvenli taraftır:** mola kaydı yoksa çalışma süresi
olduğundan büyük hesaplanır ve uyarı **erken** gider. Kârlılıkta (085) eksik
ölçüm tehlikeliydi çünkü kârı şişiriyordu; burada eksik ölçüm erken uyarı
üretiyor. Yön farkı bilinçlidir ve satırda "mola kaydı yok" rozetiyle yazar.

---

## 5 · Uyarı ne zaman gitmeli

Kademeler: **60 / 30 / 15 dk** kala, sonra **ihlal**.

En dar kademe olan **15 dakika uydurma değil**: akıllı takografın kendi
standardı — sürücüyü 4,5 saatlik kesintisiz sürüşe **15 dakika kala** uyarır
(165/2014 düzeni, [DVSA/RSA takograf sembol kılavuzu](https://fleetgo.com/wp-content/uploads/2023/07/RSA-tachograph-symbols.pdf)).
Ürün o eşiği taban alıp **üstüne iki erken kademe** koyuyor, çünkü bizim
uyarımız cihazda değil telefonda ve şoförün park yeri bulması zaman ister.

Kademeler kiracı ayarında değiştirilebilir; **daralarak gitmek zorundadır**
(şema CHECK'i ve sunucu kapısı ikisi de zorlar).

### Spam yok — şema düzeyinde

`mevzuat_uyari_tekil` indeksi `(worker_id, gun, kural, kademe)` tekil. Tarama
15 dakikada bir koşsa da aynı kademe ikinci kez **yazılamaz** ve gönderim
yapılmaz. Kod tarafında kontrol de var ama tek başına yeterli değildi: iki tur
çakışırsa (cron gecikmesi) ikisi de gönderirdi.

**Kademe ilerleyince yeni uyarı gider** — bu susturma değil, kademe başına
tekilliktir. `erken` duyan şoför, `ihlal` sınırına gelince tekrar duyar.

**Molasını vermiş şoföre kademe üretilmez.** Yükümlülük karşılanmışsa "molaya
gir" demek gürültüdür.

---

## 6 · 🔴 Kapanmamış kayıt — canlı koşumda yakalandı

**HAK61'de 9 açık vardiyanın 8'i 12 saatten, 7'si 36 SAATTEN uzundu.**

Bunlar 37 saattir çalışan insanlar değil, **kapanmamış kayıtlar** — otomatik
kapanış 22.07.2026'da bilerek kaldırıldı ve vardiyayı yalnız personel
kapatıyor, bazen günler sonra. Bu satırlara "ihlal" demek 8 şoföre anında
**24 sahte bildirim** gönderirdi ve özelliğin güvenilirliğini ilk gün
bitirirdi — 22.07'de panelin 20 şoförü kırmızı göstermesiyle aynı hata sınıfı.

**Eşik 24 saat.** Gerekçe:

- Hiçbir kural seti 24 saatlik bir çalışma gününe izin vermiyor (AT 12 sa ·
  DE 10 sa · AB sürüş 9–10 sa + zorunlu dinlenme).
- **ÖLÇÜLDÜ:** canlı açık vardiya yaşları `11,9 · 14,7` sonra **36,9'a atlıyor**.
  24 saat bu boşluğun ortasından geçiyor: 14,7 saatlik gerçek (ve AT'de ihlal
  olan) vardiya değerlendirilmeye devam ediyor, 37 saatlik kayıtlar eleniyor.
- **ÖLÇÜLDÜ:** 90 günde kapanmış 583 vardiyanın **%8,2'si** 24 saati aşıyor
  (medyan 9,1 · p90 16,9 · max 133,1 sa).

Bu satırlar **gizlenmiyor**: "kapanmamış kayıt" rozetiyle ve ayrı bir sayaçla
görünüyorlar, ve asıl yapılacak iş söyleniyor — vardiyayı kapat.

### Düzeltmeden önce / sonra (canlı, aynı veri)

```
ÖNCE : 9 şoför · 8'i [ihlal] · 24 uyarı adayı
SONRA: 9 şoför · 7'si "kapanmamış kayıt" (uyarı yok)
       Sercan Kalkanli  887/720 dk · −167 dk → ihlal        (gerçek)
       Ümit Alıcı       644/720 dk · +76 dk  → risk yok     (molası verilmiş)
```

---

## 7 · Prova (QA harness)

```bash
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < db/migrations/086_mevzuat_uyari.sql
docker exec -i hak-qa psql -U postgres -d hak -c \
  "grant all on all tables in schema public to service_role, anon, authenticated;"
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < <tohum>.sql

set -a; . <qa env>; set +a
npm run verify:mevzuat      # 57 iddia
```

⚠️ QA yığınında yeni tabloya **`grant` şart**; `service_role` rolüne
**`bypassrls`** verilmeli.

### Bu provanın yakaladığı gerçek kusurlar

1. **🔴 Kapanmamış kayıtlar ihlal sayılıyordu** (yukarıda) — canlı kuru
   koşumda görüldü, 24 saat eşiğiyle düzeltildi.
2. **"AZG raporu bozulmadı" iddiası BOŞ geçiyordu** — QA tohumunda hiç
   kapanmış vardiya yoktu, rapor "0 şoför · 0 gün" ile geçti. Paydaların dolu
   olduğu artık ÖNCE sınanıyor (8 vardiya · 1 ihlal).
3. **Yönetici jetonu tur içinde tükeniyor** — ilk uyarı gidince Expo
   "DeviceNotRegistered" dedi, jeton silindi, aynı turdaki ikinci uyarı 0
   yönetici cihazı buldu. İddia tek satıra değil turun tamamına bakacak
   şekilde düzeltildi; davranışın kendisi doğru.

---

## 8 · Cron ve kapılar

| | |
|---|---|
| Uç | `/api/cron/mevzuat-tarama` |
| Sıklık | **15 dakika** — en dar kademe 15 dk, daha seyrek koşarsa o kademe hiç yakalanmaz |
| Sır | `CRON_SECRET` |
| Kuru koşum | `?kuru=1` — yazmaz, bildirmez |
| 086 yoksa | **503** · zamanlayıcı kaydı kurulmamalı |

| İşlem | Kapı |
|---|---|
| Ekranı görmek | `requireFleetView` (yönetici + filo şefi) |
| Kural setini değiştirmek | `requireAdmin` — filonun tabi olduğu **hukuku** değiştirir |

Şoförün uyarısı `high` öncelikle gider (yolda, karar vermesi gerekiyor);
yöneticininki `normal` (durum bilgisi, Doze modunda bekleyebilir).
