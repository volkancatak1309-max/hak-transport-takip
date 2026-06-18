# Hayalet Vardiya Watchdog — Kurulum

Uzun süre açık kalan vardiyalar için şoföre Telegram'dan "Vardiyan hâlâ devam
ediyor mu?" sorar. **Evet** → 1 saat sonra tekrar sorar. **Hayır** → vardiyayı
kapatır. Kimse paneli açmasa bile çalışması için harici bir zamanlayıcı (cron)
endpoint'i tetikler.

## 1. Veritabanı (bir kez)
Supabase → SQL Editor'da çalıştır:
```
db/migrations/011_shift_watchdog.sql
```

## 2. Ortam değişkeni (Vercel → Project → Settings → Environment Variables)
- `CRON_SECRET` = uzun rastgele bir metin (ör. 32+ karakter). Kaydet ve **redeploy** et.

## 3. Harici cron (plan-bağımsız — önerilen)
Bir zamanlayıcı her **15 dakikada bir** şu adresi çağırsın:

```
https://hak-transport-takip.vercel.app/api/cron/shift-watchdog?secret=CRON_SECRET_DEGERI
```

Seçenekler:
- **cron-job.org** (ücretsiz): yeni job → yukarıdaki URL → her 15 dk. (GET yeterli.)
- **GitHub Actions**: zamanlanmış workflow, `curl` ile aynı URL'i çağırır.

> Vercel Pro'ya geçilirse aynı endpoint `vercel.json` cron'u ile de tetiklenebilir
> (route hem `?secret=` hem `Authorization: Bearer` kabul eder). Şimdilik gerek yok.

## 4. Telegram webhook
Mevcut webhook (`/api/telegram/webhook`) artık buton basışlarını (Evet/Hayır)
da işliyor — ekstra kurulum gerekmez, halihazırda kurulu webhook yeterli.

## Eşikler (kodda)
- Soru başlama: vardiya **10 saattir** açıksa.
- Tekrar sorma: **saat başı** (yanıt gelmezse de, Evet dendikçe de).
- Oto-kapatma yok: yalnızca şoför **Hayır** derse kapanır. Telegram'a bağlı
  olmayan şoför için bunun yerine **adminlere** uyarı gider.

## Mevcut hayaletleri temizleme (bir kez)
`db/maintenance/close_ghost_shifts.sql` — önce STEP 1 (liste), sonra incelenen
id'lerle STEP 2 (kapat). Silme yok, sadece `ended_at` set edilir.
