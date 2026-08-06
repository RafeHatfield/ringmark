'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMarketEvent } from '@/actions/market-events'
import { FormField } from '@/components/form-field'
import { fieldClass } from '@/components/object-form'

export default function MarketEventForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [locationText, setLocationText] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setFormError('Name is required.')
      return
    }
    setFormError('')

    startTransition(async () => {
      const result = await createMarketEvent({
        name,
        event_date: eventDate || null,
        location_text: locationText || null,
        notes: notes || null,
      })
      if (result.error) {
        setFormError(result.error)
      } else if (result.id) {
        router.push(`/markets/${result.id}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormField label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
          placeholder="e.g. Saturday Farmers Market"
          maxLength={200}
          required
        />
      </FormField>

      <FormField label="Date" hint="optional">
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className={fieldClass}
        />
      </FormField>

      <FormField label="Location" hint="optional">
        <input
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          className={fieldClass}
          placeholder="e.g. Kitsilano Farmers Market"
          maxLength={200}
        />
      </FormField>

      <FormField label="Notes" hint="optional">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${fieldClass} min-h-[80px] resize-y`}
          placeholder="Table fee, setup time, what sold well last time…"
        />
      </FormField>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isPending}
          className="px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 bg-cedar text-paper rounded-md px-4 py-2.5 text-sm font-medium hover:bg-heartwood disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
