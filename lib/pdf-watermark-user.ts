/**
 * FİLİGRAN KULLANICISI — istemci tarafı küçük depo (045).
 *
 * PDF'ler TARAYICIDA üretiliyor (@react-pdf/renderer, beş bileşenin beşi de
 * "use client"), dolayısıyla filigrandaki kullanıcı adının istemcide bulunması
 * gerekiyor. Adı beş rapor bileşeninin ve onların `download*` giriş
 * noktalarının HEPSİNE prop olarak geçirmek yerine tek bir modül değişkeni
 * kullanılıyor: `DashboardShell` zaten kullanıcıyı alıyor ve bir kez yazıyor.
 *
 * Neden context değil: PDF üretimi React ağacının DIŞINDA, düz bir fonksiyon
 * çağrısıyla oluyor (`await downloadAZGReport(...)`) — orada hook okunamaz.
 *
 * Kişisel veri saklamaz: yalnız ekranda zaten görünen ad. Filigran kapalıysa
 * (PDF_WATERMARK boş) hiç okunmaz.
 */
let watermarkUser: string | null = null;

export function setWatermarkUser(name: string | null | undefined): void {
  watermarkUser = name?.trim() || null;
}

export function getWatermarkUser(): string | null {
  return watermarkUser;
}
