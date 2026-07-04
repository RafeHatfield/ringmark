'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createObject, checkWorkshopId } from '@/actions/objects'
import { FormField } from '@/components/form-field'
import { OBJECT_TYPES, OBJECT_STATUSES, SPECIES_CONFIDENCE_LEVELS } from '@/lib/constants'
import type { ObjectType, ObjectStatus, SpeciesConfidence } from '@/lib/types'

export const fieldClass =
  'w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar disabled:opacity-50'

export default function ObjectForm({
  suggestedId,
  defaultType,
  parent,
}: {
  suggestedId: string
  defaultType?: ObjectType
  parent?: { id: string; workshopId: string }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [workshopId, setWorkshopId] = useState(suggestedId)
  const [idError, setIdError] = useState('')
  const [type, setType] = useState<ObjectType | ''>(defaultType ?? '')
  const [status, setStatus] = useState<ObjectStatus | ''>('')
  const [title, setTitle] = useState('')
  const [species, setSpecies] = useState('')
  const [speciesConf, setSpeciesConf] = useState<SpeciesConfidence | ''>('')
  const [stepNotes, setStepNotes] = useState('')
  const [privateNotes, setPrivateNotes] = useState('')
  const [formError, setFormError] = useState('')

  const isSource = type === 'source'
  const hasType = type !== ''

  async function handleBlurId() {
    const val = workshopId.trim()
    if (!val) return
    const { available } = await checkWorkshopId(val)
    setIdError(available ? '' : `"${val.toUpperCase()}" is already taken.`)
  }

  function handleIdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
    setWorkshopId(val)
    setIdError('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!type) { setFormError('Select a type.'); return }
    if (!workshopId.trim()) { setFormError('Workshop ID is required.'); return }
    if (idError) return
    setFormError('')

    startTransition(async () => {
      const result = await createObject({
        workshop_id: workshopId,
        object_type: type as ObjectType,
        parent_id: parent?.id,
        title: title || null,
        species: species || null,
        species_confidence: parent ? undefined : (speciesConf || null),
        status: status || null,
        private_notes: privateNotes || null,
        public_story: parent ? (stepNotes || null) : undefined,
      })
      if (result.error) {
        setFormError(result.error)
      } else if (result.id) {
        router.push(`/objects/${result.id}`)
      }
    })
  }

  function handleCancel() {
    if (parent) router.push(`/objects/${parent.id}`)
    else router.back()
  }

  const workshopIdField = (
    <FormField label="Workshop ID">
      <input
        value={workshopId}
        onChange={handleIdChange}
        onBlur={handleBlurId}
        className={`${fieldClass} font-mono`}
        placeholder={parent ? undefined : 'RH1'}
        required
        maxLength={20}
      />
      {idError
        ? <p className="mt-1 text-xs text-destructive">{idError}</p>
        : (
            <p className="mt-1 text-xs text-bark">
              {parent
                ? `Flat suffix under root — e.g. ${parent.workshopId.split('-')[0]}-3`
                : 'Auto-generated — edit if you prefer a different ID.'}
            </p>
          )
      }
    </FormField>
  )

  const statusField = (
    <FormField label="Status" hint="optional">
      <select value={status} onChange={e => setStatus(e.target.value as ObjectStatus)} className={fieldClass}>
        <option value="">None</option>
        {OBJECT_STATUSES.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </FormField>
  )

  const titleField = (
    <FormField label="Title" hint="optional">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        className={fieldClass}
        placeholder={parent ? 'e.g. First bowl blank' : 'e.g. Backyard maple — Lynn Valley'}
        maxLength={200}
      />
    </FormField>
  )

  const speciesField = parent ? (
    <FormField label="Species" hint="optional">
      <input
        value={species}
        onChange={e => setSpecies(e.target.value)}
        className={fieldClass}
        placeholder="Inherits from parent if blank"
        maxLength={100}
      />
    </FormField>
  ) : (
    <FormField label="Species" hint="optional">
      <div className="flex gap-2">
        <input
          value={species}
          onChange={e => setSpecies(e.target.value)}
          className={fieldClass}
          placeholder="e.g. Hard maple"
          maxLength={100}
        />
        {species && (
          <select
            value={speciesConf}
            onChange={e => setSpeciesConf(e.target.value as SpeciesConfidence)}
            className="shrink-0 border border-hairline rounded-md px-2 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
          >
            <option value="">Confidence</option>
            {SPECIES_CONFIDENCE_LEVELS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        )}
      </div>
    </FormField>
  )

  const stepNotesField = (
    <FormField label="Step notes" hint="optional · shown in journey">
      <textarea
        value={stepNotes}
        onChange={e => setStepNotes(e.target.value)}
        className={`${fieldClass} min-h-[80px] resize-y`}
        placeholder="What's notable about this step?"
      />
    </FormField>
  )

  const privateNotesField = (
    <FormField label="Private notes" hint="optional">
      <textarea
        value={privateNotes}
        onChange={e => setPrivateNotes(e.target.value)}
        className={`${fieldClass} min-h-[80px] resize-y`}
        placeholder={
          parent
            ? undefined
            : (isSource ? 'Where did this wood come from? Who gave it to you?' : 'Any notes for yourself (never shown publicly).')
        }
      />
    </FormField>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {parent && (
        <div className="flex items-center gap-2 px-3 py-2 bg-sand rounded-md text-sm">
          <span className="text-bark">Child of</span>
          <span className="font-mono font-medium">{parent.workshopId}</span>
        </div>
      )}

      {parent && workshopIdField}

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Type <span className="text-destructive">*</span>
        </label>
        <select value={type} onChange={e => setType(e.target.value as ObjectType)} className={fieldClass} required>
          <option value="">Select type…</option>
          {OBJECT_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {(parent || hasType) && (
        <>
          {!parent && workshopIdField}
          {(parent || !isSource) && statusField}
          {titleField}
          {speciesField}
          {parent && stepNotesField}
          {privateNotesField}

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !!idError}
              className="flex-1 bg-cedar text-paper rounded-md px-4 py-2.5 text-sm font-medium hover:bg-heartwood disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </form>
  )
}
