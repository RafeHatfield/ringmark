'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveStory, publishObject, unpublishObject } from '@/actions/story'
import { DEFAULT_CARE_INSTRUCTIONS } from '@/lib/constants'

const fieldClass =
  'w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar disabled:opacity-50'

type Props = {
  objectId: string
  publicSlug: string
  isPublished: boolean
  publicTitle: string | null
  publicStory: string | null
  publicNotes: string | null
  publicCare: string | null
}

export default function StoryEditor({
  objectId,
  publicSlug,
  isPublished,
  publicTitle,
  publicStory,
  publicNotes,
  publicCare,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [title, setTitle] = useState(publicTitle ?? '')
  const [story, setStory] = useState(publicStory ?? '')
  const [notes, setNotes] = useState(publicNotes ?? '')
  const [care, setCare] = useState(publicCare ?? DEFAULT_CARE_INSTRUCTIONS)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaved(false)
    startTransition(async () => {
      const result = await saveStory(objectId, {
        public_title: title,
        public_story: story,
        public_notes: notes,
        public_care: care,
      })
      if (result.error) {
        setSaveError(result.error)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    })
  }

  function handlePublish() {
    startTransition(async () => {
      const result = await publishObject(objectId)
      if (result.error) setSaveError(result.error)
      else router.refresh()
    })
  }

  function handleUnpublish() {
    if (!confirm('Unpublish? The public page will no longer be visible.')) return
    startTransition(async () => {
      const result = await unpublishObject(objectId)
      if (result.error) setSaveError(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Publish status bar */}
      <div className="flex items-center justify-between gap-4 p-4 border border-hairline rounded-md bg-sand/50">
        <div>
          <p className="text-sm font-medium">
            {isPublished ? 'Published' : 'Not published'}
          </p>
          {isPublished && (
            <a
              href={`/p/${publicSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-bark underline"
            >
              /p/{publicSlug} ↗
            </a>
          )}
          {!isPublished && (
            <p className="text-xs text-bark mt-0.5">
              Save your story, then publish to make it visible.
            </p>
          )}
        </div>
        {isPublished ? (
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={isPending}
            className="shrink-0 px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors disabled:opacity-50"
          >
            Unpublish
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPending}
            className="shrink-0 px-4 py-1.5 bg-cedar text-paper rounded-md text-sm font-medium hover:bg-heartwood disabled:opacity-50 transition-colors"
          >
            Publish
          </button>
        )}
      </div>

      {/* Story form */}
      <form onSubmit={handleSave} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Public title{' '}
            <span className="text-xs text-bark font-normal ml-1">optional</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
            placeholder="e.g. Lynn Valley Maple"
            maxLength={200}
          />
          <p className="mt-1 text-xs text-bark">
            Shown at the top of the public page. Defaults to the workshop ID if blank.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Story{' '}
            <span className="text-xs text-bark font-normal ml-1">optional</span>
          </label>
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            className={`${fieldClass} min-h-[140px] resize-y`}
            placeholder="Where this wood came from, why it matters to you, what it became…"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Public notes{' '}
            <span className="text-xs text-bark font-normal ml-1">optional</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${fieldClass} min-h-[80px] resize-y`}
            placeholder="Species, dimensions, finish — anything you want buyers to know"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Care instructions</label>
          <textarea
            value={care}
            onChange={(e) => setCare(e.target.value)}
            className={`${fieldClass} min-h-[80px] resize-y`}
          />
          <p className="mt-1 text-xs text-bark">
            Shown on the public page. Edit to suit this piece.
          </p>
        </div>

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        {saved && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push(`/objects/${objectId}`)}
            disabled={isPending}
            className="px-4 py-2.5 border border-hairline rounded-md text-sm font-medium hover:bg-sand transition-colors disabled:opacity-50"
          >
            ← Back
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 bg-cedar text-paper rounded-md px-4 py-2.5 text-sm font-medium hover:bg-heartwood disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Saving…' : saved ? 'Saved!' : 'Save draft'}
          </button>
        </div>
      </form>
    </div>
  )
}
