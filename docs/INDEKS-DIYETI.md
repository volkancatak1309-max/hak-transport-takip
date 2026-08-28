# Mükerrer indeks düşürme — 28.08.2026

> Dosya: `db/migrations/093_mukerrer_indeks_dusur.sql`
> Dal: `perf/telemetri-kolon-daraltma` · main'e dokunulmadı · push/deploy yok.
> 🔴 **MIGRATION ÇALIŞTIRILMADI.** Ne HAK61'de ne galzura-demo'da ne Sendigo'da.
> Prova YALNIZ tek kullanımlık yerel Docker PostgreSQL 15 konteynerinde yapıldı
> ve konteyner silindi.

**Numara: 093.** 092 U-ETDS'e ayrıldı; depodaki son dosya 091, 092 ve 093 boştu.

---

## 1 · DOĞRULAMA — "bana güvenme" ciddiye alındı

### 1.1 Ben doğrulayamam, sorguyu yazdım — ve sorguyu doğruladım

`pg_index`e erişimim yok: bu projede tek DB kanalı PostgREST, `pg_catalog`
şemada yok (`docs/HAK61-SAGLIK.md` § 0). Yani "iki indeks aynı mı" sorusunu
**canlıda ben cevaplayamam.** Cevaplayacak sorguyu migration'ın 1. bölümüne
yorum olarak koydum.

Ama o sorguyu yazıp bırakmak yetmezdi — sorgunun kendisi doğru mu? Yerel bir
PostgreSQL 15 konteynerinde canlıdaki iki indeks birebir kuruldu ve sorgu
**on bir senaryoda** sınandı.

### 1.2 🔴 `pg_indexes` karşılaştırması NEDEN YETMEZ — ölçüldü

Bu bölümün en önemli bulgusu. `indexdef` metni tanımın ŞEKLİNİ iyi anlatır
(opclass, collation, desc, nulls first, INCLUDE, WHERE, unique — varsayılan
dışıysa hepsi basılır). Anlatmadığı şey indeksin **DURUMU**dur.

Kurgu: iki indeks birebir aynı tanımla kuruldu, sonra kalması gerekenin
`indisvalid` bayrağı `false` yapıldı (başarısız bir `create index
concurrently`nin bıraktığı hâl).

```
A· indexdef metinleri (ad dışı) eşit mi ......... true    ← "aynı, düşür" derdi
B· kalan indeksin indisvalid'i .................. false   ← ama kullanılamaz
C· migration'daki karar sorgusunun kararı ....... DURDUR  ← yakaladı
```

Yani sadece `pg_indexes` metnine bakılsaydı, planlayıcının kullanabildiği
**tek** indeks düşürülürdü ve tablo indekssiz kalırdı. `pg_index` üzerinden
kontrol tören değil, gerçek bir kapı.

> Bu senaryo HAK61'de büyük ihtimalle yok — geçersiz bir indeks `idx_scan`
> alamaz, oysa ikisinin de taraması var (9.198 / 29.243). Ama "ihtimalle yok"
> ile "kontrol edildi" aynı şey değil.

### 1.3 Karar sorgusu farkı gerçekten yakalıyor mu? — 9/9

Lastik damga olmadığını göstermek için indeks dokuz farklı şekilde bozuldu.
Hepsinde `DURDUR`, ve hangi kontrolün düştüğü doğru raporlandı:

| # | Bozma | Karar | Yakalayan kontrol |
|---|---|---|---|
| 1 | `recorded_at desc` | DURDUR | `siralama` (`indoption`) |
| 2 | farklı `WHERE` (`odometer_km is not null`) | DURDUR | `where` (`indpred`) |
| 3 | anahtar sırası ters `(recorded_at, vehicle_id)` | DURDUR | `kolon_sirasi` + `opclass` |
| 4 | `INCLUDE` sırası ters | DURDUR | `kolon_sirasi` (`indkey`) |
| 5 | `INCLUDE` eksik (tek kolon) | DURDUR | `kolon_sirasi` + `toplam_kolon` |
| 6 | `UNIQUE` | DURDUR | `unique` (`indisunique`) |
| 7 | `nulls first` | DURDUR | `siralama` (`indoption`) |
| 8 | `text_pattern_ops` opclass | DURDUR | `opclass` (`indclass`) |
| 9 | `using hash` | DURDUR | `yontem` (`pg_class.relam`) + `opclass` |
| **10** | **birebir aynı (kontrol)** | **DÜŞÜR** | — (fark yok) |

Ayrıca `indisreplident`, `indisprimary`, `indisexclusion` ve
`pg_constraint.conindid` de eleniyor. `indisreplident` özellikle önemli:
Supabase realtime mantıksal çoğaltma kullanıyor ve `replica identity using
index` yapılandırılmış bir indeksi düşürmek çoğaltmayı bozardı.

### 1.4 Migration gövdesinin provası

Aynı konteynerde, canlıdakine benzer bir `device_telemetry` (13 kolon,
300 satır, `fuel_level_pct`in 1/3'ü NULL) üzerinde:

| Adım | Sonuç |
|---|---|
| 1b karar sorgusu | `DÜŞÜR` |
| `begin; set local lock_timeout='3s'; drop index if exists …; commit;` | `BEGIN / SET / DROP INDEX / COMMIT` — hatasız |
| indeks sayısı | 3 → **2** |
| `to_regclass('…_fuel')` | **NULL** ✓ |
| `to_regclass('…_vehicle_fuel_pct')` | **dolu** ✓ (doğru olan kaldı) |
| ikinci kez çalıştırma | hatasız (`if exists` idempotent) |
| geri alma cümlesi (`create index concurrently if not exists`) | `CREATE INDEX`, `indisvalid = true` ✓ |

**Sözdizimi ve davranış doğrulandı.** Sürüm farkı riski küçük: kullanılan her
şey (`indnkeyatts`, `INCLUDE`, `to_regclass`, `set local lock_timeout`)
PostgreSQL 11+'te var; prova 15.19'da koştu.

---

## 2 · İNDEKSLER NEREDEN GELDİ

### 2.1 🔴 `idx_device_telemetry_fuel` — HİÇBİR MIGRATION YARATMIYOR

Tam ad `db/migrations`, `db/install`, `lib`, `app`, `scripts`, `docs`
altında **hiç geçmiyor** (tam-kelime araması, sonrasında harf/alt çizgi
gelmeyen eşleşme). Depoda yalnız benzer adlar var:
`idx_device_telemetry_fuel_volume` (039),
`idx_device_telemetry_fuel_pct_time` (049),
`idx_device_telemetry_fuel_volume_time` (049).

→ **Canlı HAK61'e Supabase SQL Editor'dan elle açılmış.**

Bu, depoda kaydı olmayan **ikinci** elle şema nesnesi. Birincisi
`vehicles.tank_capacity_l` — ve o, `gen-install-sql.mjs` içinde "KÖPRÜ 1"
diye ayrı bir bölüm gerektirmişti, çünkü yokluğu boş bir veritabanında
migration zincirini 028'de kırıyordu. Aynı sınıf sorun, ikinci örnek.

`[VARSAYIM]` — muhtemel hikâye: yavaş bir yakıt sorgusunu düzeltmek için elle
bir kapsayan indeks açıldı, sonra 053 aynı indeksi düzgün adla ve gerekçeyle
migration'a yazdı, elle açılan hiç düşürülmedi. Boyut farkı (101 ↔ 80 MB) bu
hikâyeye uyuyor: eski olan daha uzun süre şişti.

### 2.2 `idx_device_telemetry_vehicle_fuel_pct` — migration 053

`db/migrations/053_covering_indexes.sql:70`, ayrıca dört kurulum dosyasının
hepsinde (`hak61-full.sql:3678` dahil).

> **Yan bulgu:** bu indeksin canlıda 29.243 taramayla var olması,
> **migration 053'ün HAK61'de uygulandığını** gösteriyor. Kayıtlarda
> "053 ⏳ Volkan'da bekliyor" diye duruyordu; artık beklemediği anlaşılıyor.
> Kesinleştirmek için migration'ın **1a envanter sorgusu** 053'ün ikinci
> indeksini (`idx_device_telemetry_vehicle_odo`) da listeler.

### 2.3 ⚠️ Çözülmemiş sayım tutarsızlığı — 1a sorgusu cevaplayacak

Depodan türettiğim indeks listesi **9 nesne** diyor (PK + 6 btree + BRIN +
039'un kısmisi). Volkan'ın ölçümü de **9 indeks / 701 MB** diyor — ama
onunkinin içinde `idx_device_telemetry_fuel` var ve o benim listemde YOK.

İki 9 aynı 9 değil: demek ki **benim listemdeki nesnelerden biri canlıda
yok.** Hangisi olduğunu bilmiyorum `[BİLMİYORUM]`. Migration'ın 1a envanter
sorgusu tam listeyi basıyor; düşürmeden önce ona bakılmalı — § 4'teki yazma
yükü hesabı da bu listeye dayanıyor.

---

## 3 · KİLİT KARARI

**Seçilen: düz `DROP INDEX`, `begin; set local lock_timeout = '3s'; … commit;`
içinde.**

### 3.1 İki farklı süre var, karıştırılırsa yanlış araç seçilir

| | süre | neden |
|---|---|---|
| **TUTMA** | milisaniye | İş yalnız katalog satırlarını silmek ve dosya unlink'ini commit'e yazmak. 101 MB veri OKUNMUYOR, dosya siliniyor. |
| **BEKLEME** | sınırsız olabilir | ACCESS EXCLUSIVE kilidini almak için mevcut işlemlerin bitmesini bekler. |

### 3.2 🔴 Tehlike kuyruktur, tutma değil

ACCESS EXCLUSIVE bekleyen bir ifade kilit kuyruğunun **başına** geçer. O
beklerken gelen **her** yeni sorgu — 30 saniyede bir koşan flespi sync
yazması dahil — arkasına dizilir.

Somut senaryo: drop, 7 saniye süren bir yakıt raporu ifadesinin
(`docs/HAK61-SAGLIK.md` § 8.2'de ölçüldü) arkasına düşerse, düşürme işi
5 ms sürse bile `device_telemetry` o 7 saniye boyunca fiilen kilitlenir.

### 3.3 `lock_timeout` GEREKLİ Mİ — evet, karar bu

Kilit 3 saniyede alınamazsa ifade `55P03` ile iptal olur, işlem geri alınır,
**kuyruk hiç oluşmaz**. Maliyeti "hiçbir şey olmadı, tekrar dene".

3 saniye seçildi: sync yazmaları kısa, 3 sn tipik bir pencereyi yakalamaya
yeter; yakalayamazsa zarar yok. `set local` kullanıldı — ayar işlem
bitiminde kendiliğinden kalkar, oturuma sızmaz.

### 3.4 `CONCURRENTLY` neden değil

`drop index concurrently` daha zayıf kilit (SHARE UPDATE EXCLUSIVE) alır ve
okumayı/yazmayı engellemez. Yine de seçilmedi:

1. **İşlem bloğunda çalışmaz (25001).** Bu depodaki migration'lar
   `begin; … commit;` ile koşuyor; Supabase SQL Editor'a yapıştırılan çok
   ifadeli betiği PostgreSQL zaten örtük tek işlem olarak çalıştırır. 049 ve
   053 aynı uyarıyı kendi başlıklarında taşıyor — bu depoda bilinen tuzak.
2. **Yarıda kalırsa iz bırakır.** İptal edilen bir CONCURRENTLY düşürme
   indeksi INVALID hâlde bırakabilir; temizlemek için ikinci bir düz drop
   gerekir. "Güvenli yol", arızada daha karmaşık bir hâl üretiyor.
3. **Kazancı küçük.** CONCURRENTLY, CREATE tarafında (dakikalarca süren
   kurulum) hayat kurtarır. DROP tarafında kaçınılan şey milisaniyelik bir
   tutmadır; asıl risk olan BEKLEME'yi CONCURRENTLY değil `lock_timeout`
   çözüyor.

### 3.5 Ama GERİ ALMADA `CONCURRENTLY` şart

Simetri yok ve olmamalı: ~1,7 M satırlık tabloda ~100 MB'lık bir indeksi düz
`create index` ile kurmak kurulum boyunca SHARE kilidi tutar ve **yazmayı
engeller** — flespi sync o süre boyunca telemetri yazamaz. Düşürmede
kaçınılan milisaniye, kurmada dakikaya dönüşüyor.

---

## 4 · BEKLENEN KAZANÇ

### 4.1 Disk — 101 MB `[DOĞRULANDI]` (kaynak: Volkan'ın `pg_indexes` ölçümü)

| | önce | sonra |
|---|---:|---:|
| `device_telemetry` indeks toplamı | 701 MB | **600 MB** |
| tablonun toplam ayak izi (veri 342 + indeks) | 1.043 MB | **942 MB** |
| indeks alanının kazanılan payı | — | **%14,4** |

Disk ömrüne etkisi `[VARSAYIM]` — `docs/HAK61-SAGLIK.md` § 10'un büyüme
hesabıyla (34.147 satır/gün), gerçek boyutlarla güncellenmiş:
611 bayt/satır × 34.147 = **~20,9 MB/gün**. 101 MB ≈ **~5 gün** ek ömür.

> ⚠️ Bir düzeltme: § 10'daki tahminim indeksleri 430 MB sanıyordu, gerçek
> 701 MB. Veri tarafı iyi tutmuştu (375 tahmin ↔ 342 gerçek), indeks tarafı
> şişkinlik yüzünden **%63 eksik** çıktı. Disk projeksiyonu 40 gün değil,
> **~31 gün** olmalıydı; 093 sonrası ~36 gün.

### 4.2 Yazma yükü — "1/9" değil, **~%9,9** `[VARSAYIM]`

"1/9" (%11,1) sezgisi indeks SAYISINDAN geliyor. Ama bu tablodaki indekslerin
çoğu **kısmi** — bir satır, ancak `WHERE` koşulunu sağlıyorsa o indekse
girer. Ölçülmüş seçicilikler (28.08, canlı) ağırlık olarak kullanıldığında:

| indeks | koşul | satır oranı |
|---|---|---:|
| PK `id` | her satır | 1,000 |
| `vehicle_recorded` (unique) | her satır | 1,000 |
| `device_recorded` | her satır | 1,000 |
| `fuel_volume` (039) | `fuel_volume_l not null` | 0,347 |
| `fuel_pct_time` (049) | `fuel_level_pct not null` | 0,639 |
| `fuel_volume_time` (049) | `fuel_volume_l not null` | 0,347 |
| `vehicle_odo` (053) | `odometer_km not null` | 0,844 |
| `vehicle_fuel_pct` (053) | `fuel_level_pct not null` | 0,639 |
| **`fuel` (ELLE) — DÜŞÜYOR** | `fuel_level_pct not null` | **0,639** |
| `recorded_brin` (090) | her satır, ama BRIN | ~0 (blok özeti) |

```
btree girdisi / satır   önce 6,455   →   sonra 5,816
kazanç                  0,639 / 6,455 = %9,9
günlük                  34.147 satır × 0,639 ≈ 21.820 daha az indeks girdisi
```

⚠️ Üç kayıt:
1. Bu **indeks GİRDİSİ** sayısıdır, CPU ya da G/Ç zamanı değil. Gerçek
   kazanç sayfa bölünmelerine ve WAL hacmine bağlı — ölçülmedi `[BİLMİYORUM]`.
2. Tablo, benim depodan türettiğim indeks listesine dayanıyor ve § 2.3'teki
   sayım tutarsızlığı çözülmedi. 1a envanter sorgusu koşulunca güncellenmeli.
3. Yazma azalması, indeks bakımının azalmasıdır; toplam DB yükünün içindeki
   payı ayrıca ölçülmedi.

### 4.3 Okuma tarafı — kayıp YOK

9.198 tarama kalan indekse gider. Plan **değişmez**, çünkü tanım birebir
aynı (§ 1'in şartı bu). İki özdeş indeks tutmanın hiçbir okuma faydası yok:
planlayıcı ikisinden birini keyfî seçiyor, `idx_scan` sayılarının
(9.198 ↔ 29.243) anlamı da bu.

### 4.4 Sayılmayan kazanç: şema hizası

Düşürme sonrası canlı HAK61'in `device_telemetry` indeks kümesi
`db/install/hak61-full.sql` ile hizalanır. Bugün fazladan, belgelenmemiş bir
nesne taşıyor — ve bu projede "canlıda var, repoda yok" tam olarak
`tank_capacity_l` vakasının başlangıcıydı.

---

## 5 · GERİ ALMA

Migration'ın 3. bölümünde tam cümle yazılı, provada koşturuldu ve geçerli
indeks ürettiği doğrulandı:

```sql
create index concurrently if not exists idx_device_telemetry_fuel
  on public.device_telemetry (vehicle_id, recorded_at)
  include (fuel_level_pct, odometer_km)
  where fuel_level_pct is not null;
```

⚠️ İşlem bloğuna KOYMA, tek başına çalıştır. Yarıda kalırsa indeks INVALID
kalır; kontrol ve temizlik de migration'da yazılı.

> Geri almak isteyeceğim bir senaryo bilmiyorum: kalan indeks aynı tanımı
> taşıdığı için hiçbir sorgu planı bozulamaz. Bölüm "her migration'ın geri
> dönüşü yazılı olsun" kuralı için var.

---

## 6 · MUHAFIZ

`scripts/check-install-sql.mjs` (K1) her migration dosyasının ya `ORDER`da ya
`HARIC`te olmasını şart koşuyor. 093 **`HARIC`e** eklendi, gerekçesiyle.

**Neden `ORDER` değil:** düşürdüğü indeksi hiçbir migration yaratmıyor, yani
yeni bir kiracıda o indeks zaten hiç oluşmuyor — dosya sıfırdan kurulumda
no-op olurdu. Ayrıca `set local lock_timeout` içeriyor ve kurulum dosyasının
tek büyük işleminde koşması o ayarı bütün kuruluma taşırdı.

`HARIC` seçilmesinin ikinci faydası: `build()` çıktısı değişmediği için K2
(tazelik) tetiklenmiyor, dört büyük kurulum dosyasının yeniden üretilmesine
gerek kalmıyor. Ölçüldü — K2 dördünde de "güncel" diyor.

```
✓ kurulum SQL muhafızı: 94 migration · 2 müşteri dosyası · 4 denetim geçti.
  K1 ✓ 94 migration dosyasının hepsi kapsandı (90 kurulumda · 4 gerekçeli hariç)
  K2 ✓ sendigo-full.sql · galzura-full.sql · iki hizalama dosyası — hepsi güncel
  K3 ✓ tek transaction · K4 ✓ sızıntı yok
```

---

## 7 · DOĞRULAMA ÖZETİ

| Adım | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **0 hata** (bkz. not) |
| `lint:install-sql` | **GEÇTİ** — 94 migration, 4 gerekçeli hariç |
| 11 diğer muhafız | **GEÇTİ** |
| `lint:test-filters` | **taban değişmedi** — çıktı bayt bayt aynı (`auto-shift.ts:825`) |
| SQL sözdizimi + davranış | **PostgreSQL 15.19'da koşturuldu**, konteyner silindi |
| Karar sorgusu negatif sınaması | **9/9 fark yakalandı**, kontrol vakası `DÜŞÜR` |

> Not: bu tur SQL + betik yorumu dışında TypeScript'e dokunmadı; `build`
> bir önceki turda (kolon daraltma) 0 ile koştu ve o turdan beri `.ts`
> değişikliği yok. `gen-install-sql.mjs` bir `.mjs` betiği, Next derlemesine
> girmiyor — `lint:install-sql` onu zaten çalıştırıyor.

---

## 8 · ÇALIŞTIRMA SIRASI (Volkan)

1. Migration'daki **1a envanter** sorgusunu koştur → tam indeks listesini gör,
   § 2.3'teki sayım tutarsızlığını çöz.
2. Migration'daki **1b karar** sorgusunu koştur.
3. **`karar` sütunu `DÜŞÜR` demiyorsa DUR** ve hangi kontrolün `false`
   döndüğünü bildir. Migration'ın 2. bölümünü çalıştırma.
4. `DÜŞÜR` çıkarsa 2. bölümü çalıştır. `55P03` alırsan hiçbir şey olmamıştır —
   birkaç dakika sonra tekrar dene. Üst üste 3 kez alırsan
   `pg_stat_activity`de uzun koşan bir sorgu var demektir.
5. Dosyanın sonundaki "beklenen hâl" sorgularıyla doğrula — özellikle
   `to_regclass('public.idx_device_telemetry_vehicle_fuel_pct')` **NULL
   OLMAMALI**.
