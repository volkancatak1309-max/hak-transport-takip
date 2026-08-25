# Sefer bazlı kârlılık — gelir tarafı

**Migration 085 · `/admin/karlilik` · `lib/karlilik.ts` + `lib/karlilik-db.ts`**

Maliyet motoru 076/077 ile hazırdı (€/km, €/paket). Eksik olan **gelir**di.
Bu modül gelir tarafını ve **müşteri** eksenini kuruyor.

> Bu belge ölçümlerin kaydıdır. Sayılar 25.08.2026'da HAK61 canlı verisinde
> ölçüldü; eşik değiştirmeden önce yeniden ölçün.

---

## 0 · Bu ekranın ürettiği sayı NET KÂR DEĞİL

```
katkı payı = gelir − (atfedilebilen yakıt + atfedilebilen işçilik)
```

Araç sabit gideri (€/gün) **bilerek dışarıda**. Gerekçe §3'te. Panel bu
farkı hem cümleyle hem ayrı bir kartla söylüyor; o kart kaldırılırsa ekran
yalan söylemeye başlar.

---

## 1 · Sektörde tarife nasıl kuruluyor (ÖLÇÜLDÜ)

**Tek bir standart yok**; taban sözleşmenin türüne göre değişiyor ve ciddi
TMS'ler taban TİPİNİ bir alan olarak tutuyor.

| Kaynak | Ne diyor |
|---|---|
| [nuVizz Last Mile TMS — Billing & Driver Pay](https://nuvizz.com/last-mile-tms-billing-driver-pay-automation/) | Müşteri faturalamasında *per stop, per route, mileage, volumetric, zone-based, dimensional weight*; şoför hakedişinde *per-stop, per-route, weight- or volume-based, piece-rate, hourly*. Accessorial ve yakıt sürşarjı **ayrı kalem**. |
| [Rocky Transport — Last Mile Delivery](https://rockytransportinc.com/blog/last-mile-delivery-trucking-opportunities/) | Son-mil faturası "by the package, by the route, or by the day" — klasik yükün "by the mile"ından bilerek farklı. |
| [CO3 — Road Freight Cost per Km Europe](https://co3.io/news/road-freight-cost-per-km-europe) | Tam yük Avrupa'da km ekseninde: 2025/26 için **1,10–1,90 €/km**; kısa mesafede sabit giderler daha az km'ye yayıldığı için 200 km'de 1,80–2,50 €/km. |

**KARAR — dört taban:** `sefer` (götürü) · `km` · `paket` · `saat`. Bu dördü
kaynakların *per-route / per-mile / piece-rate / hourly* dörtlüsünün birebir
karşılığı.

**Ağırlık ve hacim BUGÜN YOK:** ne `seferler` ne `sefer_duraklari` ağırlık
taşıyor. Ölçemediğimiz bir tabanı form alanı olarak sunmak, kullanıcıya
olmayan bir kesinlik vaat ederdi. CHECK genişletilebilir — şema hazır, veri
değil.

---

## 2 · Müşteri: yeni tablo, `geofences` genişletmesi değil

**CANLI ÖLÇÜM:** `geofences` toplam **2 satır**, ikisi de `purpose='depot'`.
**`purpose='customer'` sıfır satır.** Korunacak müşteri verisi yok — seçim
geçmişe değil modele göre yapıldı.

Bölge bir **yer**dir, müşteri bir **muhatap**. Bire bir değil:

- bir müşterinin birden çok sahası olur (üç depo, tek fatura adresi);
- bir saha zamanla başka müşteriye geçer;
- müşterinin hiç sahası olmayabilir (adrese teslim, geofence yok).

`geofences`i muhatap tablosu yapmak bu üçünü tek satıra sıkıştırıp "hangi
müşteri" sorusunu cevaplanamaz hâle getirirdi. 064 aynı ayrımı bir kez
yapmıştı: `purpose` **davranış**, `category` **etiket**.

**Bağ üç yerde, üçü de nullable:**

| Kolon | Anlamı |
|---|---|
| `seferler.musteri_id` | Seferin parasını kim ödüyor — **karar**, türetme değil |
| `sefer_duraklari.musteri_id` | Çok duraklı seferde durak kimin (082) |
| `geofences.musteri_id` | Bu saha kimin (ziyaret raporunu müşteriye bağlar) |

---

## 3 · Maliyet sefer eksenine iner mi (en kritik ölçüm)

Maliyet motoru **vardiya** ekseninde: dört payda (km, saat, araç-günü, paket)
`time_entries`ten toplanıyor. Sefer ekseni için her paydanın ayrı ayrı
ölçülebilir olması gerekiyordu.

### KM — odometre penceresi, telemetri integrali DEĞİL

İki aday, ikisi de canlı veride ölçüldü (14 gün, araçlı+kapanmış vardiya
pencereleri, HAK61):

| Yöntem | Ölçülen/örnek | Sayaca oran (medyan) |
|---|---|---|
| **Odometre farkı (uçtan uca)** | 13/15 | **1,032** |
| Telemetri integrali | 15/15 | 0,871 |

Telemetri integrali **her** pencerede eksik saydı (medyan −%13, bir pencerede
−%53) çünkü cihaz sessizliğinde köprü kurmuyor (`GAP_MAX_MS`) — bilinçli
olarak eksik sayan bir yöntem. **Maliyet için bu zararlıdır:** eksik km →
eksik yakıt → şişmiş kâr.

**Kenar eşiği:** odometre okumasının pencere kenarına uzaklığı ölçüldü
(40 pencere / 80 uç): medyan **0,1 dk** · p75 4,2 dk · p90 249,8 dk.

| Eşik | Uçların kaçı geçer |
|---|---|
| 1 dk | %61,8 |
| **15 dk** | **%81,6** |
| 60 dk | %85,5 — +3,9 puan için 13 saate kadar bayat okuma |

**KARAR: 15 dk.** 60 dk'nın getirisi marjinal, riski büyük — pencereden
saatler uzaktaki bir okuma BAŞKA bir seferin km'sini içerir.

15 dk eşiğiyle canlı kapsama (60 pencere): **%61,7 ölçüldü** · 21 kenar bayat
· 2 uç okuması yok · 0 negatif fark. Ölçülenlerde oran medyan 1,025.

> ⚠️ Ölçülemeyen pencere **`null`** döner, 0 değil. "0 km'lik sefer" bedava
> sefer gibi görünür ve kârı sonsuza şişirir.

### İşçilik — seferin kendi penceresi

`yolda_at` → `tamamlandi_at` × €/saat. **AZG günlük tavanı (12 sa) burada da
uygulanır** — vardiya motorundaki `hourCapShifts` ile aynı gerekçe: geç
kapatılmış kayıt çalışma değildir.

### Araç sabit gideri — **ATFEDİLEMEZ**

€/gün bir **gün** birimidir. Bir günün sabit giderini o günün seferlerine
bölmek — km payı, süre payı, sefer sayısı, hangi anahtarla olursa olsun —
**paylaştırmadır**, ölçüm değil, ve kârlılık sıralamasını sessizce değiştirir.

*"Günde tek sefer varsa tamamını ona yükleyelim"* seçeneği de **reddedildi**:
o zaman bazı seferler sabit gider taşır bazıları taşımaz, seferler birbiriyle
kıyaslanamaz hâle gelir. Kıyaslanabilirlik bu ekranın tek varlık sebebi.

Atfedilemeyen tutar panelde **ayrı kartta**, dağıtılmadan durur.

### Üç ölçüm durumu, üçü de ekranda

| Durum | Anlamı | Ekranda |
|---|---|---|
| `olculdu` | Kalem bu sefer için ölçüldü | Tutar + ölçüm (120 km / 4 sa) |
| `olculemedi` | Atfedilebilir kalem ama bu seferde ölçüm yok | "ölçülemedi" + **sebep** (`kenar_bayat`, `arac_yok`, …) |
| `atfedilemez` | Kalem sefer eksenine inmiyor | "Sabit gider: atfedilemez" |

---

## 4 · Çok duraklı seferde gelir: İKİSİ DE

nuVizz *"fully customized rates at the stop or route level"* diyor — taban hem
durak hem rota düzeyinde tanımlanabiliyor.

**KARAR:** gelir satırı **sefere** bağlıdır, `durak_id` **opsiyoneldir**.

- `durak_id` null → sefer düzeyinde gelir (götürü rota ücreti)
- `durak_id` dolu → o durağın geliri (12 duraklı seferde 12 müşteri)

Seferin toplamı her iki türün toplamıdır; ikisi bir arada kullanılabilir.

> ⚠️ Durak silinirse gelir satırı **silinmez**, yalnız bağı kopar. 083'teki
> takip linkinin aksine ikinci bir `durak_bagli` kolonuna gerek yok: takip
> linki durak ölünce **ölmeliydi**, gelir ölmez — para kazanılmıştır.

---

## 5 · Haftalık aksiyon köprüsü — `musteri_zarar`

084'e **sekizinci kural** ve **üçüncü özne ekseni** eklendi.

- Eşik **sıfır** ve ölçülmesi gerekmez: "gelir atfedilebilen maliyeti
  karşılamıyor" cümlesi filoya göreli değil, aritmetiktir. Filo-göreli bir
  eşik burada yanlış olurdu — az kârlı müşteri zararlı değildir.
- Kapı: **≥3 sefer** (`ZARAR_MIN_SEFER`), pencere 30 gün. Tek seferden
  sözleşme sonucu çıkarmak, zayıf paydadan ortalama üretmenin aynısı.
- Kuralın gördüğü seferler **yalnız maliyeti ölçülmüş** olanlar. Maliyeti
  bilinmeyen sefer "bedava" görünür ve müşteriyi haksız yere kârlı yapar.
- Gerekçe cümlesi **sabit giderin hariç olduğunu söylüyor** — yani gerçek
  zarar daha büyük.
- Taban 350: yakıt sapmasının (400) altında. Yakıt sapması bir **arıza**
  işaretidir ve düzeltmesi filonun elinde; zararlı müşteri bir **sözleşme**
  sorunudur, çözümü karşı tarafa bağlı.

> 🔴 **Kolon eklemek yetmedi, tekil indeks de değişti.** 084'ün indeksi
> `coalesce(worker_id, vehicle_id, '000…')` idi; müşteri kalemlerinin hepsi
> sıfır-uuid kovasına düşerdi ve haftada **yalnız bir** zararlı müşteri
> yazılabilirdi. `coalesce` sırası `ozneKimligi()` ile birebir aynı olmak
> zorunda.

---

## 6 · Prova (QA harness)

```bash
# Yığın: Docker Postgres 16 + PostgREST v12.2.3 + proxy
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < db/install/sendigo-full.sql
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < db/migrations/085_sefer_karlilik.sql
docker exec -i hak-qa psql -U postgres -d hak -c \
  "grant all on all tables in schema public to service_role, anon, authenticated;"
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < <tohum>.sql

set -a; . <qa env>; set +a
npm run verify:sefer-karlilik      # 71 iddia
```

⚠️ QA yığınında yeni tabloya **`grant` şart** — gerçek Supabase'de
`service_role` varsayılan ayrıcalıkla gelir, Docker'da gelmez.

⚠️ `service_role` rolüne **`bypassrls`** verilmeli, yoksa RLS'li tablolar
sessizce boş döner.

### Bu provanın yakaladığı gerçek kusurlar

1. **🔴 Ölçümü yarım müşteri "en kârlı" listesinde 2. sıraya çıktı.** Yakıtı
   ölçülemediği için maliyeti eksikti, katkı payı şişmişti. Bu, bu ekranın
   yapabileceği en zararlı hata — kullanıcı zarar eden bir müşteriyi
   ödüllendirebilirdi. Sıralamaya artık **yalnız ölçümü tam satırlar** girer;
   elenenler `ucDisiOlcumsuz` sayacıyla ekranda görünür.
2. **Gelir satırı eklenebiliyor ama silinemiyordu** (`lint:crud` buldu).
   Yanlış girilmiş bir birim fiyat düzeltilemezse müşteri kârlılığını kalıcı
   olarak bozar. Satırlara düzelt + sil eklendi; düzeltme `created_at` izini
   korur.
3. **"€/km bozulmadı" iddiası BOŞ geçiyordu** — tohumda hiç vardiya yoktu ve
   rapor "0,00 = 0,00 + 0,00" ile geçti. Paydaların dolu olduğu artık ÖNCE
   sınanıyor (12 vardiya · 960 km · 3.082,87 €).
4. **Canlı kıyas kayan pencereyle yapılamaz.** "Son 30 gün" ile ölçünce iki
   koşum 101.070,51 € ve 101.070,64 € verdi; fark koddan değil, akmaya devam
   eden telemetriden. Pencere **sabitlendi**.

---

## 7 · Kapılar

| İşlem | Kapı | Gerekçe |
|---|---|---|
| Kârlılık ekranını görmek | `requireFleetView` | Şef kendi filosunun işini yönetiyorsa görmeli |
| Gelir girmek/düzeltmek/silmek | `requireAdmin` | Gelir bir **muhasebe** kaydı; 084'teki kapatma bir **operasyon** kararıydı |

Müşteri özneli haftalık kalem **filoya bölünmez**: bir müşteri iki filoyla da
çalışabilir, kalemi bir filoya atamak keyfî olurdu. Kârlılık bir filo gerçeği
değil, şirket gerçeğidir.
