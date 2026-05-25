# HAK Transport — Schicht & KM

HAK Transport GmbH için iki dilli (TR/DE) çalışan vardiya, mola ve kilometre takip web uygulaması.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (base-nova / Base UI) · Supabase · iron-session · next-intl · next-themes · Recharts · @react-pdf/renderer · Leaflet / react-leaflet

## Sayfalar

| Yol | Açıklama |
|---|---|
| `/` | Giriş (telefon + 4 hane PIN) |
| `/panel` | Çalışan paneli: aktif vardiya, mola, bugün/bu hafta özet, son 5 vardiya, canlı konum |
| `/panel/gecmis` | Tam vardiya geçmişi (paginated, tarih filtreli) |
| `/admin` | Yönetici: 4 özet kart, 7-günlük bar grafik, filtre, tablo, edit/sil |
| `/admin/harita` | Canlı filo haritası (aktif sürücü marker'ları, sadece admin) |
| `/admin/workers` | Çalışan listesi (son vardiya, bu ay saat) |
| `/admin/workers/[id]` | Çalışan detayı: bu ay özet, bugünkü güzergah, tam geçmiş, kişiye özel PDF |

## Yeni Özellikler (Faz 2 — Yasal Kalkan & Muhasebe)

- **Lenkzeit mola uyarısı (EU 561/2006)** — aktif vardiyada sürüş süresi sayacı; 4 saatte ön uyarı toast, 4.5 saatte Browser Notification + zorunlu mola modalı + ses (snooze 5 dk). Mola bitince sayaç sıfırlanır. Panelde renkli sürüş kronometresi (yeşil→sarı→kırmızı/pulse). DB değişikliği yok.
- **AZG otomatik denetim raporu** — admin `/admin`'de "AZG Denetim" → ay seçimi → çok sayfalı PDF (kapak + sürücü özeti + detaylı ihlal tablosu + § referansları + yasal not). § 9/§ 11/§ 26 AZG.
- **DATEV / BMD muhasebe export** — mevcut Excel'in yanına DATEV (Almanya) ve BMD (Avusturya) CSV export butonları; seçili tarih aralığı için, UTF-8 BOM + noktalı virgül, Steuerberater'a hazır.

## Yeni Özellikler (Faz 1 — Görsel Şov)

- **Canlı araç konumu haritası** — şoför aktif vardiyada her 60 sn konum gönderir (izin opsiyonel); admin `/admin/harita`'da Leaflet/OSM haritada canlı marker görür (30 sn polling). Sürücü detayında "Bugünkü Güzergah" polyline (yeşil başlangıç / turuncu son).
- **Offline çalışma garantisi** — internet yokken vardiya başlat/bitir/mola IndexedDB kuyruğuna girer; bağlantı gelince (`online` event veya SW background sync) otomatik gönderilir. Header'da çevrimiçi/çevrimdışı + bekleyen kayıt badge'i.

## Yeni Özellikler (v2)

1. **Mola takibi** — panelden mola başlat/bitir toggle, dakikalar `break_minutes`'a birikir
2. **Kargo sayısı** — vardiya açılırken beklenen, kapanırken teslim edilen
3. **Düzenle/Sil** — admin tablosundan vardiya satırlarını edit/delete (`updated_at` + `updated_by` audit)
4. **PDF rapor** — A4 portrait, brand header, AZG footer (tüm liste + kişiye özel)
5. **Haftalık bar grafik** — son 7 gün toplam çalışılan saat (Recharts, dark/light token uyumlu)
6. **i18n (TR/DE)** — cookie-based, URL temiz, header toggle ile anında değişir
7. **Dark/Light/System tema** — next-themes, OKLCH token seti
8. **PWA** — manifest + minimal SW, "Ana ekrana ekle"
9. **Çalışan detay sayfası** — bağımsız rapor + profil aksiyonları

## Güvenlik

- `SUPABASE_SERVICE_ROLE_KEY` **sadece server-side** (`lib/supabase.ts` `import "server-only"`)
- iron-session **httpOnly + secure (prod) + sameSite=lax** cookie
- bcryptjs ile PIN hash (10 round)
- Her server action `requireWorker()` / `requireAdmin()` ile yetki kontrolü
- Worker kendi `worker_id` dışındaki entry'lere erişemez (`.eq("worker_id", session.worker_id)`)
- Zod ile server-side validation (km, PIN, telefon, break_minutes, cargo_count)
- Aynı çalışanın 2 aktif vardiyası olamaz
- Bitiş km < başlangıç km olamaz

## Kurulum

```bash
git clone https://github.com/volkancatak1309-max/hak-transport-takip.git
cd hak-transport-takip
npm install
cp .env.example .env.local   # değerleri doldur
npm run dev
```

`http://localhost:3000`

### Ortam değişkenleri

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role JWT (Supabase Dashboard > Settings > API)>
SESSION_PASSWORD=<en az 32 karakter random — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

> `service_role` RLS'i bypass eder — sadece server. Client component'lerden Supabase'e doğrudan erişim yoktur.

## Veritabanı Migration

### v2 öncesi (mevcut)

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
```

### v2 migration — ⚠️ DEPLOY ÖNCESİ ÇALIŞTIR

Supabase SQL Editor'da `db/migrations/002_add_break_cargo.sql` içeriğini çalıştır:

```sql
alter table public.time_entries
  add column if not exists break_minutes integer default 0,
  add column if not exists cargo_count integer,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.workers(id);
create index if not exists idx_time_entries_started_date
  on public.time_entries(date(started_at at time zone 'Europe/Vienna'));
```

(Constraint'ler + index dosyada hazır)

### Faz 1 migration — ⚠️ DEPLOY ÖNCESİ ÇALIŞTIR

Canlı konum haritası için Supabase SQL Editor'da `db/migrations/003_locations.sql` içeriğini çalıştır:

```sql
create table if not exists public.driver_locations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_driver_locations_worker_recent
  on public.driver_locations(worker_id, recorded_at desc);
create index if not exists idx_driver_locations_time_entry
  on public.driver_locations(time_entry_id) where time_entry_id is not null;
```

> `003` çalıştırılmadan `/admin/harita` ve panel konum gönderimi 500 verir. `nav.map` ("Harita" sekmesi) yalnızca admin'e görünür.

## Test Hesapları (seed)

| Rol | Telefon | PIN |
|---|---|---|
| Admin | `+905551234567` | `1234` |
| Çalışan | `+436991234567` | `1234` |

## Vercel'e Deploy

1. **Migration'ı önce Supabase'de çalıştır** (yukarıdaki SQL).
2. Vercel Dashboard → Import Project → bu repo'yu seç.
3. Framework: **Next.js** (otomatik algılanır).
4. Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_PASSWORD`
5. Deploy.

Tüm sayfalar dinamik (`force-dynamic`); build'de DB'ye bağlanmaz.

## Test Senaryosu

### Çalışan akışı (`/panel`)
1. `+436991234567` / `1234` → `/panel`
2. **Vardiya Başlat** → km, plaka, opsiyonel beklenen kargo
3. Canlı sayaç + **Mola Başlat** → sayaç griye düşer + biriken dakikalar header'da
4. **Mola Bitir** → DB'ye dakika eklenir
5. **Vardiya Bitir** → bitiş km, teslim edilen kargo, mola dakikası (otomatik dolu), not
6. Son 5 vardiya kart altında, "Tümünü Gör" → `/panel/gecmis`

### Admin akışı (`/admin`)
1. `+905551234567` / `1234` → `/admin`
2. 4 özet kart + 7-günlük bar grafik
3. Filtre: tarih aralığı (today/week/month/custom) + çalışan + durum
4. Aktif satırlar: turuncu sol border + AKTİF badge
5. 9 saat aşan satırlar: kırmızı sol border + 9h+ badge + pulse
6. **Excel'e Aktar** → CSV (BOM, TR karakterleri OK)
7. **PDF Rapor** → A4 portrait, HAK brand header, AZG footer
8. **Düzenle** (kalem ikon) → tüm alanlar (datetime, km, mola, kargo, plaka, not)
9. **Sil** (çöp ikon) → confirm sonrası hard delete
10. `+ Çalışan Ekle`

### Worker mgmt (`/admin/workers`)
1. Liste: son vardiya tarihi + bu ay saat
2. Satır click → `/admin/workers/[id]` detay
3. Detayda 4 özet kart (vardiya/saat/km/kargo) + tam geçmiş + bu çalışan için PDF

### i18n / Tema
1. Header sağ üst: globe ikon → TR/DE seç → sayfa yenilenir, cookie kaydedilir
2. Sun/moon → Light/Dark/System

## Yol Haritası (v3)
- Tachograf entegrasyonu
- Müşteri portali + sipariş takip
- Steuerberater BMD/RZL export
- Push bildirim (PWA service worker)
- Multi-select worker filter (cmdk command palette)
