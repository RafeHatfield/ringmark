'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Photo {
  url: string
  caption: string | null
}

interface Props {
  photos: Photo[]
  displayTitle: string
}

const MAX_VISIBLE_STRIP = 3

export function PhotoViewer({ photos, displayTitle }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [animating, setAnimating] = useState(false)
  const [originRect, setOriginRect] = useState<DOMRect | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const isOpen = lightboxIndex !== null
  const heroPhoto = photos[0] ?? null
  const stripPhotos = photos.slice(1)
  const visibleStrip = stripPhotos.length <= MAX_VISIBLE_STRIP
    ? stripPhotos
    : stripPhotos.slice(0, MAX_VISIBLE_STRIP - 1)
  const overflowCount = stripPhotos.length > MAX_VISIBLE_STRIP
    ? stripPhotos.length - (MAX_VISIBLE_STRIP - 1)
    : 0

  function open(index: number, e: React.MouseEvent<HTMLElement>) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setOriginRect(rect)
    setLightboxIndex(index)
    setAnimating(false)
    // allow DOM to paint with origin transform, then trigger transition
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimating(true)))
  }

  const close = useCallback(() => {
    setAnimating(false)
    // wait for close animation then unmount
    setTimeout(() => {
      setLightboxIndex(null)
      setOriginRect(null)
    }, 280)
  }, [])

  function prev() {
    setLightboxIndex(i => i !== null ? (i - 1 + photos.length) % photos.length : 0)
    setOriginRect(null)
    setAnimating(true)
  }

  function next() {
    setLightboxIndex(i => i !== null ? (i + 1) % photos.length : 0)
    setOriginRect(null)
    setAnimating(true)
  }

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // Compute FLIP origin transform: position the lightbox image where the thumbnail was
  function getOriginTransform(): string {
    if (!originRect || !imgRef.current) return 'translate(-50%, -50%) scale(0.6)'
    const vw = window.innerWidth
    const vh = window.innerHeight
    // center of the thumbnail relative to viewport center
    const thumbCX = originRect.left + originRect.width / 2
    const thumbCY = originRect.top + originRect.height / 2
    const dx = thumbCX - vw / 2
    const dy = thumbCY - vh / 2
    // approximate scale: thumbnail width as fraction of viewport width
    const scale = Math.min(originRect.width / (vw * 0.9), originRect.height / (vh * 0.9), 0.25)
    return `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`
  }

  const currentPhoto = lightboxIndex !== null ? photos[lightboxIndex] : null

  return (
    <>
      {/* Hero */}
      {heroPhoto?.url ? (
        <div
          className="reveal aspect-[4/3] rounded-[14px] overflow-hidden bg-sand cursor-zoom-in"
          onClick={e => open(0, e)}
          role="button"
          tabIndex={0}
          aria-label="View photo"
          onKeyDown={e => e.key === 'Enter' && open(0, e as unknown as React.MouseEvent<HTMLElement>)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroPhoto.url}
            alt={heroPhoto.caption ?? displayTitle}
            className="w-full h-full object-cover block"
          />
        </div>
      ) : (
        <div className="reveal aspect-[4/3] rounded-[14px] bg-sand flex items-center justify-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#B0612F" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-3.5-3.5L9 19"/>
          </svg>
        </div>
      )}

      {/* Photo strip */}
      {stripPhotos.length > 0 && (
        <>
          <hr className="reveal h-px bg-hairline border-0 my-7" />
          <div className="reveal grid grid-cols-3 gap-2">
            {visibleStrip.map((p, i) =>
              p.url ? (
                <button
                  key={i}
                  onClick={e => open(i + 1, e)}
                  className="aspect-square rounded-[9px] bg-sand overflow-hidden cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-cedar"
                  aria-label={p.caption ?? `Photo ${i + 2}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" />
                </button>
              ) : null,
            )}
            {overflowCount > 0 && (
              <button
                onClick={e => open(MAX_VISIBLE_STRIP, e)}
                className="aspect-square rounded-[9px] bg-sand flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cedar"
                aria-label={`View ${overflowCount} more photos`}
              >
                <span className="text-[14px] text-heartwood font-medium">+{overflowCount}</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Lightbox */}
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
          {/* Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
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
              transform: animating ? 'translate(-50%, -50%) scale(1)' : getOriginTransform(),
              opacity: animating ? 1 : 0,
              transition: animating
                ? 'transform 320ms cubic-bezier(0.2,0.8,0.3,1), opacity 200ms ease, border-radius 320ms ease'
                : 'none',
              cursor: 'default',
            }}
          />

          {/* Caption */}
          {currentPhoto.caption && animating && (
            <div
              className="fixed bottom-6 left-0 right-0 text-center pointer-events-none"
              style={{ opacity: animating ? 1 : 0, transition: 'opacity 200ms ease 100ms' }}
            >
              <span className="text-white/70 text-sm px-4">{currentPhoto.caption}</span>
            </div>
          )}

          {/* Prev / Next */}
          {photos.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); prev() }}
                className="fixed left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
                aria-label="Previous photo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <button
                onClick={e => { e.stopPropagation(); next() }}
                className="fixed right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
                aria-label="Next photo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </>
          )}

          {/* Close */}
          <button
            onClick={close}
            className="fixed top-4 right-4 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>

          {/* Counter */}
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
