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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasLabelRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const opts = { margin: 1, color: { dark: '#000000', light: '#ffffff' } }
    if (canvasRef.current)
      QRCode.toCanvas(canvasRef.current, publicUrl, { ...opts, width: 160 }).catch(console.error)
    if (canvasLabelRef.current)
      QRCode.toCanvas(canvasLabelRef.current, publicUrl, { ...opts, width: 128 }).catch(console.error)
  }, [publicUrl])

  function handlePrintCard() {
    window.print()
  }

  function handlePrintLabel() {
    document.body.dataset.print = 'label'
    window.addEventListener('afterprint', () => {
      delete document.body.dataset.print
    }, { once: true })
    window.print()
  }

  async function handleCopyUrl() {
    await navigator.clipboard.writeText(publicUrl)
  }

  function handleDownload() {
    const canvas = canvasRef.current
    if (!canvas) return
    // Safe to call toDataURL — canvas is untainted because QR is generated locally (no cross-origin image)
    const dataUrl = canvas.toDataURL('image/png')
    const safeName = workshopId.replace(/[^A-Za-z0-9-]/g, '-')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `ringmark-qr-${safeName}.png`
    a.click()
  }

  return (
    <div className="space-y-6">
      {/* Printable card — shown on screen and in card print mode */}
      <div
        className="border-2 border-dashed border-hairline rounded-xl p-6 flex flex-col items-center gap-4 max-w-xs mx-auto"
        id="qr-print-card"
      >
        <canvas ref={canvasRef} width={160} height={160} className="rounded" />
        <div className="text-center">
          <p className="text-2xl font-mono font-bold tracking-tight">{workshopId}</p>
          <p className="text-xs text-bark mt-1">ringmark.org/p/{publicSlug}</p>
        </div>
      </div>

      {/* Label layout — hidden on screen, shown only in label print mode */}
      <div id="qr-print-label" className="hidden" aria-hidden="true">
        <canvas ref={canvasLabelRef} width={128} height={128} />
        <p className="text-xl font-mono font-bold tracking-tight text-center">{workshopId}</p>
        <p className="text-[9px] text-center" style={{ letterSpacing: '0.02em' }}>ringmark.org/p/{publicSlug}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 max-w-xs mx-auto">
        <button
          onClick={handlePrintCard}
          className="w-full px-4 py-2.5 bg-cedar text-paper rounded-md text-sm font-medium hover:bg-heartwood transition-colors"
        >
          Print card
        </button>
        <button
          onClick={handlePrintLabel}
          className="w-full px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors"
        >
          Print label
        </button>
        <button
          onClick={handleDownload}
          className="w-full px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors"
        >
          Download QR
        </button>
        <button
          onClick={handleCopyUrl}
          className="w-full px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors"
        >
          Copy public URL
        </button>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full text-center px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors"
        >
          Preview public page ↗
        </a>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          /* Hide all page chrome — visibility:hidden allows children to override, unlike display:none */
          body * { visibility: hidden; }

          /* Card print (default) */
          #qr-print-card { visibility: visible; position: absolute; top: 0; left: 0; display: flex !important; flex-direction: column; align-items: center; gap: 16px; border: 2px solid #000; border-radius: 12px; padding: 24px; }
          #qr-print-card * { visibility: visible; }

          /* Label print */
          body[data-print="label"] #qr-print-card { visibility: hidden; }
          body[data-print="label"] #qr-print-label { visibility: visible !important; position: absolute; top: 0; left: 0; display: flex !important; flex-direction: column; align-items: center; gap: 4px; }
          body[data-print="label"] #qr-print-label * { visibility: visible; }
        }
      `}</style>
    </div>
  )
}
