'use server'

import { Resend } from 'resend'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type ContactResult = { success: true } | { error: string }

export async function sendContactEmail(_prev: ContactResult | null, formData: FormData): Promise<ContactResult> {
  const name = (formData.get('name') as string | null)?.trim()
  const email = (formData.get('email') as string | null)?.trim()
  const message = (formData.get('message') as string | null)?.trim()
  const honeypot = formData.get('_trap') as string | null

  if (honeypot) return { success: true } // silent drop

  if (!name || !email || !message) {
    return { error: 'All fields are required.' }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address.' }
  }

  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.CONTACT_EMAIL
  if (!apiKey || !to) return { error: 'Contact form is not configured.' }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: 'Ringmark <hello@paceway.app>',
    to,
    replyTo: email,
    subject: `[Ringmark] Message from ${name}`,
    text: `From: ${name} <${email}>\n\n${message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`,
  })

  if (error) {
    console.error('[contact]', error)
    return { error: 'Something went wrong. Please try again.' }
  }

  return { success: true }
}
