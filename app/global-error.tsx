"use client";

import { useEffect } from "react";

/**
 * Kök layout'un KENDİSİ çökerse devreye girer: layout (ve onunla globals.css +
 * i18n provider) render edilemediği için stiller inline, metin sabit TR.
 * Kendi <html>/<body> etiketlerini kurmak zorundadır (Next.js kuralı).
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0d16",
          color: "#f2f4f8",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            Bir şeyler ters gitti
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#9aa3b2" }}>
            Beklenmeyen bir hata oluştu. Lütfen sayfayı yenileyin ya da panele
            dönün.
          </p>
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: 24,
              padding: "10px 18px",
              borderRadius: 10,
              backgroundColor: "#8a1538",
              color: "#ffffff",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Panele dön
          </a>
        </div>
      </body>
    </html>
  );
}
