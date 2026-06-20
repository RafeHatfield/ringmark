'use client'

import { useActionState, useRef } from 'react'
import { sendContactEmail, type ContactResult } from '@/actions/contact'

const initialState: ContactResult | null = null

export function ContactForm() {
  const [result, action, pending] = useActionState(sendContactEmail, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  if (result && 'success' in result) {
    return (
      <div className="text-center py-10">
        <p className="font-fraunces text-[22px] text-ink mb-3">Message sent.</p>
        <p className="text-[15px] text-bark">Thanks — I&apos;ll be in touch.</p>
      </div>
    )
  }

  return (
    <form ref={formRef} action={action} className="space-y-5">
      {/* Honeypot */}
      <input type="text" name="_trap" className="hidden" tabIndex={-1} aria-hidden="true" />

      <div>
        <label htmlFor="name" className="block text-[12px] tracking-[0.1em] uppercase text-bark mb-[7px]">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          className="w-full border border-hairline rounded-[9px] px-4 py-[11px] text-[15px] bg-paper text-ink placeholder:text-bark/50 focus:outline-none focus:border-cedar transition-colors"
          placeholder="Your name"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-[12px] tracking-[0.1em] uppercase text-bark mb-[7px]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full border border-hairline rounded-[9px] px-4 py-[11px] text-[15px] bg-paper text-ink placeholder:text-bark/50 focus:outline-none focus:border-cedar transition-colors"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="message" className="block text-[12px] tracking-[0.1em] uppercase text-bark mb-[7px]">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="w-full border border-hairline rounded-[9px] px-4 py-[11px] text-[15px] bg-paper text-ink placeholder:text-bark/50 focus:outline-none focus:border-cedar transition-colors resize-none"
          placeholder="What's on your mind?"
        />
      </div>

      {result && 'error' in result && (
        <p className="text-[14px] text-cedar">{result.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-cedar text-paper text-[15px] font-medium py-[13px] rounded-[10px] transition-colors hover:bg-heartwood disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
