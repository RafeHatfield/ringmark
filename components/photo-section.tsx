'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createBrowserClient } from '@supabase/ssr'
import {
  createPhotoRecord,
  deletePhoto,
  updatePhotoCaption,
  togglePhotoVisibility,
  movePhoto,
} from '@/actions/photos'
import { resizeImage } from '@/lib/image-resize'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export type PhotoData = {
  id: string
  storage_path: string
  caption: string | null
  is_public: boolean
  sort_order: number
  signedUrl: string | null
}

export function PhotoSection({
  objectId,
  accountId,
  initialPhotos,
}: {
  objectId: string
  accountId: string
  initialPhotos: PhotoData[]
}) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadCount, setUploadCount] = useState({ done: 0, total: 0 })
  const [editingCaption, setEditingCaption] = useState<string | null>(null)
  const [captionValue, setCaptionValue] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleFiles(files: FileList) {
    if (!files.length) return
    setUploading(true)
    setUploadError('')
    setUploadCount({ done: 0, total: files.length })

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      let resized: Blob
      try {
        resized = await resizeImage(file)
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : `Could not process "${file.name}"`)
        setUploadCount({ done: i + 1, total: files.length })
        continue
      }

      const filename = `${crypto.randomUUID()}.jpg`
      const path = `${accountId}/${objectId}/${filename}`

      const { error: storageError } = await supabase.storage
        .from('object-photos')
        .upload(path, resized, { upsert: false, contentType: 'image/jpeg' })

      if (storageError) {
        setUploadError(storageError.message)
        setUploading(false)
        return
      }

      const result = await createPhotoRecord(objectId, path, null)
      if (result.error) {
        setUploadError(result.error)
        setUploading(false)
        return
      }

      setUploadCount({ done: i + 1, total: files.length })
    }

    setUploading(false)
    router.refresh()
  }

  function handleDelete(photoId: string) {
    startTransition(async () => {
      const result = await deletePhoto(photoId)
      setConfirmingDeleteId(null)
      if (result.error) setUploadError(result.error)
      else router.refresh()
    })
  }

  function startEditCaption(photo: PhotoData) {
    setEditingCaption(photo.id)
    setCaptionValue(photo.caption ?? '')
  }

  function handleSaveCaption(photoId: string) {
    startTransition(async () => {
      await updatePhotoCaption(photoId, captionValue.trim() || null)
      setEditingCaption(null)
      router.refresh()
    })
  }

  function handleToggleVisibility(photoId: string) {
    startTransition(async () => {
      await togglePhotoVisibility(photoId)
      router.refresh()
    })
  }

  function handleMove(photoId: string, direction: 'up' | 'down') {
    startTransition(async () => {
      await movePhoto(photoId, direction)
      router.refresh()
    })
  }

  const sorted = [...initialPhotos].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div>
      {/* Upload button */}
      <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-input rounded-md text-sm hover:bg-accent transition-colors cursor-pointer mb-4">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple
          className="sr-only"
          disabled={uploading}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        {uploading
          ? `Uploading ${uploadCount.done}/${uploadCount.total}…`
          : '+ Add Photo'}
      </label>

      {uploadError && (
        <p className="mb-4 text-sm text-destructive">{uploadError}</p>
      )}

      {sorted.length === 0 ? (
        <div className="border rounded-md px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No photos yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {sorted.map((photo, idx) => (
            <div key={photo.id} className="border rounded-md overflow-hidden">
              {/* Photo */}
              <div className="aspect-square bg-secondary relative">
                {photo.signedUrl ? (
                  <Image
                    src={photo.signedUrl}
                    alt={photo.caption ?? ''}
                    fill
                    sizes="(max-width: 672px) 50vw, 336px"
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                    No preview
                  </div>
                )}
                {!photo.is_public && (
                  <span className="absolute top-1 right-1 text-xs px-1.5 py-0.5 bg-background/80 rounded text-muted-foreground">
                    Private
                  </span>
                )}
              </div>

              {/* Caption */}
              <div className="px-2 py-1.5">
                {editingCaption === photo.id ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={captionValue}
                      onChange={(e) => setCaptionValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveCaption(photo.id)
                        if (e.key === 'Escape') setEditingCaption(null)
                      }}
                      className="flex-1 text-xs border rounded px-1.5 py-1 bg-background"
                      placeholder="Add caption…"
                      maxLength={200}
                    />
                    <button
                      onClick={() => handleSaveCaption(photo.id)}
                      disabled={isPending}
                      className="text-xs px-1.5 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setEditingCaption(null)}
                      className="text-xs px-1.5 py-1 border rounded"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEditCaption(photo)}
                    className="text-xs text-muted-foreground hover:text-foreground text-left w-full truncate"
                  >
                    {photo.caption ?? <span className="italic">Add caption…</span>}
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 px-2 pb-2">
                <button
                  onClick={() => handleMove(photo.id, 'up')}
                  disabled={idx === 0 || isPending}
                  className="text-xs px-1.5 py-0.5 border rounded disabled:opacity-30 hover:bg-accent"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => handleMove(photo.id, 'down')}
                  disabled={idx === sorted.length - 1 || isPending}
                  className="text-xs px-1.5 py-0.5 border rounded disabled:opacity-30 hover:bg-accent"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  onClick={() => handleToggleVisibility(photo.id)}
                  disabled={isPending}
                  className="text-xs px-1.5 py-0.5 border rounded disabled:opacity-50 hover:bg-accent"
                  title={photo.is_public ? 'Make private' : 'Make public'}
                >
                  {photo.is_public ? '👁' : '🔒'}
                </button>
                {confirmingDeleteId === photo.id ? (
                  <span className="flex items-center gap-1 ml-auto">
                    <button
                      onClick={() => handleDelete(photo.id)}
                      disabled={isPending}
                      className="text-xs px-1.5 py-0.5 bg-destructive text-destructive-foreground rounded disabled:opacity-50"
                    >
                      {isPending ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={isPending}
                      className="text-xs px-1.5 py-0.5 border rounded"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmingDeleteId(photo.id)}
                    disabled={isPending}
                    className="text-xs px-1.5 py-0.5 border border-destructive text-destructive rounded disabled:opacity-50 hover:bg-destructive/10 ml-auto"
                    title="Delete photo"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
