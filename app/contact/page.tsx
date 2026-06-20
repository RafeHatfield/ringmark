import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactForm } from './contact-form'

export const metadata: Metadata = {
  title: 'Get in touch — Ringmark',
  description: 'Send a message to the maker of Ringmark.',
}

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-paper text-ink font-sans" style={{ WebkitFontSmoothing: 'antialiased' }}>
      <div className="max-w-[480px] mx-auto px-6">

        <header className="flex items-center justify-between py-5">
          <Link href="/" className="inline-flex items-center gap-[9px] font-fraunces font-medium text-[19px] text-ink no-underline">
            <svg width="22" height="22" viewBox="0 0 40 40" fill="none" stroke="#B0612F" strokeWidth="1.6" aria-hidden="true">
              <circle cx="20.5" cy="20" r="4"/>
              <circle cx="20" cy="20" r="10"/>
              <circle cx="19.5" cy="20" r="16"/>
            </svg>
            Ringmark
          </Link>
        </header>

        <main className="pt-[32px] pb-16">
          <h1 className="font-fraunces font-medium text-[30px] leading-[1.15] tracking-[-0.01em] mb-[10px]">
            Get in touch
          </h1>
          <p className="text-[15px] leading-[1.65] text-bark mb-[34px]">
            Ringmark is a small, hand-built project. If you make things and want to give your work its story — or just want to say hello — I&apos;d love to hear from you.
          </p>

          <ContactForm />
        </main>

      </div>
    </div>
  )
}
