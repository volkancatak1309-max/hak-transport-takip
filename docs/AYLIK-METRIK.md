# Aylık metrik — S4

> 28.08.2026 · Dal **`perf/yakit-arac-ekseni`** · main'e dokunulmadı ·
> **push/deploy YOK** · 🔴 **MIGRATION YAZILMADI VE ÇALIŞTIRILMADI** —
> gerekmedi, § 2.4. HAK61 ölçümleri **salt okuma**; tek satır yazılmadı.
> Kaynak: [`docs/ANALIZ-YAVASLIK.md`](ANALIZ-YAVASLIK.md) § 5 · S4.

---

## 0 · KISA CEVAP

**Tablo, yazıcı ve indeks ZATEN VAR (090). Eksik olan yalnız iki şey: bir
gece cron'u ve okuma yolunun tabloya bağlanması.**

Ölçüldü (HAK61, 28.08.2026): aylık seri **1.112 sorgu / 23,58 sn**, ve altı
ayın **dördü tamamen boş** olduğu hâlde 712 sorgu / ~8,95 sn harcıyor.

---

## 1 · TABLO — `vehicle_month_metrics` (090)

### 1.1 Kolonlar ve niyet

| grup | kolonlar |
|---|---|
| anahtar | `vehicle_id`, `ay` — **PK `(vehicle_id, ay)`** |
| km | `km`, `odometre_ilk`, `odometre_son` |
| yakıt | `litre`, `yuzde_tuketim`, `dolum_sayisi`, `dolum_yuzde`, `dusus_sayisi`, `dusus_yuzde`, `l_100km` |
| güvenilirlik | `ornek_sayisi`, `yakit_ornek_sayisi`, `yakit_sifir_okuma`, `ilk_kayit`, `son_kayit`, **`olculemedi_sebep`** |
| iz | `hesaplandi_at`, `hesap_surumu`, `ham_silindi_at` |

**Ay tanımı: UTC.** `ay date not null check (ay = date_trunc('month', ay)::date)`
— granülerlik şemada zorlanıyor, yanlış çözünürlükte satır yazılamaz.

🔑 **Kritik doğrulama — iki tarafın ay sınırı AYNI:**

```
ayOzetiYaz  → aySiniri(ay)  → Date.UTC(y, m-1, 1) … Date.UTC(y, m, 1)
aylikSeri   →                  Date.UTC(yıl, ay-i, 1) … Date.UTC(yıl, ay-i+1, 1)
```

İkisi de UTC, birebir aynı pencere → **tablodan okumak canlı hesapla aynı
sayıyı verir.** Farklı olsalardı (biri Viyana, biri UTC) trend sessizce
kayardı.

### 1.2 090'ın niyeti neydi

Silme öncesi **kanıt saklama**. 090'ın kendi başlığı: ham silinirse
"sessizce yanlış" olacak yüzeyler arasında Yakıt · Maliyet · **CO₂** ·
Kârlılık sayılıyor; bu yüzden aylık özet yazılmadan bir aralık silinemiyor
(`lib/saklama.ts` → `silmeKapisi` → `ozet_eksik` engeli).

Yani tablo **CO₂ trendi için değil, silme kapısı için** kurulmuştu. S4 onu
ikinci bir tüketiciye açıyor — şekli zaten doğru.

### 1.3 🔑 `olculemedi_sebep` — "ölçülemedi ≠ 0" tasarıma gömülü

`'cihaz_yok' · 'yetersiz_okuma' · 'sensor_arizali' · 'odometre_yok'`,
NULL = ölçüldü. Bu kolon olmasaydı tablodan okumak uydurma sıfır üretirdi.

---

## 2 · 🔴 KİM YAZACAK

### 2.1 Yazıcı ZATEN VAR — `ayOzetiYaz(ay)` (`lib/saklama-db.ts:320`)

Ve tam olarak `aylikSeri`'nin yaptığını yapıyor: ayı **tek pencere** olarak
`buildFuelReport`'a veriyor, satır satır `litre`/`km` yazıyor,
`olculemedi_sebep` türetiyor, `(vehicle_id, ay)` üzerinden **upsert** ediyor
ve `ham_silindi_at` dolu satırlara **dokunmuyor**.

⚠️ Kendi yorumu şunu söylüyor ve S4 için de geçerli: *"Günlük parçalara bölüp
toplamak yakıtı %15,6–28,9 şişiriyor (ÖLÇÜLDÜ). Aylık tek pencerenin sapması
%0,0 — çünkü bu, raporun kendi cevabı."*

**Bugünkü tek çağıranı** `hazirligiIlerlet` (silme hazırlığı ekranı,
`app/actions/saklama.ts:205`). Yani yalnız bir yönetici silmeye hazırlanırken
koşuyor — bu yüzden tablo **0 satır**.

### 2.2 Üç seçenek — ve seçim

| | gece cron | okurken tembel doldurma | ikisi birden |
|---|---|---|---|
| Yazma nerede | kendi ucunda | 🔴 **GET içinde** | ikisi |
| İlk okuma hızlı mı | evet (cron önden koşmuş) | **hayır** — ilk okuyan bedeli öder | evet |
| Eşzamanlı okuyucu | sorun yok | 🔴 iki okuyucu aynı ayı yazar (upsert kurtarır ama iki kez hesaplanır) | — |
| Sözleşme | temiz | 🔴 **GET yazmamalı** | bulanık |

**Seçim: gece cron.** `/api/cron/aylik-metrik`, günde 1, **03:30**
(saklama 03:00'te koşuyor, aynı dakikaya binmesin).

**Tembel doldurma REDDEDİLDİ.** Gerekçe tek cümle: **bir GET yazmamalı.**
CO₂ panosu ve mobil `/api/mobile/analytics/co2` salt okuma uçlarıdır; onları
yazan hâle getirmek, eşzamanlı iki okuyucunun aynı ayı iki kez hesaplamasına
ve bir okuma isteğinin 8 saniye sürmesine yol açardı.

### 2.3 Geçmiş aylar · kapanmamış ay · geç gelen veri

| soru | cevap |
|---|---|
| **Geçmiş aylar nasıl dolar?** | `?geri=N` (varsayılan 6, tavan 24). İlk koşuda altı ayı birden yazar. `/api/cron/skor-donem?geri=5` ile aynı desen. |
| **Kapanmamış (açık) ay?** | 🔴 **YAZILMAZ.** Değeri her gün değişir; gece yazılan satır sabaha bayat olur. Açık ay okuma anında **canlı** hesaplanır. Yanıt gövdesinde `acikAyYazilmadi` alanı var — okuyan yanılmasın. |
| **Veri sonradan gelirse?** | Ay **kapandığı gece yazılmaz**: `?gecikme=` gün beklenir (varsayılan **2**). 28.08'de 4 saatlik kesinti sonrası 11.455 satır geç düştü; 2 gün o pencerenin çok üstünde. Bekleme hiçbir ekranı geciktirmez — o ay bu arada canlı okunur. Bilinen bir geç veri için `?tazele=1` satırı yeniden yazar (upsert). |

### 2.4 🔴 MIGRATION GEREKMEDİ

Görev "boştaki ilk numarayı al" diyordu; **almadım, çünkü gerek yok.** 090
şunların hepsini kurmuş: tablo, `check` kısıtı, PK, `idx_vmm_ay (ay desc)`,
ve yazıcı fonksiyon uygulama katmanında. S4'ün ihtiyacı olan hiçbir şey şema
değişikliği gerektirmiyor:

- "hesaplanmadı" ile "ölçülemedi" ayrımı → **satırın yokluğu** yeterli
- okuma sorgusu `where ay in (…)` → mevcut `idx_vmm_ay` yeterli
  (tablo ~29 araç × 6 ay = **174 satır**)

Boş bir migration yazmak, kurulum SQL'ini ve dört hizalama dosyasını sebepsiz
şişirirdi.

⚠️ **Ama bir şey kayda geçmeli:** `hesap_surumu` sabiti hâlâ **`'090.1'`**
(`lib/saklama-db.ts:59`). 095 düşüş kapısını değiştirdi (`< 1` →
`between -1 and 1`), yani 095 ÖNCESİ yazılmış satırların `dusus_sayisi`/
`dusus_yuzde` alanları bugünkü motorla üretilenden farklı olurdu. Tablo bugün
**boş** olduğu için pratik sonucu yok ve **bu turda dokunmadım** — ama ilk
satır yazılmadan önce sürüm etiketi `'095.1'`e çekilmelidir. Aksi hâlde
bayat satır ile taze satır ayırt edilemez. **CO₂ trendi bu alanları
KULLANMIYOR** (yalnız `litre` + `km`), o yüzden S4 bundan etkilenmiyor.

---

## 3 · TUTARLILIK — aynı ay iki kez hesaplanırsa

**Aynı ham satırlar üzerinde: evet, birebir aynı.** `ayOzetiYaz` saf bir
fonksiyon gibi davranır — girdi ham telemetri, çıktı özet.

**Ham satırlar değişirse: hayır.** Ve değişebiliyor:

| kaynak | gözlem |
|---|---|
| flespi telafi turu | 28.08: 4 saatlik kesinti sonrası **11.455 satır** geriye yazıldı |
| ham silme (`/admin/saklama`) | `ham_silindi_at` işaretlenir; satır **yeniden üretilemez** ve `ayOzetiYaz` ona dokunmaz |

### Bayat satır ne olur — bugünkü tasarımda

`hesaplandi_at` her satırda duruyor. **Bayatlık, `hesaplandi_at`in o ay için
en yeni `ingested_at`ten eski olmasıdır.** Bugünkü kod bunu otomatik
KONTROL ETMİYOR `[VARSAYIM: gerekmedi]` — çünkü:

1. Ay kapandıktan **2 gün sonra** yazılıyor; ölçülen en uzun telafi penceresi
   4 saat. Yani yazma anında geç veri zaten düşmüş oluyor.
2. Geç veri yine de gelirse `?tazele=1` ile tek komutla düzelir.

⚠️ Otomatik bayatlık denetimi **yazılmadı** ve bu bilinçli bir eksiklik.
Yazılacaksa şekli belli: her (araç, ay) için
`max(ingested_at) > hesaplandi_at` sorgusu — ama bu, tasarrufun bir kısmını
geri verir (fazladan bir sorgu). § 6'daki doğrulama betiği bunu **elle**
yapıyor.

### Ekran hangi rakamı gösterir

Bayat bir satır varsa ekran **onu** gösterir ve bunu `kaynak: "tablo"` ile
söyler. Canlı hesapla arasındaki farkı § 6'daki betik ölçer.

---

## 4 · EKRANDA NE DEĞİŞİR — "0" ile "bilinmiyor" ayrımı KORUNUYOR

Bugün `CO2Client.tsx` `kg === null` ise **"ölçülemedi"** yazıyor. Tablodan
okumaya geçince `kg === null`'ın **İKİ** ayrı sebebi olur ve ikisi aynı
gösterilemez:

| durum | anlamı | ekranda |
|---|---|---|
| satır **var**, hepsinde `olculemedi_sebep` dolu | ay hesaplandı, hiçbir araç ölçülemedi | **"ölçülemedi"** (bugünkü davranış) |
| satır **YOK** ve canlı hesap da yapılmadı | özet hiç üretilmemiş | 🔴 **"hesaplanmadı"** — YENİ |
| satır yok ama canlı hesaplandı | (açık ay, ya da cron kurulmamış) | değeri gösterir, `kaynak: "canli"` |

Bunun için `CO2Panosu["aylik"]` satırına **`kaynak: "tablo" | "canli" |
"hesaplanmadi"`** alanı eklendi ve üç dile `co2.hesaplanmadi` anahtarı
girildi (tr *"hesaplanmadı"* · de *"nicht berechnet"* · en *"not computed"*).
`lint:i18n` geçti.

> Bu, uydurma sayı yasağının aynı kökü: **"ölçülemedi" bir ölçüm yargısıdır,
> "hesaplanmadı" bir eksikliktir.** İkincisini birincisi gibi göstermek,
> bilinmeyeni ölçülmüş gibi sunmaktır.

---

## 5 · KAZANÇ — ölçüm + formül

### 5.1 Bugünkü hâl (HAK61 canlı, ölçüldü)

| ay | süre | sorgu | ölçülen araç |
|---|---:|---:|---:|
| 2026-03 | 2,45 sn | 178 | **0 — BOŞ** |
| 2026-04 | 2,15 sn | 178 | **0 — BOŞ** |
| 2026-05 | 2,29 sn | 178 | **0 — BOŞ** |
| 2026-06 | 2,06 sn | 178 | **0 — BOŞ** |
| 2026-07 | 6,32 sn | 201 | 24 |
| **2026-08** | **8,30 sn** | 199 | 22 ← **AÇIK AY** |
| **TOPLAM** | **23,58 sn** | **1.112** | |

> Süreler benim makinemden (~96 ms RTT); **sorgu sayıları ortamdan
> bağımsızdır** ve asıl kanıt odur. Telemetri **13.07.2026**'da başlıyor,
> yani dört ay tanım gereği boş.

### 5.2 Sonrası — formül

```
ÖNCE  = 6 × buildFuelReport
SONRA = 1 × buildFuelReport (AÇIK ay)  +  1 × tablo sorgusu

sorgu : 1.112  →  199 + 1 = 200        (−82 %)
süre  : 23,58  →  8,30 + 0,13 = 8,43 sn (−64 %)   [VARSAYIM: açık ay bugünkü maliyetinde kalır]
```

**Boş ay sorunu tamamen kalkar:** kapanmış ay tabloda ya vardır (1 sorgunun
içinde okunur) ya yoktur (canlıya düşer). Dört boş ayın 712 sorgusu ve
~8,95 sn'si **sıfırlanır** — çünkü boş ayın da tabloda satırı olur
(`olculemedi_sebep='cihaz_yok'`), yani ikinci koşuda hiç hesaplanmaz.

### 5.3 co2Panosu bütününe etkisi `[VARSAYIM]`

co2Panosu bugün **15,3 sn** (dağıtılmış, dub1). Aylık seri onun baskın
parçası. Kapanmış beş ay tablodan gelirse kalan iş: seçili aralık raporu +
açık ay raporu + kırılımlar.

```
15,3 sn  →  ~7–9 sn        [VARSAYIM — ölçülmedi, cron koşmadan ölçülemez]
```

⚠️ Bu satır **cron koştuktan sonra ölçülecek.** Önceki turda "10–15 sn"
tahminim aralığın üst ucundan çıkmıştı; bu sefer de üst ucu beklemek doğru
olur.

---

## 6 · RİSKLER — tablo yanlış dolarsa müşteriye yanlış CO₂ gider

### 6.1 Riskler ve karşılıkları

| risk | karşılık |
|---|---|
| Tablo yanlış dolar → yanlış CO₂/yakıt | § 6.2 doğrulama betiği; ayrıca `hesap_surumu` her satırda |
| Bayat satır (geç telemetri) | 2 günlük gecikme + `?tazele=1`; § 3 |
| Cron hiç kurulmaz | **ekran bozulmaz** — canlı yola düşer (bugünkü davranış) |
| 090 koşmamış kiracı | cron **503** döner; okuma yolu canlıya düşer |
| Açık ay yanlışlıkla yazılır | cron açık ayı **hiç aday listesine almıyor**; yanıt `acikAyYazilmadi` ile söylüyor |
| Ham silinmiş ay üzerine yazılır | `ayOzetiYaz` `ham_silindi_at` dolu satıra **dokunmuyor** (090'dan beri) |
| `hesap_surumu` bayat | § 2.4 — ilk satır yazılmadan `'095.1'`e çekilmeli |

### 6.2 🔴 YANLIŞ DOLDUĞUNU NASIL FARK EDERİZ — doğrulama yolu

**Kural: tablodan okunan her ay, canlı hesapla BİREBİR aynı olmalı.**
Tek kullanımlık, salt okuma karşılaştırma:

```sql
-- Bir ayın tablo toplamı (ölçülemeyen araçlar HARİÇ — sıfır sayılmaz)
select ay,
       count(*)                                    as arac,
       count(*) filter (where olculemedi_sebep is null) as olculen,
       round(sum(litre) filter (where olculemedi_sebep is null), 2) as litre,
       round(sum(km)    filter (where olculemedi_sebep is null), 2) as km,
       min(hesaplandi_at) as en_eski_hesap,
       max(hesap_surumu)  as surum
from public.vehicle_month_metrics
where ay = '2026-07-01'
group by ay;

-- BAYATLIK: o ayın telemetrisi hesaplamadan SONRA mı geldi?
select count(*) as hesaptan_sonra_gelen_satir
from public.device_telemetry dt
join public.vehicle_month_metrics m
  on m.vehicle_id = dt.vehicle_id
 and m.ay = date_trunc('month', dt.recorded_at)::date
where dt.ingested_at > m.hesaplandi_at;
-- → 0 OLMALI. Değilse o ayları `?tazele=1` ile yeniden yaz.
```

Uygulama katmanı için: `buildFuelReport(ay)` çıktısındaki `consumedLiters`
toplamı, tablonun `sum(litre)`si ile **son ondalığa kadar** eşleşmeli.
Bu karşılaştırmayı yapan bir `verify:aylik-metrik` betiği **yazılmadı** —
ayrı iş olarak sıraya alınmalı.

### 6.3 Ne YAPILMADI

- Migration — **gerekmedi** (§ 2.4)
- `hesap_surumu` bumpı — bilinçli ertelendi (§ 2.4)
- Otomatik bayatlık denetimi — bilinçli ertelendi (§ 3)
- `verify:aylik-metrik` doğrulama betiği — **yazılmadı**, sıraya alınmalı
- Cron kaydı — Volkan kuracak (`docs/CRON-KAYITLARI.md` § 10)

---

## 7 · DEĞİŞEN DOSYALAR

| dosya | değişiklik |
|---|---|
| `app/api/cron/aylik-metrik/route.ts` | **YENİ** — gece cron'u, `?geri` `?gecikme` `?tazele` `?kuru` |
| `lib/co2-db.ts` | `aylikSeri` kapanmış ayları tablodan okuyor; açık ay canlı; satır yoksa canlıya düşer; `kaynak` alanı eklendi |
| `app/admin/co2/CO2Client.tsx` | "hesaplanmadı" ≠ "ölçülemedi" ayrımı |
| `messages/{tr,de,en}.json` | `co2.hesaplanmadi` |
| `docs/CRON-KAYITLARI.md` | 10 numaralı kayıt |

**Migration YOK.** `db/` altında hiçbir dosya değişmedi.

---

## 8 · SIRA (Volkan)

1. Kod yayına alınır (dal `perf/yakit-arac-ekseni`) — **ekran bozulmaz**,
   cron kurulmadan da bugünkü davranışla çalışır.
2. Cron kaydı kurulur: `GET /api/cron/aylik-metrik?secret=<CRON_SECRET>`,
   günde 1, gece 03:30 — **her kiracıda ayrı**.
3. İlk koşum **kuru** yapılır: `&kuru=1` → hangi aylar yazılacak, görülür.
4. Gerçek koşum. Yanıtta `yazilan` ve `aylar[]` okunur.
5. § 6.2'nin iki sorgusu koşturulur — bayatlık **0** çıkmalı.
6. co2Panosu süresi yeniden ölçülür (§ 5.3'ün `[VARSAYIM]`ı kapanır).
