# HAK Transport — Saat & KM Takip

HAK Transport GmbH için çalışan vardiya ve kilometre takip web uygulaması.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + Supabase + iron-session

## Özellikler

### Çalışan paneli (`/panel`)
- Telefon + 4 haneli PIN ile giriş
- Tek tuş **Vardiya Başlat** / **Vardiya Bitir**
- Aktif vardiya: canlı saniye sayacı
- Son 30 günün geçmişi (süre, km farkı, plaka, not)
- Mobil-first tasarım, büyük butonlar

### Yönetici paneli (`/admin`)
- Bugün / bu hafta / bu ay / özel tarih aralığı filtresi
- Çalışan filtresi
- Özet kartlar: toplam saat, toplam km, aktif vardiya, 9 saati aşan
- Aktif vardiyalar **yeşil** satır + canlı sayaç
- 9 saati aşan (Avusturya AZG sınırı) vardiyalar **kırmızı** uyarı
- CSV export (Excel uyumlu, BOM + noktalı virgül)
- Çalışan ekleme dialogu

### Çalışan yönetimi (`/admin/workers`)
- Aktif/pasif toggle
- PIN sıfırlama (yeni 4 haneli üretir + 1 kez gösterir)

## Güvenlik

- **service_role key sadece server-side** — `lib/supabase.ts` `import "server-only"` ile korunur, client'a bile **anon key** gönderilmez
- iron-session **httpOnly + secure (prod) + sameSite=lax** cookie
- bcryptjs ile PIN hash (10 round)
- Her server action `requireWorker()` / `requireAdmin()` ile yetki kontrolü
- Çalışan kendi `worker_id`'sinin dışındaki time_entries'e erişemez
- Zod ile server-side validation (km, PIN format, telefon)
- Aynı çalışanın 2 aktif vardiyası olamaz (insert öncesi kontrol)
- Bitiş km < başlangıç km olamaz

## Veritabanı Şeması

Supabase'te zaten kurulu:

```sql
create table workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  pin_hash text not null,
  plate text,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_km integer not null,
  end_km integer,
  plate text,
  notes text,
  created_at timestamptz not null default now()
);

create index idx_time_entries_worker_active on time_entries(worker_id) where ended_at is null;
create index idx_time_entries_started_at on time_entries(started_at desc);
```

## Yerel Kurulum

```bash
git clone https://github.com/volkancatak1309-max/hak-transport-takip.git
cd hak-transport-takip
npm install
cp .env.example .env.local
# .env.local'ı doldur (aşağıya bak)
npm run dev
```

`http://localhost:3000` üzerinde açılır.

## Ortam Değişkenleri

`.env.local` dosyasında (asla commit etmeyin — `.gitignore`'da):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role JWT (Supabase Dashboard > Settings > API)>
SESSION_PASSWORD=<en az 32 karakter random — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` ile üret>
```

> **Önemli:** `SUPABASE_SERVICE_ROLE_KEY` RLS'i bypass eder; sadece server'da kullanılır. Client component'lerden Supabase'e doğrudan erişim YOKTUR.

## Test Hesapları (seed)

| Rol | Telefon | PIN |
|---|---|---|
| Admin | `+905551234567` | `1234` |
| Çalışan | `+436991234567` | `1234` |

## Vercel'e Deploy

1. Vercel Dashboard → **Import Project** → bu repo'yu seç
2. Framework: **Next.js** (otomatik algılanır)
3. Environment Variables ekle:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_PASSWORD`
4. Deploy.

Tüm sayfalar `export const dynamic = "force-dynamic"` ile dinamik — build'de DB'ye bağlanmaz.

## Test Senaryosu

### Çalışan akışı
1. `/` → `+436991234567` + `1234` → `/panel`
2. **Vardiya Başlat** → KM gir (örn. 125300), Plaka (default `W-1234AB`) → Kaydet
3. Canlı sayacın saniyede arttığını gör
4. **Vardiya Bitir** → bitiş KM gir (örn. 125450), not yaz → Kaydet
5. Son 30 gün tablosunda kayıt görünür

### Admin akışı
1. `/` → `+905551234567` + `1234` → `/admin`
2. Bugün / bu hafta / özel filtresi dene
3. Aktif vardiyanın yeşil satırda canlı sayaçla göründüğünü doğrula
4. **Excel'e Aktar** → CSV indir
5. **+ Çalışan Ekle** → yeni kayıt
6. `/admin/workers` → pasifleştir / PIN sıfırla

## Yol Haritası (v2)

- Almanca dil desteği
- Sürücü mobil app (PWA) + push bildirim
- Tachograf entegrasyonu
- Müşteri portali + sipariş takip
- Steuerberater BMD/RZL export
