# 094 eşdeğerlik kapısı neden HAK61'de düştü

> 28.08.2026 · 🔴 **SALT OKUMA TURU.** HAK61'e tek satır yazılmadı, migration
> çalıştırılmadı, yeni migration yazılmadı, kod yayına alınmadı, dal olduğu
> yerde. Ölçüm HAK61'den **salt okumayla** çekilen 147.097 gerçek satırın
> tek kullanımlık yerel PostgreSQL 15 konteynerinde replay'iyle yapıldı;
> konteyner silindi.

---

## 0 · CEVAP

**094 hatalı değil. Hata bulunmadı çünkü hata yok — HAK61'in canlıdaki ESKİ
fonksiyonu depodaki 039 dosyasından FARKLI.**

```
depo 039        :  ... and odo - prev_odo <  1
HAK61 canlı     :  ... and odo - prev_odo <= 1     ← ölçümle bulundu
Sendigo canlı   :  ... and odo - prev_odo <  1     (depoyla aynı)
galzura canlı   :  ... and odo - prev_odo <  1     (depoyla aynı, kapı geçti)
```

Fark tam olarak **odometrenin 1 km ilerlediği** düşüşlerdir: HAK61'in canlı
sürümü onları sayıyor, depo sürümü saymıyor.

**Dört araçta ayrışan miktar: 43 düşüş · 373,2 litre.** Bu, o pencerede
raporlanan toplam şüpheli düşüşün **%7,5'i (adet) / %8,1'i (litre)**.

Bu, bu depoda bulduğumuz **üçüncü** "canlıda var, repoda yok" nesnesi
(öncekiler: `idx_device_telemetry_fuel` indeksi, `vehicles.tank_capacity_l`
kolonu).

---

## 1 · NEDEN YALNIZ DÜŞÜŞ HATTI

Ayrışan ve ayrışmayan alanlar tam olarak `odo`ya bağlı olup olmamalarına göre
bölünüyor — bu tek başına teşhisi daraltan bulgudur:

| alan | `odo` kullanıyor mu | HAK61'de fark |
|---|---|---|
| `sample_count`, `avg_l`, `min_l`, `max_l`, `first_l`, `last_l` | ❌ | **yok** |
| `refill_count`, `refill_l` | ❌ (yalnız `prev_fuel`) | **yok** |
| `max_step_l` | ❌ | **yok** |
| **`drop_count`, `drop_l`** | ✅ `prev_odo` + `odo` | 🔴 **var** |

`prev_fuel` ve `prev_odo` **aynı pencereden** (`lag(...) over w`) geliyor.
`refill` (yalnız `prev_fuel`) birebir tutuyorsa pencere doğrudur → sorun
pencerede değil, **`odo` üzerindeki KOŞULDA.**

### 1.1 Elenen hipotezler — hepsi ölçüldü

| hipotez | ölçüm | sonuç |
|---|---|---|
| `recorded_at`'te bağ (tie) var, `lag()` belirsiz | `group by vehicle_id, recorded_at having count(*)>1` → **0** | ❌ elendi |
| Odometre NULL satırları ayrıştırıyor | 4 araçta "hacim dolu ama odo NULL" → **0, 0, 0, 0** | ❌ elendi |
| `partition by vehicle_id` bir yerde eksik | eksik olsaydı `sample_count`/`refill` de ayrışırdı; **ayrışmıyor** | ❌ elendi |
| Kapsamsız sürüm başka araçların satırlarını karıştırıyor | yerelde 13 aracın hepsi yüklü, iki sürüm de **AYNI** sonucu veriyor | ❌ elendi |
| Pencere kayması (geçen turdaki tuzak) | tek sorguda, tek snapshot; `sinir` CTE'si iki tarafa da aynı değeri veriyor | ❌ elendi |

---

## 2 · REPLAY: FARKI YENİDEN ÜRETTİM

**Yöntem:** HAK61'den salt okumayla 13 aracın 19–28 Ağustos arası tüm
`fuel_volume_l` dolu satırları (**147.097 satır**) çekildi, yerel PG 15'e
yüklendi, **depodaki iki fonksiyon** (039 + 094) kuruldu ve
**2026-08-20 → 2026-08-27** penceresinde koşturuldu.

### 2.1 Yerelde iki fonksiyon AYNI — ve verdikleri sayı HAK61'in "YENİ" sütunu

| plaka | örnek | depo-eski düşüş | depo-yeni düşüş | HAK61 canlı-eski | HAK61 canlı-yeni |
|---|---:|---:|---:|---:|---:|
| DO-718GV | 4684 ✓ | 752,2 / 99 | 752,2 / 99 | **832,2 / 110** | 752,2 / 99 |
| DO-492GV | 3980 ✓ | 1850,3 / 210 | 1850,3 / 210 | **2073,8 / 233** | 1850,3 / 210 |
| DO-777GS | 3874 ✓ | 910,4 / 126 | 910,4 / 126 | **923,1 / 128** | 910,4 / 126 |
| DO-719GV | 3825 ✓ | 729,6 / 95 | 729,6 / 95 | **786,6 / 102** | 729,6 / 95 |

`örnek` (sample_count) ve `refill_l` HAK61'in raporuyla **birebir** tutuyor →
pencerem ve verim doğru. Yerelde **039 = 094**, ve ikisi de HAK61'in *yeni*
sütununu veriyor.

**→ Aykırı olan HAK61'in CANLI ESKİ fonksiyonu.** Depodaki 039 değil.

### 2.2 Hangi koşul? — eşik taraması, 4/4 tam eşleşme

Aynı gövde, yalnız düşüş koşulu değiştirilerek tarandı:

| koşul | 718GV | 719GV | 777GS | 492GV | 492 L |
|---|---:|---:|---:|---:|---:|
| `< 1` **(depo 039)** | 99 | 95 | 126 | 210 | 1850,3 |
| `coalesce(odo-prev_odo,0) < 1` | 99 | 95 | 126 | 210 | 1850,3 |
| **`<= 1`  ·  `< 2`** | **110** | **102** | **128** | **233** | **2073,8** |
| `< 3` | 110 | 102 | 128 | 235 | 2084,8 |
| `< 5` · `< 10` · kapı YOK | 110 | 102 | 128 | 236 | 2095,7 |
| **HAK61 CANLI ESKİ (hedef)** | **110** | **102** | **128** | **233** | **2073,8** |

**`odo - prev_odo <= 1` dört araçta da, hem adet hem litre, virgülüne kadar
eşleşiyor.** Başka hiçbir eşik eşleşmiyor.

> `odometer_km` pratikte tam sayı km olduğu için `<= 1` ile `< 2` ayırt
> edilemez; ikisi de "0 **veya 1** km ilerlemiş" demektir. Depo sürümü ise
> yalnız "**0** km" der.

### 2.3 Farkın tamamı tek bir kovada

```
ayrışan düşüşlerin odometre farkı dağılımı (4 araç, 20–27 Ağu):

  odo farkı 0 km  →  530 düşüş · 4.242,5 L    ← İKİ SÜRÜM DE sayıyor
  odo farkı 1 km  →   43 düşüş ·   373,2 L    ← YALNIZ canlı sürüm sayıyor
```

Çapraz kontrol: 43 = 11+23+2+7 (adet farkları toplamı) ✓ ·
373,2 = 80,0+223,5+12,7+57,0 (litre farkları toplamı) ✓

---

## 3 · BU DÖRT ARAÇTA NE ÖZEL — HİÇBİR ŞEY

Özel olan araçlar değil, **düşüşleri olması.** 13 aracın 9'unda
`drop_count = 0` (sensörleri hiç ≥5 L düşüş göstermiyor) — sıfırdan çıkarılan
sıfır fark üretir. Fark yalnız düşüşü OLAN 4 araçta görünür.

⚠️ **Bu, Sendigo ve galzura-demo'nun "geçti" sonucunu da yeniden okutur:**
onların geçmesi, iki fonksiyonun aynı olmasındandır (ikisi de `< 1`) — HAK61
gibi bir sürüm kayması yaşamamışlar. Sendigo'da düşüş var ve ölçtüm
(20–27 Ağu: **13 düşüş / 75,8 L**), yani oradaki kapı **boş geçmedi**, gerçekten
denetledi.

---

## 4 · 🔴 HANGİSİ DOĞRU — SATIR SATIR KANIT

Kaybolan düşüşlerden üçü, ham satırlarıyla:

| plaka | önceki an | bu an | süre | önceki L | bu L | **düşüş** | önceki km | bu km | km farkı |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| DO-492GV | 04:02:27 | 04:02:36 | **9 sn** | 35,0 | 26,7 | **8,3 L** | 58572 | 58573 | 1 |
| DO-718GV | 07:18:19 | 07:18:35 | **16 sn** | 24,3 | 18,2 | **6,1 L** | 73235 | 73236 | 1 |
| DO-777GS | 08:03:39 | 08:06:06 | **147 sn** | 74,3 | 66,6 | **7,7 L** | 37005 | 37006 | 1 |

**Depo sürümü (`< 1`) bu üçünü de SAYMIYOR**, çünkü odometre 1 km ilerlemiş.

### Fizik ne diyor

Bir çekici ~**0,3 L/km** yakar. 1 km'de tüketim ≈ **0,3 L**.
Ölçülen düşüşler **6,1 – 8,3 L** ve ikisi **9 ve 16 saniyede** olmuş.
**1 km yol, 8,3 litreyi açıklayamaz** — 27 katı.

Yani bu olaylar ya sensör çalkalanması ya gerçek yakıt çekimidir; **"araç
hareket etti, o yüzden normal" açıklaması fiziksel olarak geçersiz.**

### Yargı

| | eski sürüm (`<= 1`) | yeni/depo sürümü (`< 1`) |
|---|---|---|
| 23 düşüşü uyduruyor mu? | **HAYIR** — hepsi gerçek ≥5 L düşüş, ham satırlarda var | — |
| 43 gerçek düşüşü kaçırıyor mu? | — | **EVET** — 373,2 L, %8,1 |

**Cevap: eski sürüm fazla saymıyor; YENİ sürüm eksik sayıyor.**
Depo sürümünün elediği 43 olay uydurma değil, ölçülmüş ve fiziksel olarak
açıklanamayan yakıt kaybıdır.

---

## 5 · DÜZELTME (YAZILDI, UYGULANMADI)

### 5.1 Karar: **094 ve 039 `<= 1`e hizalanmalı** — gerekçesiyle

| | seçenek A: `<= 1` (canlı davranışı koru) | seçenek B: `< 1` (depo davranışı) |
|---|---|---|
| HAK61 müşteri rakamı | **değişmez** | **%8,1 düşer** (373,2 L kaybolur) |
| Sendigo / galzura | drop sayısı **artar** | değişmez |
| Fiziksel savunulabilirlik | ✅ 1 km 5 L yakamaz | ❌ 8,3 L'yi "hareket etti" diye eler |
| Arıza yönü | daha çok yakalar | **yakıt hırsızlığını eksik raporlar** |

**Önerim A.** Belirleyici olan: bu sayı müşteriye *"şüpheli yakıt kaybı"*
olarak gösteriliyor ve **eksik raporlamak, fazla raporlamaktan pahalıdır** —
fazla raporlanan olay incelenip elenir, eksik raporlanan olay hiç görülmez.

⚠️ **Ama bu bir ÜRÜN kararıdır, benim değil.** Her iki seçenekte de bir
kiracının müşteriye giden rakamı oynar; hangisinin oynayacağına Volkan karar
vermeli. Ben yalnız hangisinin fiziksel olarak savunulabilir olduğunu ölçtüm.

### 5.2 Seçenek A uygulanacaksa — yazılacak ama ÇALIŞTIRILMAYACAK

1. `db/migrations/094_yakit_hacim_arac_ekseni.sql` içindeki **iki** filtrede
   `odo - prev_odo < 1` → `odo - prev_odo <= 1`
2. **Yeni bir migration** (095) `report_fuel_volume_stats`i (kapsamsız 039
   sürümü) da `<= 1`e çeker — yoksa geri düşüş yolu farklı sayı verir ve
   094'ün eşdeğerlik kapısı Sendigo/demo'da bu kez ORADA düşer
3. `db/migrations/039_fuel_volume.sql` gövdesi **değiştirilmez** (uygulanmış
   migration geriye dönük düzenlenmez); değişiklik 095'te yaşar
4. Sıra: 095 → üç kiracıda da koştur → eşdeğerlik kapısı → sonra kod deploy'u

### 5.3 Seçenek B uygulanacaksa

094 olduğu gibi kalır, ama **HAK61'in yakıt rakamı deploy günü %8,1 düşer** ve
bu müşteriye **önceden** söylenmelidir. Sessiz bir düşüş, ürünün "ölçtüğünü
söylediği şeyi ölçmüyor" anlamına gelir.

### 5.4 Kapsam dışı ama kayda geçsin `[VARSAYIM]`

Odometre **tam sayı km** ve örnekleme ~30 sn. 50 km/h giden bir araç 30 sn'de
0,4 km yapar; odometre bazen 0, bazen 1 tıklar. Yani **`< 1` ile `<= 1`
arasındaki seçim, fiziği değil ÖRNEKLEME ŞANSINI ayırıyor.** Fiziksel olarak
doğru kapı mesafeye göre beklenen tüketimdir (ör. `dusus > 3 × mesafe_km`),
eşik değil. Bu bir yeniden tasarımdır, bu turun kapsamı dışında.

---

## 6 · VOLKAN'IN ÇALIŞTIRACAĞI TEK DOĞRULAMA (salt okuma)

Hipotezimi doğrudan kanıtlar — canlı fonksiyonun gövdesini basar:

```sql
select pg_get_functiondef(oid)
from pg_proc
where proname = 'report_fuel_volume_stats'
  and pronargs = 2;
```

Beklenen: gövdede `odo - prev_odo <= 1` (ya da `< 2`) geçmeli.
`< 1` çıkarsa hipotezim yanlıştır ve **DUR** — o zaman fark başka yerdedir.

Aynısını Sendigo ve galzura-demo'da koşturmak, üçünün ne kadar ayrıştığını
tek bakışta gösterir.

---

## 7 · ÖLÇEMEDİKLERİM

- **Canlı fonksiyonun kaynak metni** — `pg_get_functiondef` erişimim yok;
  kanıtım davranışsal (4/4 tam eşleşme), § 6 kesinleştirir `ÖLÇÜLEMEDİ`
- **galzura-demo'da hiçbir şey** — service key yok; "geçti" bilgisi Volkan'dan
- Sürüm kaymasının **ne zaman ve nasıl** oluştuğu (elle mi düzenlendi, eski bir
  migration mı kaldı) `ÖLÇÜLEMEDİ`
- DO-492GV'de tarama `< 3` ile `<= 1` arasında 2 düşüş oynuyor — pencere
  kenarındaki 30 satırlık de-glitch penceresinden kaynaklanıyor olabilir
  `[VARSAYIM]`; `<= 1` yine de tam eşleşiyor
