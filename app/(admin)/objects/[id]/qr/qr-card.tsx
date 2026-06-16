'use client'

import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

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
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, publicUrl, {
      width: 160,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(console.error)
  }, [publicUrl])

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
        {/* QR code — rendered locally via canvas, no external request */}
        <canvas ref={canvasRef} width={160} height={160} className="rounded" />

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
