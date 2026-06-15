'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createObject, checkWorkshopId } from '@/actions/objects'
import { OBJECT_TYPES, OBJECT_STATUSES } from '@/lib/constants'
import type { ObjectType, ObjectStatus } from '@/lib/types'

const fieldClass =
  'w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50'

type Props = {
  parentId: string
  parentWorkshopId: string
  suggestedId: string
}

export default function ChildObjectForm({ parentId, parentWorkshopId, suggestedId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [workshopId, setWorkshopId] = useState(suggestedId)
  const [idError, setIdError] = useState('')
  const [type, setType] = useState<ObjectType | ''>('')
  const [status, setStatus] = useState<ObjectStatus | ''>('')
  const [title, setTitle] = useState('')
  const [species, setSpecies] = useState('')
  const [privateNotes, setPrivateNotes] = useState('')
  const [formError, setFormError] = useState('')

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
        parent_id: parentId,
        title: title || null,
        species: species || null,
        status: status || null,
        private_notes: privateNotes || null,
      })
      if (result.error) {
        setFormError(result.error)
      } else if (result.id) {
        router.push(`/objects/${result.id}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Parent indicator */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary rounded-md text-sm">
        <span className="text-muted-foreground">Child of</span>
        <span className="font-mono font-medium">{parentWorkshopId}</span>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Workshop ID</label>
        <input
          value={workshopId}
          onChange={handleIdChange}
          onBlur={handleBlurId}
          className={`${fieldClass} font-mono`}
          required
          maxLength={20}
        />
        {idError
          ? <p className="mt-1 text-xs text-destructive">{idError}</p>
          : <p className="mt-1 text-xs text-muted-foreground">Flat suffix under root — e.g. {parentWorkshopId.split('-')[0]}-3</p>
        }
      </div>

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

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Status <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <select value={status} onChange={e => setStatus(e.target.value as ObjectStatus)} className={fieldClass}>
          <option value="">None</option>
          {OBJECT_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Title <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className={fieldClass}
          placeholder="e.g. First bowl blank"
          maxLength={200}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Species <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <input
          value={species}
          onChange={e => setSpecies(e.target.value)}
          className={fieldClass}
          placeholder="Inherits from parent if blank"
          maxLength={100}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Private notes <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <textarea
          value={privateNotes}
          onChange={e => setPrivateNotes(e.target.value)}
          className={`${fieldClass} min-h-[80px] resize-y`}
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.push(`/objects/${parentId}`)}
          disabled={isPending}
          className="px-4 py-2.5 border border-input rounded-md text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !!idError}
          className="flex-1 bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
