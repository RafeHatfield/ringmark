'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'

interface Photo {
  url: string
  caption: string | null
}

interface Props {
  photos: Photo[]
  label: string
}

const camIcon = (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#B0612F" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-3.5-3.5L9 19"/>
  </svg>
)

export function StagePhoto({ photos, label }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [animating, setAnimating] = useState(false)

  const isOpen = lightboxIndex !== null
  const first = photos[0]
  const extra = photos.length - 1

  function open(index: number) {
    setLightboxIndex(index)
    setAnimating(false)
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimating(true)))
  }

  const close = useCallback(() => {
    setAnimating(false)
    setTimeout(() => setLightboxIndex(null), 280)
  }, [])

  const prev = useCallback(() => {
    setLightboxIndex(i => i !== null ? (i - 1 + photos.length) % photos.length : 0)
    setAnimating(true)
  }, [photos.length])

  const next = useCallback(() => {
    setLightboxIndex(i => i !== null ? (i + 1) % photos.length : 0)
    setAnimating(true)
  }, [photos.length])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close, prev, next])

  const currentPhoto = lightboxIndex !== null ? photos[lightboxIndex] : null

  if (!first?.url) {
    return (
      <div className="rounded-[11px] bg-sand aspect-[16/10] flex items-center justify-center">
        {camIcon}
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => open(0)}
        className="relative rounded-[11px] overflow-hidden bg-sand aspect-[16/10] w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-cedar"
        aria-label={`View photo${photos.length > 1 ? 's' : ''} — ${label}`}
      >
        <Image src={first.url} alt={first.caption ?? label} fill sizes="440px" className="object-cover" />
        {extra > 0 && (
          <span className="absolute top-[9px] right-[9px] bg-heartwood text-[#FBF1E6] text-[11px] px-[9px] py-[2px] rounded-full pointer-events-none">
            +{extra}
          </span>
        )}
      </button>

      {isOpen && currentPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            backgroundColor: animating ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0)',
            transition: 'background-color 280ms ease',
          }}
          onClick={close}
          aria-modal="true"
          role="dialog"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPhoto.url}
            alt={currentPhoto.caption ?? ''}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              maxWidth: '92vw',
              maxHeight: '88vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              borderRadius: animating ? '10px' : '6px',
              transform: animating
                ? 'translate(-50%, -50%) scale(1)'
                : 'translate(-50%, -50%) scale(0.6)',
              opacity: animating ? 1 : 0,
              transition: animating
                ? 'transform 320ms cubic-bezier(0.2,0.8,0.3,1), opacity 200ms ease, border-radius 320ms ease'
                : 'none',
              cursor: 'default',
            }}
          />

          {currentPhoto.caption && animating && (
            <div className="fixed bottom-6 left-0 right-0 text-center pointer-events-none">
              <span className="text-white/70 text-sm px-4">{currentPhoto.caption}</span>
            </div>
          )}

          {photos.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); prev() }}
                className="fixed left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
                aria-label="Previous photo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>
              <button
                onClick={e => { e.stopPropagation(); next() }}
                className="fixed right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
                aria-label="Next photo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            </>
          )}

          <button
            onClick={close}
            className="fixed top-4 right-4 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>

          {photos.length > 1 && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 text-white/60 text-xs pointer-events-none">
              {(lightboxIndex ?? 0) + 1} / {photos.length}
            </div>
          )}
        </div>
      )}
    </>
  )
}
