# Litre hattı araç eksenine — S2

> 28.08.2026 · Dal **`perf/yakit-arac-ekseni`** · main'e dokunulmadı ·
> **push/deploy YOK** · 🔴 **MIGRATION ÇALIŞTIRILMADI** (ne demo'da ne canlıda).
> Kaynak ölçüm: [`docs/ANALIZ-YAVASLIK.md`](ANALIZ-YAVASLIK.md) § 5 · S2.
> Canlı ölçümler HAK61'de **salt okuma**; tek satır yazılmadı.
> S4 (aylık tablo) ve `lib/co2-db.ts`ye **DOKUNULMADI**.

---

## 1 · NE YAPILDI

**Migration numarası: 094** (090/091/093 dolu, 092 U-ETDS'e ayrılmış).

| dosya | değişiklik |
|---|---|
| `db/migrations/094_yakit_hacim_arac_ekseni.sql` | **YENİ** — `report_fuel_volume_stats_vehicle` |
| `lib/reports.ts` | litre bloğu 052'nin yüzde desenine çevrildi |
| `scripts/gen-install-sql.mjs` | 094 `ORDER`a eklendi |
| `db/install/*-full.sql` · `*-hizalama-078.sql` | yeniden üretildi (4 dosya) |

`039`'un kapsamsız `report_fuel_volume_stats`i **AYNEN DURUYOR** — geri düşüş
yolu olarak ve 094'ü koşmamış kiracılar için.

---

## 2 · 052'NİN ŞABLONU — YENİ YAKLAŞIM İCAT EDİLMEDİ

052 yüzde hattı için ne yaptıysa litre hattı için aynısı yapıldı:

| | yüzde (052) | litre (094) |
|---|---|---|
| kapsamsız gövde | `report_fuel_stats` — **duruyor** | `report_fuel_volume_stats` — **duruyor** |
| araç eksenli ikiz | `report_fuel_stats_vehicle` | `report_fuel_volume_stats_vehicle` |
| çağrı deseni | `mapBounded(6)` | `mapBounded(6)` |
| RPC yoksa | `missing_function` → kapsamsıza düş | `missing_function` → kapsamsıza düş |
| zaman aşımı | bir kez, **SIRAYLA** tekrar | bir kez, **SIRAYLA** tekrar |

### 2.1 🔑 Gövde farkı TEK SATIR — kanıtlandı

`diff` (parametre hizalaması normalize edilerek):

```
<   p_vehicle_id uuid,                        ← eklenen parametre
<     where dt.vehicle_id = p_vehicle_id      ← eklenen filtre
>     where dt.recorded_at >= p_from
```

`partition by b.vehicle_id`, `partition by c.vehicle_id` ve
`group by vehicle_id` **bilerek korundu**. Tek araçlık girdide işlevsizler ama
silmek gövdeyi 039'dan ayırır ve iki fonksiyonun zamanla ayrışmasına kapı
açardı.

⚠️ 052'nin yüzde tarafındaki **UÇ SATIR KURALI** (027: `rn = 1` / `rn = cnt`)
buraya **EKLENMEDİ** — 039'un litre gövdesinde o kural hiç yoktu, eklemek
sonucu değiştirirdi. Bu migration davranış değiştirmez, yalnız kapsar.

---

## 3 · 🔴 SONUÇ BİREBİR AYNI MI — İKİ BAĞIMSIZ KANIT

### 3.1 SQL katmanı: yerel konteynerde, GERÇEK veriyle

**Yöntem:** HAK61'den salt okumayla **110.292 gerçek `device_telemetry`
satırı** çekildi (son 7 gün, `fuel_volume_l` dolu, 13 araç), tek kullanımlık
PostgreSQL 15 konteynerine yüklendi, **her iki fonksiyon** kuruldu ve
`full outer join` ile **12 çıktı kolonunun tamamı** karşılaştırıldı.

```
satir | yalniz_yenide | yalniz_eskide | f_sample | f_avg | f_min | f_max
   13 |             0 |             0 |        0 |     0 |     0 |     0
      | f_first | f_last | f_rcount | f_rl | f_dcount | f_dl | f_step
      |       0 |      0 |        0 |    0 |        0 |    0 |      0
```

**13 araç · 12 kolon · sıfır fark.** Araç araç:

| araç | örnek | eski dolum L | yeni dolum L | eski düşüş L | yeni düşüş L | sonuç |
|---|---:|---:|---:|---:|---:|---|
| c1ac075b | 3.765 | 2.032,800000 | 2.032,800000 | 1.812,200000 | 1.812,200000 | 12/12 AYNI |
| b2f25581 | 2.883 | 1.102,500000 | 1.102,500000 | 1.000,000000 | 1.000,000000 | 12/12 AYNI |
| b3e18249 | 3.188 | 952,900000 | 952,900000 | 916,600000 | 916,600000 | 12/12 AYNI |
| ca2654eb | 3.868 | 711,000000 | 711,000000 | 741,400000 | 741,400000 | 12/12 AYNI |
| 08cd1c19 | 14.961 | 66,000000 | 66,000000 | 0 | 0 | 12/12 AYNI |
| 4b923fd6 | 15.645 | 57,100000 | 57,100000 | 0 | 0 | 12/12 AYNI |
| *(kalan 7 araç)* | | | | | | **12/12 AYNI** |

Gerçek dolumlar ve şüpheli düşüşler dahil — yani kod yolu boş veriyle değil,
**işin en hassas kısmıyla** sınandı.

Konteyner silindi.

### 3.2 Uygulama katmanı: HAK61 canlıda, A/B

`buildFuelReport` eski ve yeni kodla, **aynı sabit pencerelerde** koşturuldu
(migration canlıda YOK → yeni kod geri düşüş yolunu kullandı):

| pencere | önce (toplam L) | sonra (toplam L) | filo L/100km | araç satırları |
|---|---:|---:|---|---|
| 01–15 Ağu | 1187,7800000000002 | **1187,7800000000002** | 10,85454043610268 ↔ aynı | ✓ |
| 15–22 Ağu | 592,1300000000001 | **592,1300000000001** | 19,008518518518517 ↔ aynı | ✓ |
| 01–28 Ağu | 2129,2700000000004 | **2129,2700000000004** | 11,75834349706176 ↔ aynı | ✓ |

**29 araç × 3 pencere; toplam, filo L/100km ve HER ARACIN litre + km değeri
`diff` ile bayt bayt aynı.** Son ondalık basamağa kadar.

> ⚠️ **Bir yanlış alarm ve düzeltmesi.** İlk denemede kayan pencereyle
> ("hafta") 479,59 ↔ 479,69 farkı çıktı. Sebep kod değildi: `hafta` penceresi
> ŞİMDİYE göre kayıyor ve iki koşum arasında ~5 dakikada yeni telemetri
> geldi (DO-506GS 33,500 → 33,600). Sabit pencereyle tekrarlandığında fark
> **sıfırlandı**. Kayan pencerede A/B yapmak yöntem hatasıdır.

---

## 4 · ÖLÇÜM: SORGU VE SÜRE

### 4.1 Migration ÇALIŞMADAN ÖNCE (bugünkü hâl — geri düşüş yolu)

| pencere | önce | sonra |
|---|---|---|
| 01–15 Ağu | 7,22 sn · 170 sorgu | 8,87 sn · **199 sorgu** |
| 15–22 Ağu | 3,92 sn · 165 sorgu | 5,37 sn · **194 sorgu** |
| 01–28 Ağu | 10,58 sn · 171 sorgu | 11,29 sn · **200 sorgu** |

🔴 **Migration'dan ÖNCE kod deploy edilirse rapor başına +29 boşa çağrı
ödenir** (29 araç `missing_function` alır, sonra kapsamsız yola düşülür).
Zararsız ama israf.

**→ DOĞRU SIRA: önce migration, sonra kod deploy'u.** Ters sıra da güvenlidir
(sonuç aynı), yalnız pahalıdır.

### 4.2 Migration ÇALIŞTIKTAN SONRA — `ÖLÇÜLMEDİ`

Beklenen `[VARSAYIM]`, 052'nin yüzde tarafındaki ölçülmüş orana dayanarak:

| | bugün | migration sonrası (beklenen) |
|---|---:|---:|
| `report_fuel_volume_stats` (kapsamsız) | **4,6–5,1 sn** | — (yalnız geri düşüş) |
| araç eksenli ×29, `mapBounded(6)` | — | **~1–2 sn** |
| `co2Panosu` (7 rapor) | 36,7 sn | **~10–15 sn** |
| `/admin/raporlar/yakit` (ay) | 11,5 sn | **~7–8 sn** |

Bu satırlar migration koşmadan doğrulanamaz. **Koştuktan sonra ölçülecek.**

---

## 5 · İNDEKS: YENİSİ GEREKMEDİ

039 şunu kurmuştu ve **boşta duruyordu**:

```sql
idx_device_telemetry_fuel_volume
  on device_telemetry (vehicle_id, recorded_at)
  where fuel_volume_l is not null            -- 591.468 satır (ölçüldü)
```

049 kendi başlığında bu indeksin kullanılmadığını yazıyor: *"039'un indeksi
vehicle_id ile başlıyor, fonksiyon ise yalnız recorded_at süzüyor."* Yeni
fonksiyon tam olarak `(vehicle_id, recorded_at)` ile seek ediyor —
**039'un indeksi ilk kez amacına hizmet edecek.** Yeni indeks eklenmedi.

049'un `idx_device_telemetry_fuel_volume_time` indeksi de duruyor: kapsamsız
039 fonksiyonu (geri düşüş) hâlâ ona dayanıyor.

---

## 6 · GERİ ALMA

Migration'ın içinde yazılı. Tek cümle:

```sql
drop function if exists public.report_fuel_volume_stats_vehicle(
  timestamptz, timestamptz, uuid
);
notify pgrst, 'reload schema';
```

Uygulama katmanı `missing_function` sınıflandırmasıyla **kendiliğinden**
kapsamsız 039 yoluna düşer — fonksiyonu düşürmek yakıt raporunu **bozmaz**,
yalnız eski (yavaş) yola döndürür. Kod tarafını geri almak gerekmez.

---

## 7 · DOĞRULAMA

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **0 hata** |
| `lint:install-sql` | **GEÇTİ** — 95 migration (91 kurulumda · 4 gerekçeli hariç) |
| 10 diğer muhafız | **GEÇTİ** |
| `lint:test-filters` | **taban değişmedi** (`git stash -u` ile ölçüldü, bayt bayt aynı) |
| SQL eşdeğerlik | **13 araç × 12 kolon · 0 fark** (110.292 gerçek satır, yerel PG 15) |
| Uygulama eşdeğerlik | **29 araç × 3 pencere · 0 fark** (HAK61 canlı, salt okuma) |

---

## 8 · ÇALIŞTIRMA SIRASI (Volkan verecek)

1. **galzura-demo**'da `094_yakit_hacim_arac_ekseni.sql` çalıştır.
2. Migration'ın sonundaki **eşdeğerlik sorgusunu** koştur — beş sütun da
   **0** olmalı. Değilse kodu deploy ETME, bildir.
3. `select proname, pronargs from pg_proc where proname like 'report_fuel_volume_stats%'`
   → **2 satır** (039 duruyor + yeni).
4. HAK61'de aynı ikisi.
5. **Sonra** kod deploy'u (§ 4.1 — ters sıra da güvenli, yalnız pahalı).
6. Deploy sonrası ölçüm: `co2Panosu` ve `/admin/raporlar/yakit` süreleri.

---

## 9 · ÖLÇEMEDİKLERİM

- Migration sonrası gerçek süreler — migration çalışmadı `ÖLÇÜLMEDİ`
- galzura-demo'da hiçbir şey — service key yok `ÖLÇÜLMEDİ`
- Eşdeğerlik yalnız **`fuel_volume_l` dolu 13 araçta** sınandı; kalan 16 araçta
  bu fonksiyon zaten boş döner (hem eski hem yeni), ama ayrıca ölçmedim
- 7 günden uzun pencerelerde SQL-katmanı eşdeğerliği — uygulama katmanında
  28 günlük pencerede doğrulandı, SQL katmanında 7 günlük veriyle

---

## 10 · DAĞITIM SONRASI ÖLÇÜM (28.08.2026 13:21–13:30 UTC)

094 + 095 üç kiracıda da koştu ve kapıyı geçti; kod `main`'e alındı (9838abb).
Aşağısı HAK61'de **salt okuma** ile alınan sonrası ölçümüdür.

### 10.1 Uçlar

| uç | ÖNCE (migration var, kod eski) | SONRA | kazanç |
|---|---:|---:|---:|
| `/api/mobile/analytics/co2` | 19,83 sn | **15,30 sn** | **1,3×** |
| `/api/mobile/analytics` | 1,34 sn | 1,30 sn | 1,0× (yakıt yolunu çağırmıyor) |

### 10.2 🔴 Yakıt rakamları DEĞİŞMEDİ — uygulama katmanında doğrulandı

`buildFuelReport`, üç **sabit** pencerede, yeni kodla:

| pencere | hedef (deploy öncesi) | ölçülen | sonuç |
|---|---:|---:|---|
| 01–15 Ağu | 1187,7800000000002 | 1187,7800000000002 | ✅ birebir |
| 15–22 Ağu | 592,1300000000001 | 592,1300000000001 | ✅ birebir |
| 01–28 Ağu | 2129,2700000000004 | 2129,2700000000004 | ✅ birebir |

Son ondalık basamağa kadar aynı. HAK61'de müşteriye giden yakıt rakamı oynamadı.

### 10.3 57014 kapısı — önceki iddiam FAZLA GENİŞTİ, düzeltiyorum

46 günlük pencerede, bugün ölçülen:

| fonksiyon | sonuç |
|---|---|
| `report_fuel_stats` (YÜZDE, kapsamsız) | 🔴 **hâlâ 57014** |
| `report_fuel_stats_vehicle` ×29, mapBounded(6) | 6,90 sn · en kötü ifade 3,66 sn · **0 hata** · tavana 2,2× |
| `report_fuel_volume_stats` (LİTRE, kapsamsız) | 5,72 sn · **hiç zaman aşımına düşmedi** |
| `report_fuel_volume_stats_vehicle` ×29 | 2,93 sn · en kötü 1,53 sn · **0 hata** · tavana **5,2×** |

**Düzeltme:** § 1'de "094 46 günlük 57014'ü kapatıyor" demiştim. Doğrusu:
57014 **YÜZDE hattının kapsamsız gövdesine** aitti ve **hâlâ orada** — ama o
gövde 052'den beri yalnız geri düşüş yolu, ürün ona uğramıyor. **Litre hattı
zaten timeout almıyordu**; 094'ün kazandırdığı şey timeout'u kapatmak değil,
tavana payı **1,4× → 5,2×** çıkarmak. Fark önemli: biri "arıza giderildi",
öteki "arızaya mesafe açıldı".

### 10.4 Tahmin tuttu mu — evet, ama yolu farklıydı

Tahminim: `co2Panosu` 36,7 → **10–15 sn**. Gerçek: **15,3 sn** — aralığın üst
ucu. Ama kazancın dağılımı beklediğim gibi değil:

```
36,7 sn  →  18,7–19,8 sn   Vercel bölge değişikliği (dub1)   ← büyük pay
19,8 sn  →  15,3 sn        094/095 araç ekseni               ← bu turun payı
```

**Neden 094'ün payı küçük kaldı — ölçüldü:**

| aylık seri penceresi | kapsamsız | araç eksenli | oran |
|---|---:|---:|---:|
| Ağustos (dolu) | 4,70 sn | **2,38 sn** | **1,98× hızlı** |
| Temmuz (kısmen dolu) | 1,03 sn | 0,81 sn | 1,26× hızlı |
| **Haziran (BOŞ)** | **0,09 sn** | **0,58 sn** | 🔴 **0,15× — YAVAŞ** |

HAK61'in telemetrisi **13.07.2026**'da başlıyor. `aylikSeri` son 6 ayı
tarıyor, yani **yarısı boş**. Boş pencerede kapsamsız sürüm hiçbir şey
taramadan 90 ms'de döner; araç eksenli sürüm **29 ayrı çağrı** yapar ve her
biri ~25 ms RTT öder → **~0,6 sn sabit taban**.

> 🔑 **Genel kural olarak kayda geçsin:** araç-ekseni fan-out'unun
> `29 × RTT ≈ 0,6–0,7 sn`'lik bir TABANI var. Pencere yeterince doluysa
> kazanır (Ağustos 1,98×), boşsa **kaybeder**. Bu, S4'ün (aylık seriyi
> `vehicle_month_metrics`ten okumak) neden hâlâ doğru iş olduğunu güçlendiriyor:
> orada 6 rapor tek sorguya iner ve boş ay sorunu tamamen ortadan kalkar.

### 10.5 flespi akışı — kesintisiz

Push'tan sonra 6 örnek (13:21–13:26 UTC), hepsinde akıyor: son yazma 15–19 sn,
son 5 dk 334–412 satır, giriş sorgusu 200, 29 araç, `vin` NULL 0.
Kesinti olmadı, geri alma gerekmedi.
