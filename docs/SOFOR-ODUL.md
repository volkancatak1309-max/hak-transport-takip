# Şoför ödül ve liderlik

**Migration 088 · `/admin/odul` · `/api/mobile/odul` · `/api/cron/skor-donem`**

Güvenlik skoru motoru zaten vardı. Eksik olan: şoförün **kendi durumunu
görmesi**, sıralama, rozet ve **dönem geçmişi**.

> Bu belge ölçümlerin kaydıdır. Sayılar 25.08.2026'da HAK61 canlı verisinde
> ölçüldü; eşik değiştirmeden önce yeniden ölçün.

---

## 1 · Skor motoru bugün ne veriyor (ÖLÇÜLDÜ)

Eksenler ve ağırlıklar: `overspeeding 25 · jamming 25 · harsh_braking 12 ·
harsh_cornering 12 · idling 5 · harsh_acceleration 3`. Ceza km ile normalize
ediliyor (K = 500). Skor **0–100 ya da `null`**.

**Son 30 gün, HAK61:**

| | |
|---|---|
| Kadro | 28 |
| **Skorlanan** | **17** |
| Skorsuz | 11 (`kapsama_dusuk` 8 · `km_yetersiz` 3) |
| Ortalama | 47,0 · en yüksek 92 (Resul Demir) · en düşük 14 |
| 80+ | 2 · 60–79: 3 · <60: 12 |

---

## 2 · 🔴 Haftalık rozet yapısal olarak kazanılamaz

Görev "4 hafta üst üste 80+ skor" rozetini istedi. Haftalık pencereler canlıda
ölçüldü:

| Pencere | Kadro | **Skorlanan** | 80+ olan |
|---|---|---|---|
| hafta −0 | 22 | **4** | 0 |
| hafta −1 | 20 | **3** | 0 |
| hafta −2 | 22 | **3** | 0 |
| hafta −3 | 23 | **3** | 0 |

7 günlük pencerede şoförlerin **%14–18'i** km kapsama kapısını geçebiliyor ve
son dört haftada **hiç kimse** haftalık 80+ almadı. Kimsenin kazanamayacağı bir
rozet motivasyon değil alay üretir.

30 günlük pencerede aynı ölçüm: **17/28 skorlanıyor**, 2 kişi 80+.

**KARAR: rozetler AYLIK (30 gün) pencerede.** `DONEM_GUN = 30`.

---

## 3 · 🔴 Kalibrasyon sınırı: sorun ağırlıkta değil, cihazda

Görev "eşik 40→20, ağırlık 12→3 değişti, rozet farklı kalibrasyonlu haftaları
karşılaştırmamalı" dedi. Ölçüm bunu **ikiye** ayırıyor:

**Ağırlık/eşik değişimi (kodda, 13.08.2026) → SORUN DEĞİL.**
Skor geçmişi hiçbir yerde saklanmıyordu — aranan tabloların hepsi yok:
`surucu_skorlari` · `driver_scores` · `skor_gecmisi` → **TABLO YOK**. Her skor
istek anında **bugünkü** ağırlıklarla hesaplanıyor; geçmiş bir ayı bugün
hesaplarsanız bugünkü cetvelle ölçülür. Kod tarafı kendi içinde tutarlı.

**Cihaz eşiği değişimi (Teltonika setparam, 22–23.07.2026) → SORUN.**
Hızlanma 2.2→3.3, fren 2.5→3.3, aşırı hız 120→131 km/s. **Ham olay sayısı**
değişti; bu yeniden hesapla düzelmez, çünkü olayın kendisi farklı bir cetvelle
üretilmiş.

Repo bu sınırı zaten tutuyordu: `device_config_epochs` + `lib/config-epoch.ts`.
**Canlı: en son epok 2026-07-23.**

**Çözüm:** her dönem snapshot'ı hesaplandığı epok damgasını taşır (`epok_at`) ve
`epok_oncesi` bayrağı ile işaretlenir. `kiyaslanabilir()` yalnız **aynı epoktan
sonra başlayan** dönemleri karşılaştırır.

Bugün HAK61'de temiz dönem sayısı **1** — "3 dönem üst üste" rozeti henüz
kazanılamaz ve **ekran bunu söyler**, sessizce boş bırakmaz.

---

## 4 · Skorsuz şoför: sıfır değil, sebep

Motor zaten `scoreGate` üretiyor:

| Kapı | Anlamı |
|---|---|
| `km_yetersiz` | km ölçüldü ama eşiğin altında |
| `kapsama_dusuk` | vardiyaların ölçülebilen oranı `SCORE_MIN_KM_COVERAGE` altında |
| `vardiya_yok` | aralıkta hiç vardiya yok |

Liderlik tablosu skorsuz şoförü **sıralamaya sokmaz** (`sira: null`), **0 puan
vermez** ve sebebi sayıyla yazar: *"60 km ölçüldü · eşik 300 km"*.

---

## 5 · Sektör ne yapıyor

| Ürün | Ne sunuyor |
|---|---|
| [Motive **Driver Rewards**](https://gomotive.com/motive-introduces-new-workforce-capabilities-to-improve-performance-automate-rewards-and-increase-driver-retention-at-scale/) (27.05.2026, Vision 26) | Kural + puan sistemi, gerçek zamanlı rozet ve **liderlik tablosu**, hediye kartı/para dönüşümü |
| [Samsara **Positive Recognition**](https://www.samsara.com/blog/positive-recognition-for-safe-compliant-fuel-efficient-driving) | İyi davranış **serilerini** (streak) ve kilometre taşlarını otomatik yakalayıp şoför uygulamasında gösteriyor; skorunu iyileştirenleri öne çıkarıyor |

Ortak mekanik: **seri + kilometre taşı + rozet + sıralama.** Bizim beş
rozetimiz bu şablonun karşılığı.

**Ödül/para dönüşümü BU TURDA YOK** — muhasebe ve bordro bağı ayrı bir iştir.

> Motive'nin devir maliyeti rakamı (yıllık %90'a varan devir, şoför başına
> ~13.000 $) **şirket kaynağıdır ve bağımsız doğrulanmamıştır**; bu belgede
> gerekçe olarak değil bağlam olarak duruyor.

---

## 6 · 🔴 İsim görünürlüğü — varsayılan KAPALI

Almanya'da **§ 87 Abs. 1 Nr. 6 BetrVG**: çalışanın davranışını veya
performansını izlemeye **elverişli** teknik düzenek, işletme kurulunun ortak
kararına tabidir. İçtihat ölçütü işverenin niyeti değil, düzeneğin **nesnel
elverişliliği**. İsimli bir liderlik tablosu tam olarak budur.
([§ 87 BetrVG](https://www.gesetze-im-internet.de/betrvg/__87.html))

Avusturya tarafında DSG aynı yöne bakar.

**Bu yüzden `isim_gorunur` varsayılanı `false`:**

| Ayar | Şoför ne görür |
|---|---|
| **Kapalı (varsayılan)** | Kendi adı + kendi sırası; diğerleri **"#3"** |
| Açık | Herkesin adı |

⚠️ Gizleme **gövdede** yapılır, ekranda değil: isim kapalıyken başka şoförün
`workerId`'si mobil yanıta **hiç girmez**. Takma etiket **sıra numarasıdır**,
kimliğe bağlı sabit bir takma ad değil — sabit olsaydı iki dönem
karşılaştırılarak kim olduğu çözülebilirdi.

**Yönetici ekranında isimler her zaman açık:** ayar çalışanlar arası
kıyaslamayı düzenler; yönetici zaten `/admin/raporlar`da her şoförün
performansını isimle görüyor.

---

## 7 · Rozetler

| Rozet | Kural |
|---|---|
| `ay_iyi` | Dönem skoru ≥ 80 |
| `ay_ilk3` | Dönemin ilk 3'ünde |
| `sifir_olay` | Skorlanabildi **ve** hiç olay yok |
| `yukselen` | Önceki **kıyaslanabilir** döneme göre ≥ 3 puan artış |
| `seri_iyi` | **3 dönem üst üste** ≥ 80, hepsi aynı epoktan sonra |

- Rozet **silinmez**: kazanıldığı dönemin gerçeğidir.
- Aynı rozet aynı dönem için iki kez verilemez (`(worker_id, rozet, donem_bas)`
  tekil) — ikinci tur 23505 alır.
- Her rozet **kanıt** taşır: hangi sayıdan çıktı (`{skor, esik, km}`).

---

## 8 · Prova (QA harness)

```bash
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < db/migrations/088_sofor_odul.sql
docker exec -i hak-qa psql -U postgres -d hak -c \
  "grant all on all tables in schema public to service_role, anon, authenticated;"
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < <tohum>.sql

set -a; . <qa env>; set +a
npm run verify:sofor-odul      # 46 iddia
```

### Bu provanın yakaladığı kusurlar

1. **Olaylar hiçbir şoföre atfedilmiyordu.** Tohumdaki olaylar `now()`un
   saatine (19:45) yazılmıştı, vardiya penceresi ise 06:00–15:00. Skor, olay
   atfını **vardiya penceresinden** yapıyor (052 ekseni) → beş şoför de 100
   puan aldı. Tohum kusuru, ürün kusuru değil — ama fark edilmeseydi rozet
   iddiaları anlamsız veriyle geçerdi.
2. **`readTokenVersion` sayı değil `{status, value}` döner.** QA yardımcısı
   nesneyi doğrudan jeton üretimine verdi; mühür bozuldu ve mobil uç 401
   döndü. Yine test kusuru.
3. **"Skorsuz şoför" iddiası BOŞ geçiyordu** — tohumda hiç skorsuz şoför yoktu
   ve `every` boş dizide `true` döndü. Gerçek bir skorsuz şoför eklendi
   (30 günde 60 km) ve varlığı artık **önce** sınanıyor.
4. **Seri rozeti kilitli kalıyordu** — epok 75 gün geride olduğunda −2 dönemi
   sınırın öncesine düşüyordu. QA epoku 120 güne alındı; epok **öncesi**
   davranış saf katmanda ayrıca sınanıyor.

---

## 9 · Cron ve kapılar

| | |
|---|---|
| Uç | `/api/cron/skor-donem` |
| Sıklık | **haftada 1** — dönem 30 günlük **kayan** pencere; aylık koşsaydı şoför üç hafta eski sırayı görürdü |
| Sır | `CRON_SECRET` |
| Geri doldurma | `?geri=N` (en fazla 6 dönem) |
| 088 yoksa | **503** |

Tekrar koşmak zararsız: dönem `(worker_id, donem_bas)` tekil ve yazma
**upsert**; rozet tarafında ikinci koşum 23505 alır.

| İşlem | Kapı |
|---|---|
| Şoför kendi skoru/sırası (mobil) | `requireMobileWorker` |
| Yönetici panosu | `requireFleetView` |
| İsim görünürlüğü ayarı | `requireAdmin` — DE'de işletme kurulu onayı gerektiren bir karar |

---

## 10 · Haftalık aksiyon bağı

084'e **dokuzuncu kural**: `ayin_en_iyisi` — *"X bu dönem en iyi, tebrik et"*.

Taban **200** — listedeki en düşük, ve bilinçli: bu kalem bir **sorun** değil
bir **fırsat**. Diğer sekiz kural geri dönülemez bir kaybı önlüyor; tebrik
etmemek yalnız bir kazancı kaçırmaktır.

Üç kapı: skor eşiği geçmeli · en az **3 şoför** skorlanmış olmalı (iki kişilik
sıralamada birincilik tesadüftür) · dönem kalibrasyon sınırından sonra
başlamalı.
