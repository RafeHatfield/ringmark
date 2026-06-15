'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { updateObject, checkWorkshopId, searchObjects } from '@/actions/objects'
import {
  OBJECT_TYPES,
  OBJECT_STATUSES,
  SPECIES_CONFIDENCE_LEVELS,
  LINEAGE_CONFIDENCE_LEVELS,
} from '@/lib/constants'
import type {
  WoodObject,
  ObjectType,
  ObjectStatus,
  SpeciesConfidence,
  LineageConfidence,
} from '@/lib/types'

const fieldClass =
  'w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50'

type ParentOption = { id: string; workshop_id: string; object_type: ObjectType }

function ParentSearch({
  onSelect,
  excludeId,
}: {
  onSelect: (opt: ParentOption) => void
  excludeId: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ParentOption[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.toUpperCase()
    setQuery(val)
    if (timer.current) clearTimeout(timer.current)
    if (!val.trim()) { setResults([]); return }
    timer.current = setTimeout(async () => {
      const data = await searchObjects(val)
      setResults(data.filter(o => o.id !== excludeId))
    }, 250)
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={handleChange}
        className={`${fieldClass} font-mono`}
        placeholder="Search by ID…"
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-background border border-input rounded-md shadow-lg divide-y divide-border">
          {results.map(r => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors"
                onClick={() => { onSelect(r); setQuery(''); setResults([]) }}
              >
                <span className="font-mono text-sm font-medium">{r.workshop_id}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {r.object_type.replace('_', ' ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Props = {
  object: WoodObject
  parentWorkshopId?: string | null
}

export default function EditObjectForm({ object, parentWorkshopId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [workshopId, setWorkshopId] = useState(object.workshop_id)
  const [idError, setIdError] = useState('')
  const [type, setType] = useState<ObjectType>(object.object_type)
  const [status, setStatus] = useState<ObjectStatus | ''>(object.status ?? '')
  const [parentId, setParentId] = useState<string | null>(object.parent_id)
  const [parentDisplay, setParentDisplay] = useState<string | null>(parentWorkshopId ?? null)
  const [showParentSearch, setShowParentSearch] = useState(false)
  const [title, setTitle] = useState(object.title ?? '')
  const [species, setSpecies] = useState(object.species ?? '')
  const [speciesConf, setSpeciesConf] = useState<SpeciesConfidence | ''>(object.species_confidence ?? '')
  const [lineageConf, setLineageConf] = useState<LineageConfidence | ''>(object.lineage_confidence ?? '')
  const [dimensions, setDimensions] = useState(object.dimensions_text ?? '')
  const [finish, setFinish] = useState(object.finish ?? '')
  const [location, setLocation] = useState(object.location_text ?? '')
  const [privateNotes, setPrivateNotes] = useState(object.private_notes ?? '')
  const [formError, setFormError] = useState('')

  async function handleBlurId() {
    const val = workshopId.trim()
    if (!val || val.toUpperCase() === object.workshop_id) { setIdError(''); return }
    const { available } = await checkWorkshopId(val, object.id)
    setIdError(available ? '' : `"${val.toUpperCase()}" is already taken.`)
  }

  function handleIdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
    setWorkshopId(val)
    setIdError('')
  }

  function handleParentSelect(opt: ParentOption) {
    setParentId(opt.id)
    setParentDisplay(opt.workshop_id)
    setShowParentSearch(false)
  }

  function handleRemoveParent() {
    setParentId(null)
    setParentDisplay(null)
    setShowParentSearch(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!workshopId.trim()) { setFormError('Workshop ID is required.'); return }
    if (idError) return
    setFormError('')

    startTransition(async () => {
      const result = await updateObject(object.id, {
        workshop_id: workshopId,
        object_type: type,
        status: status || null,
        parent_id: parentId,
        title: title || null,
        species: species || null,
        species_confidence: speciesConf || null,
        lineage_confidence: lineageConf || null,
        dimensions_text: dimensions || null,
        finish: finish || null,
        location_text: location || null,
        private_notes: privateNotes || null,
      })
      if (result.error) {
        setFormError(result.error)
      } else {
        router.push(`/objects/${object.id}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
        {idError && <p className="mt-1 text-xs text-destructive">{idError}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Type</label>
        <select value={type} onChange={e => setType(e.target.value as ObjectType)} className={fieldClass}>
          {OBJECT_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Status</label>
        <select value={status} onChange={e => setStatus(e.target.value as ObjectStatus)} className={fieldClass}>
          <option value="">None</option>
          {OBJECT_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Parent */}
      <div>
        <label className="block text-sm font-medium mb-1.5">
          Parent <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        {parentId && parentDisplay && !showParentSearch ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium px-3 py-2 border border-input rounded-md bg-secondary">
              {parentDisplay}
            </span>
            <button
              type="button"
              onClick={() => setShowParentSearch(true)}
              className="text-xs text-muted-foreground underline"
            >
              Change
            </button>
            <button
              type="button"
              onClick={handleRemoveParent}
              className="text-xs text-destructive underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <ParentSearch onSelect={handleParentSelect} excludeId={object.id} />
            {showParentSearch && (
              <button
                type="button"
                onClick={() => { setShowParentSearch(false); setParentId(object.parent_id); setParentDisplay(parentWorkshopId ?? null) }}
                className="text-xs text-muted-foreground underline"
              >
                Cancel
              </button>
            )}
            {!parentId && (
              <p className="text-xs text-muted-foreground">No parent — this object is a root source.</p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Title <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <input value={title} onChange={e => setTitle(e.target.value)} className={fieldClass} placeholder="e.g. Backyard maple — Lynn Valley" maxLength={200} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Species <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <div className="flex gap-2">
          <input value={species} onChange={e => setSpecies(e.target.value)} className={fieldClass} placeholder="e.g. Hard maple" maxLength={100} />
          {species && (
            <select value={speciesConf} onChange={e => setSpeciesConf(e.target.value as SpeciesConfidence)} className="shrink-0 border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Confidence</option>
              {SPECIES_CONFIDENCE_LEVELS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Dimensions <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <input value={dimensions} onChange={e => setDimensions(e.target.value)} className={fieldClass} placeholder='e.g. 18" diameter, 4ft length' maxLength={200} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Finish <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <input value={finish} onChange={e => setFinish(e.target.value)} className={fieldClass} placeholder="e.g. Osmo Polyx Oil" maxLength={200} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Lineage confidence <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <select value={lineageConf} onChange={e => setLineageConf(e.target.value as LineageConfidence)} className={fieldClass}>
          <option value="">Not set</option>
          {LINEAGE_CONFIDENCE_LEVELS.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Location <span className="text-xs text-muted-foreground font-normal ml-1">private · optional</span>
        </label>
        <input value={location} onChange={e => setLocation(e.target.value)} className={fieldClass} placeholder="e.g. Shelf 3, green bin" maxLength={200} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          Private notes <span className="text-xs text-muted-foreground font-normal ml-1">optional</span>
        </label>
        <textarea value={privateNotes} onChange={e => setPrivateNotes(e.target.value)} className={`${fieldClass} min-h-[80px] resize-y`} />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => router.push(`/objects/${object.id}`)} disabled={isPending} className="px-4 py-2.5 border border-input rounded-md text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={isPending || !!idError} className="flex-1 bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
