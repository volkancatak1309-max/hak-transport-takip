# Mobil Analiz — CO₂ ayrı uca taşındı

> 28.08.2026 · Dal **`perf/mobil-co2-ayir`** · main'e dokunulmadı · push/deploy yok.
> Kaynak ölçüm: [`docs/ANALIZ-YAVASLIK.md`](ANALIZ-YAVASLIK.md) § 2 (S3 önerisi).
> Ölçüm HAK61 canlıda **salt okuma** yapıldı (galzura-demo service key yok);
> tek satır yazılmadı. Yakıt raporu motoruna (S2) ve aylık tabloya (S4)
> **DOKUNULMADI** — onlar ayrı turda.

---

## 1 · NE DEĞİŞTİ

İki dosya. `lib/co2-db.ts` **hiç değişmedi** → web CO₂ ekranı
(`app/actions/co2.ts`) birebir aynı çalışıyor.

### 1.1 `app/api/mobile/analytics/route.ts` — CO₂ hesabı çıkarıldı

```diff
-import { co2Panosu } from "@/lib/co2-db";
+// co2Panosu import'u KALDIRILDI — CO₂ artık /api/mobile/analytics/co2 ucunda.

-  const co2Pano = await co2Panosu(c.range.start, c.range.end);
-  const co2 = {
-    kg: co2Pano.toplam.kg,
-    gKm: co2Pano.toplam.gKm,
-    ...
-  };
+  const co2 = {
+    kg: null, gKm: null, litre: null, esas: null,
+    kapsama: { olculen: 0, toplam: 0, olculemeyenPlakalar: [] },
+    hedefGKm: null, hedefTuttu: null,
+    ayriUc: "/api/mobile/analytics/co2",
+  };
```

### 1.2 `app/api/mobile/analytics/co2/route.ts` — YENİ

Aynı yetki (`requireMobileAdmin`), aynı aralık dili (`aralikCoz`:
`?range=gun|hafta|ay|tumzaman|ozel` + `?from=&to=`). Döndürdüğü:

| alan | içerik |
|---|---|
| `ozet` | Eski `co2` nesnesinin **birebir aynı şekli** (`kg`, `gKm`, `litre`, `esas`, `kapsama`, `hedefGKm`, `hedefTuttu`) |
| `pano` | Tam kırılım: `araclar`, `soforler`, `musteriler`, `aylik` (6 ay), `tabloYok`, `yakitYok`, `katsayiSurum` |
| `donem` | `/analytics` ile aynı şekil |

---

## 2 · ÖLÇÜM (HAK61 canlı, gerçek işleyici çağrıldı, salt okuma)

### 2.1 Ana kazanç — Analiz ekranı artık AÇILIYOR

| | önce | sonra | değişim |
|---|---:|---:|---:|
| `/api/mobile/analytics?range=hafta` çağrı | **1.301** | **187** | **−%86** |
| süre | **41,8 sn** | **5,55 sn** | **−%87** |

Hedef 186 çağrı / ~5,1 sn'ydi — **187 / 5,55** çıktı `[DOĞRULANDI]`.

Kalan 187 çağrının dağılımı:

```
116 × device_telemetry        ← buildPerformanceReport'un araç eksenli okumaları
 29 × vehicles
 27 × workers
  4 × vehicle_events · 4 × idle_episodes
  4 × rpc:shift_odometer_spans
  2 × time_entries · 1 × device_config_epochs
```

Yanıt bütünlüğü doğrulandı: `toplam` **GELDİ**, `oncekiDonem` **GELDİ**,
`co2` alanı şekliyle duruyor.

### 2.2 Yeni uç — çalışıyor, ama HÂLÂ YAVAŞ

| | değer |
|---|---:|
| `/api/mobile/analytics/co2?range=hafta` | **1.116 çağrı · 31,30 sn** |
| dönen veri | `kg=1.258,7` · `gKm=289,4` · `esas=TTW` · kapsama **17/29 araç** · `aylik` 6 ay |

🔴 **Ayırma CO₂'yi hızlandırmadı, yalnız Analiz ekranını kurtardı.** Sebep
değişmedi: `lib/co2-db.ts:415` → `aylikSeri()` son 6 ayı `for` döngüsünde
sırayla, her ay için tam `buildFuelReport` ile hesaplıyor (1 + 6 = 7 ardışık
rapor; tek rapor ölçüldü: **171 çağrı / 11,0 sn**).

Bu turda düzeltilmedi çünkü çözümü kapsam dışı iki işte:
- **S2** — `report_fuel_volume_stats` araç eksenine (rapor başına ~5 sn'lik
  kapsamsız tek gövde; `docs/HAK61-SAGLIK.md` § 8.2)
- **S4** — aylık seri `vehicle_month_metrics`ten (090 tabloyu kurdu, canlıda
  0 satır)

### 2.3 ⚠️ Yol boyunca çıkan israf bulgusu

Eski kod `co2Panosu`nun **yalnızca** `toplam` + `ayar` + `hedef` alanlarını
okuyordu. `aylik`, `araclar`, `soforler`, `musteriler` hiç kullanılmıyordu.
Yani **7 raporun 6'sı hesaplanıp atılıyordu.**

`hedef` alanı `hedefDurumu(toplam.gKm, ayar.hedefGKm)` — aylık seriye
**bağlı değil** (kod okundu). Yani ileride `co2Panosu`ya "özet modu"
(aylık seriyi atlayan opsiyonel parametre) eklenirse özet ~171 çağrıya /
~11 sn'ye iner. **Bu turda yapılmadı** — görev "ayır" idi, motoru değiştirmek
değil. Kayda geçiyor.

---

## 3 · SÖZLEŞME KIRILIYOR MU — HAYIR, GEÇİŞ GÜVENLİ

**Soru:** mobil bugün `co2` alanlarını okuyorsa ve alan kaybolursa ne olur?

**Karar: alan SİLİNMEDİ, şekliyle korundu.** `data.co2.kg` okuyan bugünkü
istemci **patlamaz**; `null` alır.

| senaryo | eski davranış | yeni davranış |
|---|---|---|
| İstemci güncellenmeden | ekran **hiç açılmıyordu** (timeout) | ekran **açılıyor**, CO₂ satırı `kg=null` |
| `kg: null` anlamı | "ölçülemedi" — zaten belgeliydi ve karşılanıyordu | aynı kod yolu, çökme yok |
| `co2.kapsama.toplam` | gerçek sayı | `0` |
| `co2.ayriUc` | yoktu | `"/api/mobile/analytics/co2"` ← **yeni işaret** |

🔑 **`ayriUc` alanı bu yüzden var.** `kg: null` iki farklı şeyi anlatabilir:
"ölçtük, ölçülemedi" ve "burada hesaplamadık". İkisini karıştırmak, ölçülemeyen
bir dönemi ölçülmüş gibi göstermek kadar yanlış olur. `ayriUc` doluysa ikinci
durumdur.

**Yani panel tarafı tek başına yayına alınabilir** — mobil güncellemesi
beklenmeden Analiz ekranı çalışmaya başlar, CO₂ satırı geçici olarak boş
görünür.

---

## 4 · 🔴 MOBİL TARAFTA NE GEREKİYOR (galzura-fleet-app · o CC'ye iletilecek)

> Mobil depoya **dokunulmadı**. Aşağısı o depodaki CC'nin yapacağı iş.

### 4.1 Zorunlu — Analiz ekranı (öncelik 1)

1. **`/api/mobile/analytics` yanıtındaki `co2` alanına artık güvenme.**
   Yeni alan `co2.ayriUc` doluysa CO₂ satırını **"ölçülemedi" diye YAZMA**.
   Doğrusu: satırı gizle ya da "CO₂ · göster" şeklinde sekmeye/butona çevir.
   `ayriUc` **yoksa** (eski sunucu) bugünkü davranış aynen sürsün — böylece
   istemci hem eski hem yeni sunucuyla çalışır.

2. **Analiz ekranının açılış çağrısına dokunma.** Aynı uç, aynı parametreler;
   yalnız artık 5,5 sn'de dönüyor. Mevcut timeout değeri (14 sn?) yeterli.

### 4.2 Zorunlu — CO₂ için yeni çağrı (öncelik 2)

3. **Yeni uç:** `GET /api/mobile/analytics/co2?range=<aynı değer>`
   (+ `&from=&to=` yalnız `range=ozel`). Yetki ve `Authorization` başlığı
   `/analytics` ile **aynı**.

4. **`ozet` alanı eski `co2` nesnesinin birebir aynı şekli** — mevcut çizim
   kodun değiştirilmeden beslenebilir:
   ```
   { kg, gKm, litre, esas, kapsama:{olculen,toplam,olculemeyenPlakalar},
     hedefGKm, hedefTuttu }
   ```
   Burada `kg: null` **eski anlamını taşır**: ölçülemedi, sıfır değil.

5. 🔴 **BU UCU AÇILIŞTA ÇAĞIRMA.** Bugün **~31 sn** sürüyor (ölçüldü).
   Kullanıcı CO₂ sekmesine dokununca çağrılmalı, kendi "hesaplanıyor"
   durumuyla ve **uzun timeout'la (≥60 sn)**. Açılışa koyarsan bugünkü sorun
   birebir geri gelir.

6. **`pano` alanı** (araç/şoför/müşteri kırılımı + 6 aylık seri) mobilde
   karşılığı yoksa **okunmasın** — ileride CO₂ ekranı yapılırsa hazır.

### 4.3 Bilgi

7. Bu uç S2 ve S4 tamamlanınca **~5 sn'ye inecek**. O zamana kadar CO₂ sekmesi
   "yavaş ama çalışır"dır. Panel tarafında haber verilecek.

---

## 5 · DOĞRULAMA

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **0 hata** — `ƒ /api/mobile/analytics/co2` kayıtlı |
| 11 muhafız | **GEÇTİ** |
| `lint:test-filters` | **taban değişmedi** (`git stash` ile ölçüldü, çıktı bayt bayt aynı) |
| `verify:mobil-analiz` | **çıkış 0** — uç canlı veriyle doğrulandı |
| uçtan uca ölçüm | `/analytics` **187 çağrı / 5,55 sn** · `/analytics/co2` **1.116 / 31,30 sn** |

`lib/co2-db.ts` değişmediği için **web CO₂ ekranı etkilenmedi**.

---

## 6 · ÖLÇEMEDİKLERİM

- **galzura-demo'da hiçbir ölçüm** — service key bende yok `ÖLÇÜLMEDİ`.
  Kodda kiracıya özel dallanma yok, yani davranış aynı olmalı `[VARSAYIM]`.
- Mobil istemcinin fetch timeout değeri — RN uygulaması bu depoda değil.
- Vercel'de gerçek süre — ölçüm benim makinemden, çağrı başına ~85 ms ağ
  RTT'si içeriyor. Vercel'den (Supabase ile aynı bölge) **daha kısa** olmalı;
  çağrı SAYILARI ortamdan bağımsızdır.
