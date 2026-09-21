# Takograf uçları — Faz C-3

091'in arşivi (`takograf_dosyalari` + `_faaliyetleri` + `_olaylari`) ve okuyucu
servisi paneldeydi; mobil tarafta **hiçbir uç yoktu**. Bu tur dördünü açıyor.

| Yol | Ne yapar | Kapı |
|---|---|---|
| `POST /api/mobile/takograf` | multipart `.ddd` yükler (≤5 MB) | 🔴 **yalnız yönetici** |
| `GET /api/mobile/takograf` | süzgeçli, sayfalı liste | yalnız yönetici |
| `GET /api/mobile/takograf/[id]` | künye + faaliyet + olay | yalnız yönetici |
| `POST /api/mobile/takograf/[id]/yeniden-oku` | arşivden yeniden ayrıştır | yalnız yönetici |
| `GET /api/mobile/takograf/[id]/indir` | imzalı URL (300 sn) | yalnız yönetici |

**DELETE yok** — ne uçta ne veritabanında. `trg_takograf_dosya_silinemez`
(HK091) koşulsuz reddediyor: *"arşiv ürünün satış vaadi; denetimde bu kayıttan
indirilecek."*

Kapı panelin kuralının aynısı: *"Takograf indirmesi ŞİRKET KARTI sahibinin
yükümlülüğüdür — bir şirket uyum işi, filo operasyonu değil."* Şef ve şoför
**403 `admin_required`**, okumada da.

---

## 1 · Ayrıştırma senkron kaldı — ölçülmüş karar

Görev *"35 sn riski: Vercel süre sınırında kalmıyorsa ayrıştırmayı asenkron
yap"* diyordu. Cümlenin kendisi koşullu: **sığıyorsa senkron kalır.**

`dosyaYukle` üçüncü adımda okuyucu servise senkron gidiyor
(`SERVIS_ZAMAN_ASIMI_MS = 35_000`) ve **panel bugün böyle çalışıyor.**
Asenkrona geçmek üç yeni parça isterdi: `bekliyor` satırlarını tarayan bir cron
ucu, `docs/CRON-KAYITLARI.md` kaydı ve o cron'u çalıştıracak bir zamanlayıcı —
üçü de bu turun kapsamı dışında. Aynı işi yapan iki yüzeyi iki farklı zamanlama
modeline bölmek, mobilin panelden sessizce ayrışması olurdu.

Alınan tek önlem: **`export const maxDuration = 300`** (yükleme ve yeniden-oku
uçlarında). Varsayılan süreye güvenmek, bir gün sessizce kesilen bir isteğe
dönüşürdü — dosya arşivde, satır `bekliyor`da kalır, istemci "yükleme
başarısız" sanardı. Mobil uçlar arasında `maxDuration` yazan ilk uçlar bunlar;
emsal `app/api/cron/aylik-metrik/route.ts`.

**Ölçüldü** (galzura-demo, yerel koşum): yükleme uçtan uca **1.516 ms** —
servis yapılandırılmamış hâlde. Canlı hostta servis çağrısı da dahil.

---

## 2 · Upload-core istisnası: kaldırılmadı, **bedeli ödendi**

`scripts/check-dosya-yukleme.mjs` D1 istisnasını gerekçesiyle yazmıştı ve
şunu ekliyordu: *"o yolda yetim koruması YOK … Takograf yükleme sırası
ÜÇÜNCÜ; o tur geldiğinde bu istisna kaldırılacak."*

İstisna **kalıyor**, çünkü kaldırmak bir kuralı kırardı:

| | takograf | upload-core |
|---|---|---|
| yol deseni | `yyyy/mm/uuid.ddd` (kişi klasörü **yok**, 091 kararı) | `{workerId}/yyyy/mm/uuid.ext` |
| tip | `.ddd` + `application/octet-stream` | görüntü MIME'ları |
| tekillik | kendi SHA256'sı + `bekliyor` durum makinesi | yok |
| yazma düşerse | **dosya kalır** (091: "ayrıştırılamasa bile SİLİNMEZ") | dosya **silinir** |

Son satır doğrudan çelişki gibi duruyor — değil, çünkü ayrım **adım bazında**:

- **2. adım (satır yazma) düşerse** → upload-core kuralı geçerli: ortada bir
  KAYIT yok, dolayısıyla saklanacak bir kanıt da yok. Silinen şey delil değil,
  hiç kaydedilmemiş bir dosya. ✅ **bu turda eklendi**
- **3. adım (servis/ayrıştırma) düşerse** → takograf kuralı geçerli: dosya da
  satır da yerinde kalır, durum `bekliyor`/`basarisiz` olur.

Yani ödenen bedel: `lib/takograf-db.ts` satır yazma dalında artık
`dosyaSil(TAKOGRAF_KOVA, [yol])` çağırıyor (**çekirdeğin** silme fonksiyonu —
ikinci bir `storage.remove` yazılmadı, D2 hâlâ tek kapı görüyor) ve sonucu
`dosyaTemizlendi` ile taşıyor.

**Hız sınırı uçta**, çekirdeğin kendi `hizSiniriHarca`/`hizSiniriIadeEt`
fonksiyonlarıyla. Sıra tartışma dışı:

```
doğrulama → fren → yazma
```
- Bozuk istek (uzantı/boyut) kotayı **yemez** (ölçüldü: önce 1 → sonra 1).
- Sunucu kusuru kotayı **iade eder**.
- `409 zaten_yuklu` kotayı **iade etmez** — istek geçerliydi, iş yapıldı. Aksi
  hâlde aynı dosyayı sonsuz kez göndermek bedava olurdu.

---

## 3 · 🔴 `?sofor=` ve `?arac=` verilmedi — süzgeç çalışmazdı

**ÖLÇÜLDÜ (21.09.2026):** `takograf_dosyalari.worker_id` ve `vehicle_id`
kolonları 091'de *"TÜRETİLMİŞ BAĞ — çözülebilirse"* diye tanımlı, ama
**hiçbir kod yolu onları yazmıyor** — ne `dosyaYukle`'nin insert'i ne
`ayristirVeYaz`'ın update'i. galzura-demo'daki dosyalarda ikisi de `null`.
Aynı kusur `takograf_faaliyetleri`nde de var: 155 satırda `worker_id` dolu
olan **0**.

Yani `?sofor=<uuid>` süzgeci **daima 0 satır** döndürürdü: çalışıyor görünen,
hiçbir zaman eşleşmeyen bir süzgeç. Onun yerine **gerçekten yazılan** kolonlar
verildi:

```
?tur=kart|vu   ?kart=<kart_no>   ?plaka=<arac_plaka ∪ arac_vin>
?yukleyen=<uuid>   ?donem=YYYY-MM   ?limit= ?offset=
```

`?sofor=`/`?arac=` gönderilirse **sessizce yok sayılmaz**: 400 + `sebep:
"kimlik_bagi_yok"` + geçerli adların listesi. Kimlik bağının kurulması ayrı bir
iş (açık kalem, §6).

`?donem=YYYY-MM` **örtüşme** arar (`donem_bas ≤ ayBit AND donem_bit ≥ ayBas`) —
"dönemi tam o ay olan" demek 28 günlük kart dosyalarının ay sınırını aşan
çoğunu elerdi. Dönemi `null` olan dosyalar bu süzgeçte düşer ve yanıt bunu
**`donemsizGizlendi: <sayı>`** ile açıkça söyler.

---

## 4 · 🔴 PostgREST 1000 satır tavanı — panelin sessiz kusuru

**ÖLÇÜLDÜ (galzura-demo):** 1.270.885 satırlık bir tabloda limitsiz `select`
**1000** satır döndü; `.limit(40000)` de **1000** döndü. Tavan istemciden
aşılamıyor.

Panelin `faaliyetler(dosyaId, limit = 5000)` çağrısı bu yüzden 1000'de sessizce
kırpıyor. 091 başlığı *"bir VU dosyası 3.430 faaliyet satırı üretir (365
günlükte ≈13.000)"* diyor — kırpma **gerçek**, yalnız demo dosyası 155 satırlık
olduğu için bugüne dek görülmemiş. `satirSayimlari()` de aynı tuzakta: listedeki
tüm dosyaların faaliyet sayımını toplamda 1000'de kesiyor.

Mobil uçlar o tuzağa düşmüyor:
- **Liste satırında faaliyet/olay sayısı YOK** — yanlış bir sayı göstermektense
  hiç göstermemek. Doğru sayı künye ucunda.
- **Künye**: satırlar `.range()` ile sayfalı (`?fLimit`/`?fOffset`,
  `?oLimit`/`?oOffset`), toplamlar `count: "exact", head: true` ile ayrı
  okunuyor — tavandan bağımsız (gövde hiç dönmez, `Content-Range` okunur).

⚠️ **Panelin kusuru bu turda düzeltilmedi** — panel kodu hiç değişmedi; onu
değiştirmek görünmeyen bir davranış değişikliği olurdu. Açık kalem (§6).

---

## 5 · Kanıt

### Canlı — galzura-demo, gerçek giriş (**54/54 ✓**)

```bash
ENV_FILE=.env.galzura-demo node --import ./scripts/ts-server.mjs \
  scripts/verify-takograf-uclari.mjs
```

| adım | rol | kod |
|---|---|---|
| `POST /auth/login` | yönetici | **200** |
| `GET` / `POST /takograf` | jetonsuz | **401** |
| `POST /takograf` | **şoför** | **403** `admin_required` |
| `GET /takograf` | **şoför** | **403** |
| `POST` (.pdf) | yönetici | **400** `uzanti_yanlis` |
| `POST` (0 bayt) | yönetici | **400** `bos_dosya` |
| `GET ?sofor=` | yönetici | **400** `kimlik_bagi_yok` |
| `POST` (damgalı .ddd) | yönetici | **201** · 1.516 ms |
| `GET ?tur=vu&limit=5` | yönetici | **200** |
| `GET ?donem=2026-01` | yönetici | **200** · `donemsizGizlendi:1` |
| `GET /{id}` | yönetici | **200** · sayım `count:exact` |
| `POST` (orijinal) | yönetici | **409** + `mevcutId` |
| `POST /{id}/yeniden-oku` | yönetici | **200** |
| `GET /{id}/indir` | yönetici | **200** · 300 sn |
| imzalı URL (Storage) | — | **200** · 98.598 bayt, **sha birebir** |
| `POST` #11 | yönetici | **429** · `Retry-After 56` |

**Fikstür** depoda yoktu (`verify-takograf.mjs` onu `TAKOGRAF_DDD` env
yolundan okuyor, o dizin bu makinede yok). galzura-demo'nun **kendi
arşivinden** imzalı URL ile indirildi: `vu-004-full.ddd`, 98.590 bayt,
sha256 `e9f6271b…ee8c` — DB satırıyla birebir, ilk baytlar `v1` → `vu`.
Damgalama `verify-takograf.mjs:181-188` tekniği (sona 8 bayt).

**Kalıcı satır: 1.** `trg_takograf_dosya_silinemez` koşulsuz, yani yüklenen
satır silinemez. Tur buna göre kuruldu: damga **güne bağlı**, aynı gün ikinci
koşum 409 alır ve yeni satır açmaz; 409/429/liste/künye/yeniden-oku/indir
kanıtlarının hepsi **sıfır** kalıcı satırla alınır. Fren turu ölçüldü:
`önce 2 → sonra 2`. Geçici şoför hesabı ve kota sayacı geri alındı.

⚠️ `.env.galzura-demo`da `TAKOGRAF_URL`/`TAKOGRAF_SECRET` **yok** → yerel
koşumda `servisYapilandirildi:false`, satır `bekliyor`da kalıyor. Bu bir arıza
değil, bu makinede o sırrın olmaması. Ayrıştırmanın gerçekten çalıştığı canlı
host turunda ölçülüyor.

### Muhafız

`npm run lint:takograf-uclari` — `verify` zincirinde. **Arıza enjeksiyonuyla
sınandı, altı regresyonun altısını da yakalıyor:** kapı gevşetme · fren
kaldırma · yetim koruması silme · DELETE handler ekleme · ham `.limit()`
sızdırma · doğrulamayı frenden sonraya alma.

`tsc` 0 hata · ESLint **42 problem — öncesiyle aynı** · `npm run build` yerelde
Google Fonts çözümlemesinde düşüyor (önceki turda `git stash` ile ölçüldü: temiz
ağaçta aynı hatayla düşüyor, değişiklikten bağımsız).

---

## 6 · Açık kalanlar

- 🔴 **`worker_id` / `vehicle_id` bağı hiç kurulmuyor** (dosya ve faaliyet
  tablolarında). Kurulursa `?sofor=`/`?arac=` süzgeçleri ve
  `faaliyetler()`'in isim/plaka join'i anlam kazanır; bugün o join ölü kod.
- **Panelin 1000 satır kırpması** (`faaliyetler`, `satirSayimlari`) bu turda
  düzeltilmedi.
- **Asenkron ayrıştırma** (cron ile `bekliyor` tarama) kurulmadı — gerekçesi §1.
- `.ddd` fikstürü depoda yok; `verify-takograf-uclari.mjs` onu
  `TAKOGRAF_FIKSTUR` env'inden ya da varsayılan scratchpad yolundan okuyor.
