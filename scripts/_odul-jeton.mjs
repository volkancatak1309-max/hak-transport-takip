/**
 * QA — mobil erişim jetonu üretir.
 *
 * Gerçek `issueTokens` yolu kullanılıyor: elle mühür üretmek, doğrulama
 * zincirinin (sürüm + tip + süre) atlanmasına yol açar ve uç "gerçekten
 * çalışıyor" kanıtı olmaktan çıkardı.
 */
import { issueAccessToken, readTokenVersion } from "@/lib/mobile-auth";

export async function mobilJeton(workerId, isAdmin = false) {
  /**
   * ⚠️ `readTokenVersion` SAYI DEĞİL `{status, value}` DÖNER. İlk yazımda
   * dönen nesne doğrudan `issueAccessToken`a verildi; mühür bozuldu,
   * `readToken` null döndü ve uç 401 verdi. Hata üründe değil bu yardımcıdaydı.
   */
  const surum = await readTokenVersion(workerId);
  const tv = typeof surum === "number" ? surum : (surum?.value ?? 0);
  const { accessToken } = await issueAccessToken(workerId, isAdmin, tv);
  return accessToken;
}
