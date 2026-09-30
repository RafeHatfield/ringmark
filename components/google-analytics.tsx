'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { analyticsPath } from '@/lib/analytics'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

// The standard gtag stub. Commands queue in dataLayer until gtag.js loads, so
// the first page view is not lost if this effect runs before the script.
function getGtag(id: string): (...args: unknown[]) => void {
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? []
    window.gtag = function gtag() {
      // gtag.js requires the Arguments object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
    window.gtag('js', new Date())
    // Automatic page views would report the full URL, query string included.
    window.gtag('config', id, { send_page_view: false })
  }
  return window.gtag
}

export function GoogleAnalytics() {
  const pathname = usePathname()

  useEffect(() => {
    if (!GA_ID) return
    const path = analyticsPath(pathname)
    const gtag = getGtag(GA_ID)
    // 'set' applies to every later event, including GA's enhanced-measurement
    // ones (scroll, form_start, user_engagement), which otherwise read the real
    // URL from the address bar — token and query string included.
    gtag('set', { page_location: window.location.origin + path, page_path: path })
    gtag('event', 'page_view', { page_title: document.title })
  }, [pathname])

  if (!GA_ID) return null
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
}
