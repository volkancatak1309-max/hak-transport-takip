# Teslimat kanıtı ucu — Faz C-2

ePOD'un eksik son halkası. 080 kanıt şemasını, 082 durak bağını, 03.09'daki
fotoğraf ucu dosya yolunu getirmişti; **kanıdın kendisini açan mobil uç yoktu.**

ÖLÇÜLDÜ (21.09.2026): `createTeslimat`ı çağıran tek yer panelin sunucu
eylemiydi (`app/actions/teslimat.ts`). Mobil taraf yalnız *var olan* bir kanıta
fotoğraf ekleyebiliyordu — ve o kanıt ancak panelden açılabildiği için mobil
fotoğraf ucu pratikte kilitliydi.

---

## 1 · Yüzey

| Yol | Ne yapar | Kapı |
|---|---|---|
| `POST /api/mobile/sefer/[id]/duraklar/[durakId]/kanit` | kanıt bırakır + durak durumunu ilerletir | şoför (kendi seferi) **ya da** yönetici |
| `GET` aynı yol | kanıt + foto/imza imzalı URL'leri + bekleyen taslaklar | aynı |
| `POST …/duraklar/[durakId]/foto` + `taslak=1` | kanıt AÇILMADAN dosya yükler, `id` döner | aynı |

### Gövde

```jsonc
{
  "sonuc":   "teslim" | "teslim_edilemedi",
  "sebep":   "kapali dukkan",          // teslim_edilemedi'de ZORUNLU (≥3, ≤300)
  "aliciAd": "M. Huber",               // opsiyonel, ≤80
  "not":     "arka kapiya birakildi",  // opsiyonel, ≤500
  "konum":   { "lat": 47.41, "lng": 9.74, "at": "…" },
  "fotoIds": ["<taslak-id>", "…"],     // en fazla 5
  "imzaId":  "<taslak-id>"             // opsiyonel, PNG
}
```

---

## 2 · 🔴 Sıra ÇELİŞKİSİ ve nasıl çözüldü

Panelin akışı ile telefonunki **birbirinin tersi**:

```
panel : kanıt kaydı açılır → her fotoğraf ayrı istekte ona bağlanır
mobil : fotoğraf(lar) çekilir/yüklenir → sonra "teslim ettim" denir
```

Şoför kapıda önce fotoğrafı çeker; "teslim ettim"e bastığı an işin **sonudur**.
Panelin sırasını telefona dayatmak, fotoğraf yüklenmeden yarım bir delil kaydı
açmak demekti.

Ama mevcut foto ucu kanıt yoksa `409 kanit_yok` diyordu ve
`teslimat_fotograflari.teslimat_id` **NOT NULL**, üstelik
`trg_teslimat_foto_degismez` o tablodaki **her UPDATE'i koşulsuz** reddediyor.
Yani fotoğrafın kanıt yokken duracağı bir yer yoktu. Üç yol vardı:

| | Yol | Karar |
|---|---|---|
| (a) | `teslimat_id`i NULL'lanabilir yap, sonradan **bağla** | ❌ `trg_teslimat_foto_degismez`in koşulsuzluğunu delerdi — ePOD'un en yüksek sesle yazılmış kuralı |
| (b) | Dosyayı Storage'a koy, **kayıt yazma**, yolu döndür | ❌ `lib/upload-core.ts` tam da yetim dosyayı öldürmek için yazıldı; bilerek yetim üretmek onun tersi |
| (c) | **Taslak için ayrı tablo** | ✅ seçildi |

**Ayrımın kendisi de doğru: taslak delil değildir.** Henüz bir teslimata
bağlanmamış fotoğraf neyin kanıtı olduğunu söyleyemez. Bu yüzden taslak satırı
değişebilir ve silinebilir; kanıt satırı değişemez ve silinemez.

Bağlama anında satır `teslimat_fotograflari`na **INSERT** edilir — kanıt
tarafında hâlâ yalnız INSERT var, **tek bir UPDATE yolu açılmadı.**

⚠️ Çift bağlama şemada kapalı: `teslimat_foto_yol_uq unique (storage_path)`
(080) aynı dosyanın ikinci kez kanıta bağlanmasını 23505 ile reddeder.

### Taslak yolu neden bayrakla

`taslak` alanı gönderilmeyen istek **eskisi gibi 409** alır. Davranışı sessizce
değiştirmek, bugünkü bir istemcinin 409 beklediği yerde 200 görmesi demekti —
fotoğraf "eklendi" sanılır, oysa hiçbir kanıta bağlı değildir.

---

## 3 · Durak durumu — panel kuralıyla

```
teslim            → tamamlandi
teslim_edilemedi  → atlandi  (SEBEBİYLE)
```

Geçiş `ilerletDurak` çekirdeğinden geçer, uçta yeniden yazılmaz: izinli geçiş
haritası, sebep alt sınırı ve yarış emniyeti (`.eq("durum", mevcut)`) orada tek
kaynak. 082 `atlandi`yı zaten şöyle tanımlıyor: *"bir başarısızlık değil,
GERÇEK bir sonuçtur: kapalı dükkân, ulaşılamayan alıcı, yanlış adres"* — yani
`teslim_edilemedi`nin tam karşılığı.

⚠️ **Geçiş düşerse kanıt yine de durur.** Durak zaten kapalıysa (şoför önce
"tamam"a basıp sonra kanıt bırakıyorsa) `ilerletDurak` `kapali_durak` der; bunu
hata sayıp kanıdı reddetmek, eldeki delili bir plan satırının durumu yüzünden
çöpe atmak olurdu. Yanıt `durumIlerledi:false` + `durumSebep` ile söyler.

---

## 4 · Migration 109

| Ekleme | Neden |
|---|---|
| `teslimatlar.sonuc` (NOT NULL, default `'teslim'`) | başarısızlık bugün yalnız `notlar` serbest metninde taşınabilirdi — makine okunur değil |
| `teslimatlar.sebep` + çift yönlü CHECK | sebepsiz başarısızlık iz bırakmayan bir "olmadı"; başarılının sebebi olmaz |
| `teslimat_degismez()` yeniden yazıldı | 082'nin kuralı: *saymadığı kolon, kanıdın değiştirilebilir tek alanı olur* |
| 🔴 `iptal_eden` koşullu donduruldu | **önceden açık olan delik**: ne 080 ne 082 bu kolonu sayıyordu, "kanıtı kim geçersiz ilan etti" sessizce değiştirilebiliyordu |
| `teslimat_taslak_dosyalari` | §2 |

`iptal_eden` **koşullu** yazıldı (`old.iptal_eden is not null and …`): koşulsuz
olsaydı `iptalTeslimat`ın null→dolu yazması, yani iptal yolunun kendisi
kırılırdı. Kural "bir kez yazılır, sonra donar".

⚠️ **109 uygulanmazsa** kanıt ucu `409 ozellik_kapali {migration:"109"}` döner.
Panelin kanıt akışı, şoför ekranı ve mevcut fotoğraf ucu aynen çalışır.
`sonuc` **sessizce atlanmaz**: "teslim edilemedi"yi sessizce "teslim edildi"
diye kaydetmek, kanıdın kendisini tersine çevirmek olurdu.

---

## 5 · Panel aynı çekirdeği okuyor

`imzali()` panelin **özel** yardımcısıydı. Mobil GET'e kopyalansaydı iki yüzey
aynı kanıta farklı alanlarla bakar, TTL'i biri değiştirdiğinde öteki geride
kalırdı — bu depoda o hata bir kez yaşandı (`app/api/mobile/_rapor/csv.ts`,
FUEL_ENABLED ↔ EXPORT_ENABLED).

Çekirdeğe taşındı: `lib/teslimat-db.ts` → `imzaliKanitlar()`. Panel de mobil de
onu çağırıyor. **Ölçüldü:** iki gövdenin alan kümeleri birebir aynı (20/20).

Yan kazanç: `imza_yol` 080'de "raster yedek" diye tanımlanmıştı ama bugüne dek
ne yazılıyor ne imzalanıyordu (ölçüldü). Artık ikisi de oluyor (`imzaUrl`).

---

## 6 · Kanıt

### Uçtan uca — gerçek Postgres, 109 UYGULANMIŞ (58/58 ✓)

```bash
docker run -d --name hak-qa -e POSTGRES_PASSWORD=qa -e POSTGRES_DB=hak -p 55432:5432 postgres:16
# roller + storage/auth şimi + db/install/galzura-full.sql + BYPASSRLS
#   (tam tarif: docs/COK-DURAKLI-SEFER.md §5)
docker run -d --name hak-qa-rest -p 55434:3000 … postgrest/postgrest:v12.2.3
node scripts/qa-supabase-proxy.mjs &          # /rest/v1 + /storage/v1 köprüsü
npm run verify:teslimat-kaniti
```

Ölçülenler: gerçek giriş (telefon+PIN) → 401/403/400 kapıları → taslak yükleme
→ kanıt (teslim) → **durak tamamlandi** → GET + imzalı URL'ler → panel/mobil
gövde paritesi → `teslim_edilemedi` → **durak atlandi + atlama_sebep** → ikinci
kanıt **409** → HK080 değişmezliği (5 iddia) → CHECK kısıtları (23514) →
temizlik (0 satır kaldı).

`scripts/qa-supabase-proxy.mjs` bir **şim değil köprü**: tablo tarafında hiçbir
şey taklit edilmiyor — CHECK'ler, kısmi tekil indeksler ve HK080 tetikleyicileri
gerçek PostgreSQL'de çalışıyor. Taklit edilen tek şey dosya deposu.

### Canlı — galzura-demo, 109 YOKKEN (21/21 ✓)

```bash
ENV_FILE=.env.galzura-demo node --import ./scripts/ts-server.mjs \
  scripts/verify-teslimat-kaniti-canli.mjs
```

Asıl soru: **dağıtım 109'suz bir kiracıyı bozuyor mu?** Ölçülen cevap hayır —
`409 ozellik_kapali {migration:"109"}`, 500 değil, **satır yazılmıyor** ve
taslak denemesinde yüklenen dosya temizleniyor (`dosyaTemizlendi:true`).

⚠️ ÖLÇÜLDÜ: demo'daki üç seferin üçü de `iptal`; betik geçici bir sefer+durak
açıp `finally`de siliyor ve sildiğini geri okuyarak doğruluyor.

### Muhafız

`npm run lint:teslimat-kaniti` — `verify` zincirinde. Arıza enjeksiyonuyla
sınandı: panel çekirdekten koparılırsa, yönetici muafiyeti gövdeden okunursa,
tetikleyiciden `sonuc` silinirse **üçünü de yakalıyor.**

---

## 7 · Açık kalanlar

- **Migration 109 hiçbir kiracıda koşmadı.** Depoda DDL kanalı yok; SQL Volkan'da.
- 🔴 **Yönetici kanıt bırakırsa o durak şoföre kilitlenir.** Kanıt yöneticinin
  `worker_id`si ile yazılır; foto ucunun `kanit.workerId !== worker.id → 403`
  kapısı yüzünden seferin şoförü o kanıta fotoğraf **ekleyemez** ve
  `teslimat_durak_id_uq` yüzünden ikinci kanıt da açamaz. Çıkış yolu yalnız
  yöneticinin `teslimatIptalEt`i. Tasarlanan düzeltme yolu budur, ama
  yöneticiye yazma açık kalacaksa foto ucunun kapısı da gözden geçirilmeli.
- **`teslim_edilemedi` yuvayı işgal eder.** Aynı durağa ikinci teslim denemesi
  409 alır. 080'in yazılı cevabı: *"yeniden teslim denemesi YENİ BİR duraktır"*
  — yönetici yeni durak açar.
- **Bağlanmayan taslakları süpüren cron yok.** Şoför fotoğrafı yükleyip
  teslimatı bitirmezse taslak kalır (bilerek — sessizce silmek, 10 dakika önce
  çekilmiş fotoğrafı haber vermeden yok etmek olurdu). Süpürme sorgusu 109'un
  DOĞRULAMA bölümünde hazır.
- **Mobil imza yalnız PNG.** Panel vektör (`imza_svg`) kullanıyor; uç
  `imzaId` (raster) alıyor. `teslimat_imza_tek_bicim` ikisini birden yasaklıyor,
  yani vektör desteği eklenecekse ayrı bir karar.
