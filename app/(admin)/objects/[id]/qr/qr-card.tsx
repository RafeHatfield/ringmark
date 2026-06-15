'use client'

import { useRef } from 'react'

/**
 * QR Card — renders a printable card with a QR code and the public URL.
 * Uses the native HTML canvas API via a third-party-free QR generator.
 * For the POC, we use a URL-based QR service to avoid adding a dependency.
 * The QR image loads from api.qrserver.com (free, no API key required).
 */
export default function QrCard({
  workshopId,
  publicUrl,
  publicSlug,
}: {
  workshopId: string
  publicUrl: string
  publicSlug: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(publicUrl)}&bgcolor=ffffff&color=000000&margin=1`

  function handlePrint() {
    window.print()
  }

  async function handleCopyUrl() {
    await navigator.clipboard.writeText(publicUrl)
  }

  return (
    <div className="space-y-6">
      {/* Printable card */}
      <div
        ref={cardRef}
        className="print:block border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center gap-4 max-w-xs mx-auto"
        id="qr-print-card"
      >
        {/* QR code */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrSrc}
          alt={`QR code for ${workshopId}`}
          width={160}
          height={160}
          className="rounded"
        />

        {/* Workshop ID */}
        <div className="text-center">
          <p className="text-2xl font-mono font-bold tracking-tight">{workshopId}</p>
          <p className="text-xs text-muted-foreground mt-1">ringmark.org/p/{publicSlug}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 max-w-xs mx-auto">
        <button
          onClick={handlePrint}
          className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Print card
        </button>
        <button
          onClick={handleCopyUrl}
          className="w-full px-4 py-2.5 border border-input rounded-md text-sm font-medium hover:bg-accent transition-colors"
        >
          Copy public URL
        </button>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full text-center px-4 py-2.5 border border-input rounded-md text-sm font-medium hover:bg-accent transition-colors"
        >
          Preview public page ↗
        </a>
      </div>

      {/* Print styles — scoped to this page */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #qr-print-card {
            display: flex !important;
            border: 2px solid #000 !important;
            border-radius: 12px !important;
            padding: 24px !important;
            max-width: 280px !important;
            margin: 40px auto !important;
          }
        }
      `}</style>
    </div>
  )
}
