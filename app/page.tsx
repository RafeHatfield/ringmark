import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/workshop')

  return (
    <>
      <style>{`
        @keyframes rise { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        @keyframes ringIn { from { opacity:0; transform:scale(.55); } to { opacity:1; transform:scale(1); } }
        .reveal { animation: rise .7s cubic-bezier(.2,.6,.2,1) both; }
        .reveal.d1 { animation-delay:.08s; }
        .reveal.d2 { animation-delay:.16s; }
        .reveal.d3 { animation-delay:.24s; }
        .mark circle { transform-box:fill-box; transform-origin:center; animation:ringIn .9s cubic-bezier(.2,.7,.2,1) both; }
        .mark circle:nth-child(1) { animation-delay:.10s; }
        .mark circle:nth-child(2) { animation-delay:.22s; }
        .mark circle:nth-child(3) { animation-delay:.34s; }
        .mark circle:nth-child(4) { animation-delay:.46s; }
        .chain .reveal:nth-child(1) { animation-delay:.04s; }
        .chain .reveal:nth-child(2) { animation-delay:.12s; }
        .chain .reveal:nth-child(3) { animation-delay:.20s; }
        .chain .reveal:nth-child(4) { animation-delay:.28s; }
        .chain .reveal:nth-child(5) { animation-delay:.36s; }
        .chain .reveal:nth-child(6) { animation-delay:.44s; }
        @media (prefers-reduced-motion:reduce) { .reveal, .mark circle { animation:none; } }
      `}</style>

      <div className="min-h-screen bg-paper text-ink font-sans" style={{ WebkitFontSmoothing: 'antialiased' }}>
        <div className="max-w-[600px] mx-auto px-6">

          {/* Header */}
          <header className="flex items-center justify-between py-5">
            <Link href="/" className="inline-flex items-center gap-[9px] font-fraunces font-medium text-[19px] text-ink no-underline">
              <svg width="22" height="22" viewBox="0 0 40 40" fill="none" stroke="#B0612F" strokeWidth="1.6" aria-hidden="true">
                <circle cx="20.5" cy="20" r="4"/>
                <circle cx="20" cy="20" r="10"/>
                <circle cx="19.5" cy="20" r="16"/>
              </svg>
              Ringmark
            </Link>
            <Link
              href="/login"
              className="text-[14px] text-bark no-underline border border-hairline rounded-[8px] px-[15px] py-[7px] transition-colors hover:text-heartwood hover:border-cedar"
            >
              Log in
            </Link>
          </header>

          <main>
            {/* Hero */}
            <section className="text-center pt-[38px] pb-4">
              <svg
                className="mark"
                width="96" height="96" viewBox="0 0 100 100" fill="none"
                style={{ display: 'block', margin: '0 auto 26px' }}
                aria-hidden="true"
              >
                <circle cx="52" cy="50" r="6"  stroke="#7A3F1D" strokeWidth="2"/>
                <circle cx="51" cy="50" r="15" stroke="#B0612F" strokeWidth="2"/>
                <circle cx="50" cy="50" r="26" stroke="#C98A56" strokeWidth="1.8"/>
                <circle cx="49" cy="50" r="38" stroke="#DDB58A" strokeWidth="1.6"/>
              </svg>
              <h1 className="reveal font-fraunces font-medium text-[clamp(32px,9vw,44px)] leading-[1.1] tracking-[-0.015em] mb-[18px]">
                Keep the story with the piece.
              </h1>
              <p className="reveal d1 text-[17px] leading-[1.65] text-bark max-w-[38ch] mx-auto mb-[26px]">
                Ringmark keeps a handmade object&apos;s story with the object itself. You photograph a piece as it&apos;s made — from raw log to finished work — and a small code carries that whole journey to whoever holds it next.
              </p>
              <div className="reveal d2 flex flex-col items-center gap-[14px]">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 bg-cedar text-paper no-underline text-[15px] font-medium px-[26px] py-[13px] rounded-[10px] transition-colors hover:bg-heartwood"
                >
                  Log in to your workshop
                </Link>
              </div>
            </section>

            {/* How it works */}
            <section className="pt-[46px] pb-2">
              <p className="text-center text-[12px] tracking-[0.16em] uppercase text-cedar mb-[22px]">
                How it works
              </p>
              <p className="font-fraunces font-normal text-[19px] leading-[1.6] text-[#433B30] text-center max-w-[42ch] mx-auto mb-[34px]">
                You don&apos;t sit down and write a history. You take a quick photo at each step — and each one links to the step before, so the finished piece traces all the way back to the log.
              </p>
              <div className="chain max-w-[380px] mx-auto">
                {[
                  { title: 'Fresh logs', desc: 'Snap a photo. The story starts here.' },
                  { title: 'Cut to boards', desc: 'Linked to the logs they came from.' },
                  { title: 'Bowl blank', desc: 'Cut from a board.' },
                  { title: 'Rough-turned', desc: 'The shape appears.' },
                  { title: 'Finished piece', desc: 'Ready to find its person.' },
                ].map((step, i) => (
                  <div key={i} className="reveal flex gap-4 relative pb-[22px] [&:not(:last-child)]:before:content-[''] [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:left-[21px] [&:not(:last-child)]:before:top-[46px] [&:not(:last-child)]:before:bottom-[-2px] [&:not(:last-child)]:before:w-[2px] [&:not(:last-child)]:before:bg-hairline">
                    <span className="w-11 h-11 rounded-[12px] bg-sand flex items-center justify-center shrink-0 relative z-[1] text-cedar">
                      <PhotoIcon />
                    </span>
                    <div className="pt-[5px]">
                      <h3 className="font-fraunces font-medium text-[17px] text-ink m-0 mb-[2px]">{step.title}</h3>
                      <p className="m-0 text-[14px] leading-[1.5] text-bark">{step.desc}</p>
                    </div>
                  </div>
                ))}
                <div className="reveal flex gap-4 relative">
                  <span className="w-11 h-11 rounded-[12px] bg-cedar flex items-center justify-center shrink-0 relative z-[1] text-paper">
                    <QrIcon />
                  </span>
                  <div className="pt-[5px]">
                    <h3 className="font-fraunces font-medium text-[17px] text-heartwood m-0 mb-[2px]">Add the story, print the code</h3>
                    <p className="m-0 text-[14px] leading-[1.5] text-bark">When you&apos;re ready — that&apos;s it.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Philosophy */}
            <section className="text-center py-[50px] px-2">
              <p className="font-fraunces font-normal text-[22px] leading-[1.5] text-[#433B30] mb-4">
                Handmade things outlast the moment they&apos;re made. The tree they came from, the hands that shaped them, the reason they exist — that&apos;s worth keeping too.
              </p>
              <p className="text-[15px] leading-[1.6] text-bark">
                Because the things we keep longest are the ones whose story we know.
              </p>
            </section>

            {/* Maker invite */}
            <section className="bg-sand rounded-[14px] px-[26px] py-[28px] text-center mb-2">
              <h2 className="font-fraunces font-medium text-[22px] text-ink mb-[10px]">Make something worth keeping?</h2>
              <p className="text-[15px] leading-[1.6] text-bark max-w-[40ch] mx-auto mb-5">
                Ringmark is a small, hand-built project for now. If you make things and want to give your work its story, I&apos;d love to hear from you.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-cedar text-paper no-underline text-[15px] font-medium px-[26px] py-[13px] rounded-[10px] transition-colors hover:bg-heartwood"
              >
                Log in
              </Link>
              <p className="text-[14px] text-bark mt-4 mb-0">
                Not set up yet?{' '}
                <a href="mailto:hello@ringmark.org" className="text-cedar no-underline hover:text-heartwood hover:underline">
                  Get in touch
                </a>.
              </p>
            </section>
          </main>

          {/* Footer */}
          <footer className="text-center py-[36px]">
            <span className="inline-flex items-center gap-2 text-[13px] tracking-[0.04em] text-[#9C9080]">
              <svg width="15" height="15" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="20.5" cy="20" r="4"/>
                <circle cx="20" cy="20" r="10"/>
                <circle cx="19.5" cy="20" r="16"/>
              </svg>
              Ringmark
            </span>
            <p className="text-[12px] text-[#B0A491] mt-[10px] mb-0">The story stays with the piece.</p>
          </footer>

        </div>
      </div>
    </>
  )
}

function PhotoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="8.5" cy="10" r="1.5"/>
      <path d="m21 15-3.5-3.5L9 19"/>
    </svg>
  )
}

function QrIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14.5" y="14.5" width="2.5" height="2.5" fill="currentColor" stroke="none"/>
      <rect x="18.5" y="18.5" width="2.5" height="2.5" fill="currentColor" stroke="none"/>
    </svg>
  )
}
