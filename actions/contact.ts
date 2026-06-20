'use server'

import nodemailer from 'nodemailer'

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

  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass) return { error: 'Contact form is not configured.' }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  })

  try {
    await transporter.sendMail({
      from: `Ringmark <${gmailUser}>`,
      to: gmailUser,
      replyTo: email,
      subject: `Message from ${name} via Ringmark`,
      text: `From: ${name} <${email}>\n\n${message}`,
      html: `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p><p>${message.replace(/\n/g, '<br/>')}</p>`,
    })
  } catch (err) {
    console.error('[contact]', err)
    return { error: 'Something went wrong. Please try again.' }
  }

  return { success: true }
}
