# CO₂ ekranı — süre ölçümü ve karar

> 31.08.2026 · 🔴 **SALT OKUMA ÖLÇÜM TURU.** HAK61 ve Sendigo canlı
> veritabanlarına tek satır yazılmadı: ölçüm scriptlerinde `globalThis.fetch`
> sarmalandı, `GET`/`HEAD` ve `POST /rest/v1/rpc/…` dışındaki her istek
> **hata fırlatarak** reddedildi (sayaç: 0 engellenen istek = hiç denenmedi).
> Kodda tek harf değişmedi, deploy yapılmadı.
> İlgili: [`AYLIK-METRIK.md`](AYLIK-METRIK.md) · [`VERCEL-BOLGE.md`](VERCEL-BOLGE.md)

---

## 0 · KISA CEVAP

| soru | cevap | nasıl |
|---|---|---|
| Demo neden HAK61'in 2 katı? | **"Demo'da veri az" varsayımı yanlış kurulmuş.** Süre araç/sorgu sayısıyla değil, pencereye düşen **telemetri satırıyla** ölçekleniyor. En güçlü aday: demo'nun son 6 ayında **dolu ay sayısı fazla**. Bölge farkı en fazla ~2,5 sn açıklar. | § 1 |
| Cron kurulunca kaç saniye? | **34,61 → 18,11 sn** (HAK61 yerel, ölçüldü). Vercel karşılığı ≈ **8 sn** `[oran varsayımı]` | § 2 |
| Açık ayın tek başına maliyeti? | **9,30 sn** (HAK61) · **7,62 sn** (Sendigo) — cron sonrası taban budur | § 3 |
| Cron sonrası hâlâ 8+ sn mi? | **Evet.** Ve kalan sürenin **~%97'si tek bir kusur**: açık ay her istekte **İKİ KEZ** hesaplanıyor. | § 4 |

🔴 **Turun en büyük bulgusu cron'la ilgili değil:** `co2Panosu` açık ayı iki
ayrı yoldan hesaplıyor ve **birebir aynı sonucu** üretiyor (litre farkı
`0,0000`). Cron kurulsa bile bu 9 saniye yerinde kalır.

---

## 1 · DEMO NEDEN YAVAŞ

### 1.1 Ölçülen: süre sorgu sayısına değil, SATIR sayısına bağlı

`buildFuelReport` tek pencerede, HAK61 canlı:

| pencere | süre | sorgu | ölçülen/araç | pencereye düşen `device_telemetry` satırı |
|---|---:|---:|---:|---:|
| gün (son 24 sa) | 2,85 sn | 191 | 17/29 | 32.845 |
| hafta (son 7 gün) | 3,56 sn | 193 | 17/29 | 242.503 |
| ay (ay başı →) | 9,04 sn | 199 | 22/29 | 1.104.213 |

**Sorgu sayısı neredeyse sabit (191 → 199), süre 3,2× artıyor.** Yani fan-out
tabanı değil, taranan veri belirliyor.

### 1.2 Karşı-ölçüm: az araç ≠ hızlı

Aynı kod, aynı istemci (bu makine), iki kiracı:

| kiracı | araç | `co2Panosu` sorgu | süre | **ms / sorgu** |
|---|---:|---:|---:|---:|
| HAK61 (Dublin) | 29 | 1.319 | 34,61 sn | **26,2** |
| Sendigo (Frankfurt) | 4 | 212 | 19,94 sn | **94,1** |

Sendigo **6,2× az sorguyla yalnız 1,7× hızlı**. Araç sayısı düştükçe fan-out
paralelliği kayboluyor ve RTT baskın hâle geliyor. "Demo'da araç/şoför az,
o hâlde hızlı olmalı" çıkarımı bu yüzden yürümüyor.

### 1.3 Üç hipotez, ölçüm ışığında

**a) Bölge farkı — açıklıyor ama küçük.** `VERCEL-BOLGE.md` § 3 modeli:
`t = 198 ms + derinlik × RTT`. HAK61 CO₂ ucu Vercel'de 15,30 sn →
derinlik ≈ (15.300 − 198) / 92 ≈ **164**. Fonksiyon iad1'de, HAK61 Supabase'i
Dublin'de, demo'nunki Frankfurt'ta. Frankfurt iad1'e ~15 ms daha uzaksa:
164 × 15 ms ≈ **2,5 sn**. Ölçülen fark ~16,6 sn. **Bölge tek başına yetmiyor.**
⚠️ `RTT(iad1→fra1)` **ÖLÇÜLMEDİ** — iad1'de kod koşturamıyorum.

Bu makineden ölçülen RTT'ler (12 örnek, `vehicles?select=id&limit=1`):

| hedef | min | medyan |
|---|---:|---:|
| HAK61 Supabase (eu-west-1, Dublin) | 86 ms | 95 ms |
| Sendigo Supabase (eu-central-1, Frankfurt) | 60 ms | 135 ms |

Bu sayılar **iad1'den değil Türkiye'den** ölçüldü; iki bölgenin iad1'e
uzaklığı hakkında hiçbir şey söylemez. Buraya yalnız "bölge farkı ölçülebilir
bir şey ama bu turda izole edilemedi" demek için kondu.

**b) Compute boyutu — kanıt yok.** Repoda `vercel.json` da `vercel.ts` de yok,
`preferredRegion` hiçbir yerde geçmiyor; üç kiracı da aynı framework
varsayılanlarıyla koşuyor. Fluid Compute'ta boyut farkı yaratacak bir ayar
repoda **YOK**. Vercel proje ayarlarından bakılabilir — ben ölçemedim.

**c) Dolu ay sayısı — EN GÜÇLÜ ADAY.** `aylikSeri` son 6 ayı sırayla tam
`buildFuelReport` ile hesaplıyor. HAK61'de ölçülen ay maliyetleri:

| ay | süre | sorgu | durum |
|---|---:|---:|---|
| 2026-03 | 2,21 sn | 178 | BOŞ |
| 2026-04 | 2,16 sn | 178 | BOŞ |
| 2026-05 | 2,09 sn | 178 | BOŞ |
| 2026-06 | 2,11 sn | 178 | BOŞ |
| 2026-07 | 5,43 sn | 201 | dolu (24/29) |
| 2026-08 | 8,84 sn | 199 | AÇIK AY (22/29) |
| **toplam** | **22,84 sn** | **1.112** | |

**Dolu ay boş ayın 2,6–4,2 katı.** HAK61 telemetrisi 13.07.2026'da başlıyor,
yani altı ayın **dördü tamamen boş** ve ucuz. galzura-demo daha uzun geçmişli
gerçek telemetri taşıyorsa o dört ay da dolu olur:

```
HAK61 bugün      : 4 boş (8,57) + 1 dolu (5,43) + açık (8,84) = 22,84 sn
6 ayın hepsi dolu: 5 × ~6,5                     + açık (8,84) ≈ 41 sn
```

Bu, demo'nun 31,9 sn'sini HAK61'in 15,3 sn'sinden ayıran mertebedir.

### 1.4 🔬 Bunu tek sorguyla doğrulamanın yolu (Volkan)

galzura-demo service key'im yok, bu yüzden **doğrudan ölçemedim.** Ayrımı
kesinleştiren tek sorgu — salt okuma, demo'nun SQL editöründe:

```sql
select date_trunc('month', recorded_at)::date as ay,
       count(*)                                as satir,
       count(distinct vehicle_id)              as arac
from public.device_telemetry
where recorded_at >= date_trunc('month', now()) - interval '5 months'
group by 1 order by 1;
```

- **6 satır dönerse** (her ay dolu) → sebep (c), cron kazancı **büyük** olacak
- **1–2 satır dönerse** (HAK61 gibi) → sebep (c) DEĞİL; o zaman (a)/(b)
  ölçülmeli: demo ucunun `x-vercel-id` başlığı ile bölgesi ve
  `/api/mobile/score-config` (1 sorgu) + `/api/mobile/fleets` (6 sorgu)
  eğiminden RTT'si — `VERCEL-BOLGE.md` § 3.1'deki yöntem.

---

## 2 · CRON KURULUNCA NE OLUR — ÖLÇÜLDÜ, TAHMİN DEĞİL

### 2.1 Yöntem

Tablo bugün boş, cron henüz koşmadı. Bu yüzden senaryo **tahmin edilmedi,
gerçekten koşturuldu**:

1. `ayOzetiYaz` beş kapanmış ay için **gerçekten** çalıştırıldı (canlı okuma);
   `upsert` isteği HTTP katmanında yakalandı, **gönderilmedi**, üretilen
   **145 satır** belleğe alındı.
2. Sonra `co2Panosu` koşturuldu; yalnız `vehicle_month_metrics` **SELECT**'i
   o 145 satırı döndüren bir şimle karşılandı. Diğer her sorgu canlı.

Yani ölçülen şey "cron koşmuş bir sistemin" gerçek kod yolu.

### 2.2 Sonuç

| | HAK61 | Sendigo |
|---|---:|---:|
| bugün (tablo boş) | **34,61 sn** · 1.319 sorgu | **19,94 sn** · 212 sorgu |
| cron sonrası (tablo dolu) | **18,11 sn** · 406 sorgu | **15,68 sn** · 72 sorgu |
| kazanç | **1,91×** (−16,5 sn) | **1,27×** (−4,3 sn) |
| `kaynak` dağılımı | tablo=5 · canlı=1 | tablo=5 · canlı=1 |

**Doğruluk kontrolü:** tablo yolundan okunan 2026-07 değeri **3.675,1 kg /
13.698 km** — aynı ayın canlı hesabıyla **birebir aynı**. Tablo yolu yanlış
sayı üretmiyor.

**Kazanç neden Sendigo'da küçük:** oradaki beş kapanmış ayın **hepsi boş**;
cron boş ayın 0,6 sn'sini 0,03 sn'ye indiriyor, dolu ayın 5,4 sn'sini değil.
**Cron kazancı dolu ay sayısıyla orantılıdır** — demo'da kazanç HAK61'den
büyük olmalı (§ 1.3c doğruysa).

### 2.3 Cron turunun kendi maliyeti

| kiracı | 5 kapanmış ay yazımı | satır |
|---|---:|---:|
| HAK61 | 18,63 sn | 145 |
| Sendigo | 3,86 sn | 20 |

Gece 03:30'da koşar, kullanıcı beklemez. `maxDuration = 300` ile rahat sığıyor.

### 2.4 Vercel karşılığı `[VARSAYIM]`

Bu ölçümler **bu makineden**; kullanıcı Vercel'den görüyor. HAK61 CO₂ ucu
Vercel'de 15,30 sn ölçülmüştü ([`YAKIT-ARAC-EKSENI.md`](YAKIT-ARAC-EKSENI.md)
§ 10.1), aynı kodun buradaki karşılığı 34,61 sn → **oran 0,442**.

| | yerel (ölçüldü) | Vercel `[oran varsayımı]` |
|---|---:|---:|
| bugün | 34,61 sn | 15,30 sn *(ölçüldü)* |
| cron sonrası | 18,11 sn | **≈ 8,0 sn** |
| + çift hesap da kalkarsa | 10,57 sn | **≈ 4,7 sn** |

⚠️ Oranın sabit olduğu **varsayım**: Vercel'in fan-out paralelliği bu
makineninkinden farklı olabilir. Gerçek sayı ancak deploy sonrası ölçülür.

---

## 3 · AÇIK AYIN MALİYETİ = CRON SONRASI TABAN

Açık ay **hiçbir zaman** tablodan okunmaz — her gün değişir, gece yazılan
satır sabaha bayat olur (`lib/co2-db.ts`, bilinçli karar). Tek başına:

| kiracı | açık ay (tam ay penceresi) | sorgu |
|---|---:|---:|
| HAK61 | **9,30 sn** | 199 |
| Sendigo | **7,62 sn** | 32 |

Bunu kanıtlayan ölçüm: `aylikSeri`'nin **altı ayı da** tablodan gelmiş gibi
şimlendi → süre **18,25 sn** çıktı, yani cron sonrası 18,11 sn'den
**düşmedi**. Çünkü kod açık ay için tablo satırını hiç okumuyor, doğrudan
`buildFuelReport`'a gidiyor. **Taban budur ve cron onu indirmez.**

---

## 4 · 🔴 KALAN SÜRENİN ~%97'Sİ: AÇIK AY İKİ KEZ HESAPLANIYOR

### 4.1 Bulgu

`co2Panosu` açık ayı iki ayrı yoldan hesaplıyor:

| # | çağrı | pencere | süre | sorgu |
|---|---|---|---:|---:|
| (3) | `buildFuelReport(bas, bit)` — ucun seçilen aralığı | ay başı → **şimdi** | 8,81 sn | 199 |
| (6) | `aylikSeri` son elemanı — açık ay | ay başı → **ay sonu** | 9,30 sn | 199 |

`range=ay` seçiliyken bu iki pencere **aynı veriyi** tarıyor. Ölçüldü:

```
(3) litre 3895,27      (6) litre 3895,27      fark 0,0000
```

Cron sonrası kalan 18,11 sn'nin dağılımı:

```
(3) seçilen pencere       8,81 sn   199 sorgu
(6) açık ay               9,30 sn   199 sorgu   ← aynı veri, ikinci kez
şoför/müşteri/ayar/tablo  1,62 sn     8 sorgu
                         ────────   ─────────
                          19,7 sn   406 sorgu   (ölçülen 18,11 — paralellik)
```

⚠️ Tekrar **yalnız `range=ay`'da tam**. `range=hafta`'da pencereler farklı
(hafta 3,56 sn + açık ay 9,30 sn), yani tekrar yok ama aylık seri yine de
tam bedelini alıyor — kullanıcının ölçümünde `hafta` 23,4 sn olmasının sebebi
bu.

### 4.2 Öneriler — etki sırasına göre

**Ö1 · Açık ayın çift hesabını tekle indir** `[sunucu, en büyük kazanç]`
`range=ay` seçiliyken `aylikSeri`'nin açık ay elemanı, ucun zaten hesapladığı
(3) sonucundan türetilebilir; pencereler farklıysa (hafta/gün) eski yola
düşülür. Ölçülen kazanç: **18,11 → 10,57 sn** yerel, Vercel ≈ **8,0 → 4,7 sn**.
Tek bir yerde, davranış değişmeden. **Bu turda uygulanmadı** — görev "ölç ve
öner" idi.

**Ö2 · Kısmi sonuç: önce toplam, sonra aylık seri** `[ekran + uç]`
Uç bugün her şeyi bitirip tek yanıt veriyor. `ozet` (seçilen pencerenin
toplamı) **8,8 sn**'de hazır; `aylik` ise +9,3 sn sonra. Ekranın beklediği ilk
sayı ilk gelirse kullanıcı yarım dakika değil ~4 sn bekler.
İki yol var: ayrı bir `?parca=ozet|aylik` parametresi, ya da mevcut ucun
`aylik: null` ile erken dönüp aylık seriyi ikinci bir çağrıya bırakması.
Bu, [`ANALIZ-YAVASLIK.md`](ANALIZ-YAVASLIK.md)'deki ayırma kararının aynısı —
orada CO₂ Analiz ekranını rehin alıyordu, burada aylık seri özeti rehin alıyor.

**Ö3 · İlerleme göstergesi** `[ekran, ucuz]`
Belirsiz çark yerine adım adım: "yakıt okunuyor → aylık seri (3/6)".
Uç bugün ara durum yayınlamıyor, ama Ö2 uygulanırsa iki aşama doğal olarak
görünür hâle gelir. Tek başına süreyi kısaltmaz, **algılanan** süreyi kısaltır.

**Ö4 · İptal düğmesi** `[ekran, ucuz]`
`AbortController` ile isteği iptal et. Sunucu tarafında iş devam eder
(istemci bağlantıyı kesse de fonksiyon çalışmayı sürdürür), yani maliyet
düşmez — yalnız kullanıcı kilitli kalmaz. 90 sn'lik istemci sınırı zaten
aşılmıyor, o yüzden bu **öncelik sırasında sonuncu**.

**Sıralama önerisi:** Ö1 (sunucu, ölçülmüş 1,7× kazanç) → Ö2 (algılanan süre
30 sn'den ~4 sn'ye) → Ö3 → Ö4. Cron kaydı ise bunlardan **bağımsız ve önce**
gelmeli: tek başına 1,9× getiriyor ve hiçbir kod değişikliği istemiyor.

---

## 5 · ÖLÇEMEDİKLERİM

- **galzura-demo'da hiçbir şey** — service key yok `ÖLÇÜLEMEDİ`. § 1.4'teki
  sorgu ve `x-vercel-id` kontrolü Volkan'da.
- **`RTT(iad1→fra1)` ve `RTT(iad1→eu-west-1)`** — iad1'de kod koşturamıyorum.
  92 ms rakamı `VERCEL-BOLGE.md`'den devralındı, bu turda yeniden ölçülmedi.
- **Vercel compute boyutu** — repoda ayar yok; proje ayarlarından bakılmalı.
- **Vercel'deki gerçek cron-sonrası süre** — § 2.4 oran varsayımı. Cron
  kurulduktan sonra ölçülmeli.
- **Cron'un gerçek yazma turu** — HAK61 salt okuma; upsert hiç gönderilmedi.
