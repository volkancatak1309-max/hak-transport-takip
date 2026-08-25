# Vardiya düzeltme — yönetici yetkisi + denetim izi

**Migration 087 · `shift_edit_log` · `/admin` (Aktif Vardiyalar + düzenleme)**

> Bu belge ölçümlerin kaydıdır. Sayılar 25.08.2026'da HAK61 canlı verisinde
> ölçüldü.

---

## 0 · Bu bir DENETİM kaydıdır

Avusturya iş müfettişliği AZG raporunu okuyor. O raporu besleyen üç alan —
`started_at`, `ended_at`, `break_minutes` — yöneticinin değiştirebildiği
alanlar. Düzeltme **yasak değil**; gerçek hatalar düzeltilebilmeli. Yasak olan
**sessizce üzerine yazmak**.

---

## 1 · Bugün ne vardı (ÖLÇÜLDÜ)

| Soru | Cevap |
|---|---|
| Düzenleme var mı? | **Var** — `editEntryAction`, `requireAdmin` kapılı. Şoför erişemiyor. |
| Hangi alanlar? | başlangıç, bitiş, mola, start/end km, plaka, not, paket sayıları |
| `shift_edit_log` kullanılıyor mu? | **Evet** — canlıda **13 satır**, hepsi `started_at` |
| Ne kaydediyor? | `time_entry_id · changed_at · changed_by · field · old_value · new_value` |
| Yeterli mi? | **Hayır — SEBEP yok.** "Bu çalışma saati neden değişti?" cevapsız. |
| Toplu kapatma var mı? | Liste var (`/admin` → Aktif Vardiyalar), tek tek kapatma var |

### 🔴 İZ BIRAKMAYAN MUTASYON

`adminCloseShiftAction` bir vardiyanın `ended_at` ve `end_km` alanlarını
yazıyor ama `shift_edit_log`a **hiçbir şey** yazmıyordu. Yani yöneticinin
kapattığı vardiya, AZG raporunu besleyen alanı değiştirdiği hâlde denetim
izinde görünmüyordu. `editEntryAction` iz bırakırken kapatmanın bırakmaması,
aynı tabloya iki farklı standarttı.

---

## 2 · Sorunun büyüklüğü (HAK61 canlı)

- **9 vardiya açık**, 7'si 24.08'den beri (37–39 saat).
- **18–26.08 arasında 20 saatten uzun kapanmış 14 vardiya** — en uzunu
  **52,64 saat** (Mehmet Durdu, 19→21.08).
- Bir şoför notu: *"vardiyayi kapatmayi unutmusum"* (Resul Demir, 21.08).
- Tipik desen: Muhammed Copur 24.08 07:34 → 25.08 04:30 (**20,94 sa**), hemen
  ardından 25.08 04:30'da **yeni vardiya** açmış — yani vardiyayı ertesi
  sabah, yeni vardiyayı açarken kapatmış.

⚠️ **Bildirilen "Can Özsavaş" HAK61 kadrosunda yok.** 32 aktif personel
tarandı; en yakın adlar Sinan Özcan ve Sercan Kalkanli. 23-26.08 arasındaki
tüm vardiyalar Viyana saatiyle listelendi, 20:31→19:55 deseni HAK61'de yok. O
vaka **başka bir kiracıda** olmalı — Sendigo/galzura-demo service-role
anahtarları bu makinede yok, oralarda ölçüm yapılamadı. Sorunun **sınıfı**
HAK61'de fazlasıyla doğrulandı ve 087 üç kiracıda da aynı işi görür.

---

## 3 · Türetilmiş sayılar yeniden hesaplanıyor mu — EVET, kendiliğinden

**ÖLÇÜLDÜ:** aranan önbellek tablolarının hiçbiri yok — `surucu_skorlari`,
`sofor_skor_ozet`, `vardiya_ozet`, `gunluk_ozet` → **TABLO YOK**.

Çalışma saati, km, skor, maliyet, AZG ve mevzuat kalan süresi **hepsi istek
anında `time_entries`ten** hesaplanıyor. Düzeltme kendiliğinden yayılır;
087'nin yeniden hesaplama için bir şey yapmasına gerek yok.

QA'da tek düzeltmenin beş yüzeyde birden ölçüldüğü hâli:

```
ÖNCE : çalışma 23,40 sa · km 180 · AZG ağır ihlal 3 · maliyet 48 sa/530 km/1.472 €
SONRA: çalışma  8,50 sa · km  90 · AZG ağır ihlal 2 · maliyet 44,5 sa/440 km/1.325,48 €
```

⚠️ **TEK İSTİSNA VE BİLİNÇLİ:** `mevzuat_uyarilari` (086) bir **defterdir**.
Gönderilmiş bir bildirim, dayandığı vardiya sonradan düzeltilse de silinmez —
gönderilmemiş gibi görünmesi denetim izini bozardı. Defter *"o an ne
biliniyordu"*yu saklar, *"şimdi ne doğru"*yu değil.

---

## 4 · 087 ne ekliyor

| Kolon | Ne için |
|---|---|
| `reason` | Düzeltmenin **sebebi**. Yeni yollarda zorunlu; 087 öncesi satırlarda `null` |
| `edit_group` | Tek düzeltmenin alan satırlarını bağlar — sebep alan başına değil **düzeltme başına** |
| `kaynak` | `duzeltme` · `kapatma` · `km` — hangi işlem yazdı |

**`reason` neden `not null` değil:** canlıda sebep alanı olmadan yazılmış 13
satır var. `not null` migration'ı düşürürdü; geriye dönük sebep uydurmak ise
denetim kaydına yalan yazmak olurdu. **Zorunluluk kodda**: sunucu eylemi
sebepsiz düzeltmeyi ve sebepsiz kapatmayı reddeder (asgari 3 karakter).
Ekran eski satırlar için *"sebep kaydedilmemiş (087 öncesi)"* yazar — boş
bırakmak, sebebin sorulmadığı bir dönemi sebebi olan bir düzeltmeymiş gibi
gösterirdi.

**087 uygulanmamış kurulumda iz kaybolmaz:** yazıcı `PGRST204` görürse
kolonsuz biçimde yeniden dener. Sessizce hiç yazmamak, denetim kaydını
migration gecikmesine kurban etmek olurdu.

---

## 5 · AZG raporunda satır bazlı işaret

Rapor eskiden yalnız bir **toplam dipnot** taşıyordu: *"bu dönemde N kayıt
manuel düzeltildi"*. Hangi bulgunun düzeltilmiş veriye dayandığını
söylemiyordu. Denetimde okunan şey **satırdır**.

Artık her bulgu `edited` bayrağı taşıyor ve PDF'te tarihin önüne `*` basılıyor;
dipnot da bunu açıklıyor. İşaret **tekil vardiya bulgularında** olduğu gibi
**gün, hafta ve dinlenme boşluğu** toplamlarında da var — bir toplama giren
vardiyalardan biri düzeltildiyse o satır işaretli.

> `*` bilerek ASCII: react-pdf'te gömülü yazı tipi her Unicode sembolü
> taşımıyor ve eksik glif **sessizce boş** basılırdı (rapor Tur 3'ün font dersi).

### Canlı ölçüm — rapor bozulmadı, bilgi arttı

```
2026-07, ÖNCE (main)     : 239 vardiya · 28 şoför · 264 bulgu (30/190/44)
                           düzeltilen 13 · İŞARETLİ bulgu 0
2026-07, SONRA (087 dalı): 239 vardiya · 28 şoför · 264 bulgu (30/190/44)
                           düzeltilen 13 · İŞARETLİ bulgu 21
```

Sayılar birebir aynı; **21 bulgunun düzeltilmiş kayda dayandığı** artık
görünüyor.

---

## 6 · Kapanmamış vardiyalar

Liste zaten `/admin` → **Aktif Vardiyalar** kartında; yeni bir ekran
açılmadı — ikinci bir yüzey aynı gerçeği iki yerde anlatırdı.

087 ile eklenen:

- **24 saati aşan kayıtlar listenin başında** ve `kapanmamış` rozetli. Eşik
  mevzuat motorununkiyle (086 `VARDIYA_BAYAT_MS`) **aynı** — iki ekran aynı
  satıra aynı adı versin.
- Kapatma diyaloğunda **sebep zorunlu**.
- Kapatma artık **iz bırakıyor** (`kaynak='kapatma'`).

⚠️ Kapatmada `end_km` ölçülemezse **iz satırı yazılmaz ve 0 uydurulmaz**:
`resolveEndKm` bayat odometre okumasını reddediyor (6 saat sınırı). QA'da
28 saatlik okuma bilerek kullanıldı ve km `null` kaldı.

---

## 7 · Prova (QA harness)

```bash
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < db/migrations/087_vardiya_duzeltme_izi.sql
docker exec -i hak-qa psql -U postgres -d hak -c \
  "grant all on all tables in schema public to service_role, anon, authenticated;"
docker exec -i hak-qa psql -U postgres -d hak -q -v ON_ERROR_STOP=1 < <tohum>.sql

set -a; . <qa env>; set +a
npm run verify:vardiya-duzelt      # 37 iddia
```

### Bu provanın yakaladığı kusurlar

1. **"AZG'de satır işareti" iddiası BOŞ geçiyordu.** Tek kaydı düzeltince
   rapor tamamen temizlendi (0 bulgu) ve *"0 işaretli / 0 toplam"* iddiayı
   geçirdi. Düzeltildikten **sonra da ihlal kalan** bir satır eklendi
   (30 sa → 13 sa, 12 sa tavanını hâlâ aşıyor) ve yanına hiç düzeltilmeyen
   bir satır kondu; artık `1 işaretli / 2 bulgu` ölçülüyor.
2. **Tohum UUID'leri geçersizdi.** `e1000000-0000-0000-…` Postgres'e giriyor
   ama `z.string().uuid()` reddediyor (sürüm/variant nibble'ları). Betik
   "Invalid UUID" ile düşüyordu — ürün kusuru değil tohum kusuru; gerçek
   id'ler `gen_random_uuid()` ile üretiliyor ve her zaman v4.

---

## 8 · Kapılar

| İşlem | Kapı |
|---|---|
| Vardiya düzeltme | `requireAdmin` — şoför 403 (QA'da `NEXT_REDIRECT` ile doğrulandı) |
| Kapanmamış vardiyayı kapatma | `requireAdmin` + **sebep zorunlu** |
| Düzeltme geçmişini okuma | `getShiftEditsAction` (yönetici) |

**İz sessizce üzerine yazılmaz:** ikinci düzeltme birinciyi ezmez, satır
ekler; her düzeltme kendi grubunu ve kendi sebebini taşır (QA: 4 → 5 satır,
2 grup).
