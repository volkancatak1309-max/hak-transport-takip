# Runbook — Sesli asistan Faz 2a (kullanım kaydı, sunucu sınırları, Bildir)

**Durum (03.10.2026):** kod `sesli-asistan-web` dalında, main'e alınmadı. **Migration 110
ÇALIŞTIRILMADI.** Kod bayrak arkasında (`ASISTAN_SESLI_KAYIT`, varsayılan kapalı); bayrak
kapalıyken prototip bugünkü gibi çalışır ve hiçbir tabloya dokunmaz. Her adım **Volkan'ın
onayından sonra**.

## Ne geldi

| Parça | Yer |
|---|---|
| Migration taslağı: `asistan_kullanim` (2 ay), `asistan_bildirimleri` (90 gün), `asistan_kayit_temizle()` | `db/migrations/_beklemede/110_sesli_asistan_kayit.sql` |
| Saf sınır hesabı: imzalı oturum jetonu, sunucu saniyesi, gün/ay/bütçe kararı, maliyet tabanı | `lib/asistan-sesli-sinir.ts` |
| Veritabanı katmanı (bayrak arkasında) | `lib/asistan-sesli-kayit.ts` |
| Oturum açılışında sınır + kayıt + jeton | `app/api/asistan/oturum`, `app/api/asistan/canli` |
| Araç ucu jeton kapısı (süre sunucuda biter) | `app/api/asistan/arac` |
| Kalp atışı (saniyeyi sunucu sayar) | `app/api/asistan/nabiz` (yeni) |
| Bildir → tablo | `app/api/asistan/bildir` (yeni) |
| Yazılı yol: bütçe + token kaydı | `app/api/asistan/yazi` |
| Saklama temizliği (günde 1) | `app/api/cron/asistan-kayit-temizle` (yeni) |

## Sınırlar nasıl uygulanıyor

- **Oturum açılmadan önce** (`oturumAc`): bu ayın kayıtlarından kişi/gün (20 dk), kişi/ay (60 dk)
  ve kiracı/ay maliyeti (`ASISTAN_SESLI_BUTCE_USD`, boşsa 25 $) hesaplanır; dolmuşsa **429**
  (`gun_siniri` / `ay_siniri` / `butce`), başka sekmede canlı oturum varsa **409** (`oturum_acik`) —
  OpenAI'a istek gitmez. Mesajlar istemcide kullanıcının dilinde (`asistanSesli.limit.*`).
- **Oturum jetonu**: kayıt kimliği + kullanıcı + başlangıç + bu oturumun sınırı (min(10 dk, kalan
  gün, kalan ay)), HMAC imzalı (sır `SESSION_PASSWORD`'den türetilir, ek env yok).
- **Araç ucu** jetonu ister; süre dolunca (30 sn tolerans) **401 `oturum_suresi_doldu`** — asistan
  veriye ulaşamaz, istemci görüşmeyi kapatır.
- **Kalp atışı** (15 sn): saniye = sunucu saati − başlangıç, sınırla kırpılı; istemcinin süresi
  okunmaz. Maliyet = sunucu tabanı (Live 0,05 $/dk + arka model tokenları; Realtime tipik
  0,054 $/dk [TAHMİN]) ile istemci tahmininin büyüğü (≤ 5 $).
- **Gün/ay sayımı**: kapanmış oturum → yazılan saniye; canlı → geçen süre; atış kesilmiş ama hiç atış
  almamış → tam 10 dk (temkinli: atışı kesip sınırdan kaçılamaz).
- **Kalan risk (Faz 2b):** değiştirilmiş bir istemci OpenAI ses bağlantısını jeton bitince açık
  tutabilir — araç alamaz ama ses ücreti işler. Kapatmak için sunucunun OpenAI oturumunu kendisinin
  kapatabilmesi gerekir (Realtime'da SDP değişimini sunucuya almak; GPT-Live'da oturum kapatma ucu —
  DOĞRULANACAK).

## Yerel ölçüm (bu turda)

- `npm run lint:asistan-sesli` — 26 kural / 29 arıza enjeksiyonu.
- `npm run lint:asistan-sesli-ozet` — jeton, saniye, gün/ay, sınır kararı, maliyet dahil 71 denetim.
- `npm run lint:asistan-sesli-kayit` — kuru koşum, gerçek uçlar: sınır dolu → 429 ve OpenAI'a
  istek yok; sınır altı → jeton + `sinirSn` = kalan gün; jetonsuz/süresi dolmuş/başkasının jetonu
  → 401; atışta saniyeyi sunucu yazıyor; süre aşılınca sunucu kapatıyor; Bildir tabloya (araç
  sonucu yazılmadan); yazılı yol bütçesi; cron 401/tur/503; bayrak kapalıyken tabloya HİÇ çağrı yok
  — 31 iddia.
- **ÖLÇÜLMEDİ:** gerçek Supabase'de migration (CHECK/indeks/RLS), canlı tarayıcıda kalp atışı ve
  `keepalive` son atış, sınır mesajlarının ekranda görünümü.

## Dağıtım sırası (onaydan SONRA)

1. **galzura-demo**
   1. Supabase SQL Editor: `db/migrations/_beklemede/110_sesli_asistan_kayit.sql` → çalıştır.
   2. Doğrula (dosyanın sonundaki iki sorgu): iki tablo var; `select public.asistan_kayit_temizle(1);`
      → `{"bildirim": 0, "kullanim": 0}`.
   3. Vercel `galzura-demo` (önce **Preview**): `ASISTAN_SESLI_KAYIT=1` (+ istenirse
      `ASISTAN_SESLI_BUTCE_USD`). Yeniden dağıt. `/admin/asistan`'da görüşme aç → "Süre ve sınırlar
      sunucuda sayılıyor" notu; Supabase'de `asistan_kullanim`'da satır, ~15 sn'de bir `saniye` artıyor;
      Bitir → `bitti_at` dolu.
   4. cron-job.org: `GET https://<demo-alanı>/api/cron/asistan-kayit-temizle`, başlık
      `Authorization: Bearer <CRON_SECRET>` (sorgu dizesi YOK — `docs/CRON-KAYITLARI.md` kuralı),
      günde 1 (gece 03:45 Europe/Vienna). İlk çağrının `200 {"ok":true,...}` döndüğünü doğrula.
2. **Sendigo** — aynı adımlar 1.1–1.4 (sesli asistan orada KAPALI kalır: `ASISTAN_SESLI` yok; tablo
   ve cron yalnız hazır olsun diye). Bayrağı açma.
3. **HAK61** — aynı adımlar 1.1, 1.2, 1.4. Bayrakları açma.
4. Migration dosyasını `db/migrations/` köküne taşı, `scripts/gen-install-sql.mjs` ORDER listesine
   `110_sesli_asistan_kayit.sql` ekle, kurulum SQL'ini yeniden üret (`lint:install-sql` yeşil),
   commit. (111 `mesaj-bildir-engelle` dalında; sıra korunur.)

**Geri alma:** bayrağı kaldır (kod prototip davranışına döner). Tabloları silmek gerekirse
dosyanın sonundaki geri alma bloğu (veri silinir). Cron kaydını durdur.

## Bağlı belgeler

- Hukuk taslakları (yayınlanmaz, avukat onayı şart): `docs/hukuk/`.
- Tasarım ve kararlar: mobil depo `docs/asistan-sesli-tasarim.md` §10.
- Cron envanteri: `docs/CRON-KAYITLARI.md` (12. satır).
