<#
  telegram-webhook.ps1 - HAK61 Telegram webhook teshis + guvenli yeniden kayit araci.

  Bu dosya HICBIR SECRET ICERMEZ. BOT_TOKEN / WEBHOOK_SECRET degerlerini calisma
  aninda .env.local'dan okur; orada yoksa gizli (ekrana yazilmayan) olarak sorar.
  Boylece secret ne bu dosyaya, ne ekrana, ne de loglara duser.

  Degerleri Vercel'den .env.local'a cekmek icin (bir kez):
    npm i -g vercel
    vercel login
    vercel link                    # hak-transport-takip projesini sec
    vercel env pull .env.local --environment=production

  Kullanim (repo kokunden):
    # 1) Teshis - mevcut webhook durumunu goster:
    powershell -ExecutionPolicy Bypass -File .\scripts\telegram-webhook.ps1 -Action info

    # 2) Duzelt - secret_token + callback_query acik olacak sekilde yeniden kaydet:
    powershell -ExecutionPolicy Bypass -File .\scripts\telegram-webhook.ps1 -Action register

  Not: register, drop_pending_updates KOYMAZ -> biriken "Hayir, bitti" basislari
  teslim olur ve takili vardiya kendiliginden kapanir.
#>
param(
  [ValidateSet("info", "register")]
  [string]$Action = "info",
  [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 varsayilani eski TLS olabilir; api.telegram.org TLS 1.2 ister.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$WebhookUrl = "https://hak-transport-takip.vercel.app/api/telegram/webhook"

function Get-EnvValue([string]$file, [string]$key) {
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  foreach ($line in Get-Content -LiteralPath $file) {
    if ($line -match "^\s*$([regex]::Escape($key))\s*=\s*(.*)$") {
      $v = $Matches[1].Trim()
      if ($v.Length -ge 2 -and
          (($v.StartsWith('"') -and $v.EndsWith('"')) -or
           ($v.StartsWith("'") -and $v.EndsWith("'")))) {
        $v = $v.Substring(1, $v.Length - 2)
      }
      if ($v -ne "") { return $v }
    }
  }
  return $null
}

function Read-Secret([string]$prompt) {
  $ss = Read-Host -Prompt $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# --- Degerleri coz: once env dosyasi, yoksa gizli sor ---
$token = Get-EnvValue $EnvFile "TELEGRAM_BOT_TOKEN"
if (-not $token) {
  Write-Host "TELEGRAM_BOT_TOKEN '$EnvFile' icinde yok - BotFather'dan alip girebilirsin." -ForegroundColor Yellow
  $token = Read-Secret "BOT_TOKEN (ekrana yazilmaz)"
}
if (-not $token) { Write-Host "Bot token gerekli, cikiliyor." -ForegroundColor Red; exit 1 }

$secret = $null
if ($Action -eq "register") {
  $secret = Get-EnvValue $EnvFile "TELEGRAM_WEBHOOK_SECRET"
  if (-not $secret) {
    Write-Host "TELEGRAM_WEBHOOK_SECRET '$EnvFile' icinde yok." -ForegroundColor Yellow
    Write-Host "ONEMLI: Girecegin deger, Vercel Production'daki TELEGRAM_WEBHOOK_SECRET ile BIREBIR AYNI olmali." -ForegroundColor Yellow
    Write-Host "(Vercel'de 'Sensitive' oldugu icin okunamiyorsa: yeni bir secret uret, hem Vercel'e yaz + redeploy, hem buraya gir.)" -ForegroundColor Yellow
    $secret = Read-Secret "WEBHOOK_SECRET (Vercel'deki ile ayni; ekrana yazilmaz)"
  }
  if (-not $secret) { Write-Host "Webhook secret gerekli, cikiliyor." -ForegroundColor Red; exit 1 }
}

# Hata mesajlarinda secret/token sizmasin diye redaksiyon.
function Redact([string]$s) {
  if ($s -and $token)  { $s = $s.Replace($token,  "***TOKEN***") }
  if ($s -and $secret) { $s = $s.Replace($secret, "***SECRET***") }
  return $s
}

try {
  if ($Action -eq "info") {
    $resp = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
    $r = $resp.result
    $allowed = @($r.allowed_updates)
    Write-Host "=== getWebhookInfo ===" -ForegroundColor Cyan
    Write-Host ("url                  : " + $r.url)
    Write-Host ("pending_update_count : " + $r.pending_update_count)
    Write-Host ("allowed_updates      : " + ($allowed -join ", "))
    Write-Host ("ip_address           : " + $r.ip_address)
    if ($r.last_error_message) {
      $d = ""
      if ($r.last_error_date) {
        $d = [DateTimeOffset]::FromUnixTimeSeconds([int64]$r.last_error_date).LocalDateTime
      }
      Write-Host ("last_error           : " + $r.last_error_message + "  (" + $d + ")") -ForegroundColor Red
    } else {
      Write-Host "last_error           : (yok)" -ForegroundColor Green
    }
    Write-Host ""
    if (-not $r.url) {
      Write-Host "TESHIS: Webhook hic kayitli degil -> 'register' calistir." -ForegroundColor Yellow
    } elseif ($allowed.Count -gt 0 -and ($allowed -notcontains "callback_query")) {
      Write-Host "TESHIS (B): allowed_updates'te callback_query YOK -> buton basislari Telegram tarafindan hic gonderilmiyor. 'register' duzeltir." -ForegroundColor Yellow
    } elseif ($r.last_error_message -match "401|Unauthorized") {
      Write-Host "TESHIS (A): Uygulama 401 donuyor -> secret uyusmuyor. 'register' (secret_token = Vercel'deki deger) duzeltir." -ForegroundColor Yellow
    } elseif ($r.url -like "*secret=*") {
      Write-Host "NOT: Secret hala URL'de (?secret=...). secret_token'a gecmek icin 'register' calistir." -ForegroundColor Yellow
    } else {
      Write-Host "Webhook saglikli gorunuyor. Buton hala calismiyorsa pending sayisina ve last_error'a bak." -ForegroundColor Green
    }
  }
  else {
    if ($secret -notmatch '^[A-Za-z0-9_-]{1,256}$') {
      Write-Host "UYARI: secret_token yalnizca A-Z a-z 0-9 _ - icerebilir (1-256 karakter). Telegram bu degeri reddedebilir." -ForegroundColor Yellow
    }
    # drop_pending_updates KOYULMADI -> biriken buton basislari teslim olsun.
    $payload = @{
      url             = $WebhookUrl
      secret_token    = $secret
      allowed_updates = @("message", "callback_query")
    }
    $body = $payload | ConvertTo-Json
    $resp = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body $body
    if ($resp.ok) {
      Write-Host ("OK: setWebhook basarili - " + $resp.description) -ForegroundColor Green
      Write-Host "Simdi tekrar '-Action info' calistir:" -ForegroundColor Cyan
      Write-Host "  - last_error temizlenmeli"
      Write-Host "  - pending_update_count 0'a inmeli (biriken 'Hayir' basislari islendi -> vardiya kapandi)"
      Write-Host "  - allowed_updates icinde 'callback_query' gorunmeli"
    } else {
      Write-Host ("HATA: setWebhook basarisiz - " + $resp.description) -ForegroundColor Red
    }
  }
}
catch {
  Write-Host ("HATA: " + (Redact($_.Exception.Message))) -ForegroundColor Red
  exit 1
}
