'use client'

import { useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveProfile } from '@/actions/profile'

interface Props {
  accountId: string
  initialDisplayName: string
  initialWorkshopName: string
  initialBio: string
  initialAvatarUrl: string | null
  initialAvatarPath: string | null
}

export function ProfileForm({
  accountId,
  initialDisplayName,
  initialWorkshopName,
  initialBio,
  initialAvatarUrl,
  initialAvatarPath,
}: Props) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatarUrl)
  const [avatarPath, setAvatarPath] = useState<string | null>(initialAvatarPath)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setSaved(false)

    const form = e.currentTarget
    const fd = new FormData(form)

    startTransition(async () => {
      let newAvatarPath = avatarPath

      if (avatarFile) {
        const supabase = createClient()
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(accountId, avatarFile, { upsert: true, contentType: avatarFile.type })

        if (uploadErr) {
          setError(`Avatar upload failed: ${uploadErr.message}`)
          return
        }
        newAvatarPath = accountId
        setAvatarPath(accountId)
        setAvatarFile(null)
      }

      if (newAvatarPath !== initialAvatarPath) {
        fd.set('avatar_storage_path', newAvatarPath ?? '')
      }

      await saveProfile(fd)
      setSaved(true)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Avatar */}
      <div>
        <label className="block text-sm font-medium mb-3">Avatar</label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-[72px] h-[72px] rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-input hover:opacity-80 transition-opacity"
          >
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <RingsIcon />
            )}
          </button>
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              {avatarPreview ? 'Change image' : 'Upload image'}
            </button>
            <p className="text-xs text-muted-foreground mt-1">JPG or PNG, shown on your public piece pages</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Display name */}
      <div className="space-y-1.5">
        <label htmlFor="display_name" className="block text-sm font-medium">
          Your name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={initialDisplayName}
          placeholder="e.g. Rafe Hatfield"
          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Workshop name */}
      <div className="space-y-1.5">
        <label htmlFor="workshop_name" className="block text-sm font-medium">
          Workshop name
        </label>
        <input
          id="workshop_name"
          name="workshop_name"
          type="text"
          defaultValue={initialWorkshopName}
          placeholder="e.g. Cedarline Woodworks"
          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Shown on public piece pages. If left blank, your name is used instead.
        </p>
      </div>

      {/* Bio */}
      <div className="space-y-1.5">
        <label htmlFor="bio" className="block text-sm font-medium">
          About you
        </label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={initialBio}
          rows={4}
          placeholder="A little about you and your work…"
          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </form>
  )
}

function RingsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted-foreground" aria-hidden="true">
      <circle cx="20.5" cy="20" r="4"/>
      <circle cx="20" cy="20" r="10"/>
      <circle cx="19.5" cy="20" r="16"/>
    </svg>
  )
}
