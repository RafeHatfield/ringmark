'use client'

import { useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveProfile } from '@/actions/profile'
import { slugifyHandle, isValidHandle } from '@/lib/handle'
import { RingsIcon } from '@/components/public-chrome'

interface Props {
  accountId: string
  initialHandle: string
  initialDisplayName: string
  initialWorkshopName: string
  initialBio: string
  initialWebsiteUrl: string
  initialAvatarUrl: string | null
  initialAvatarPath: string | null
}

export function ProfileForm({
  accountId,
  initialHandle,
  initialDisplayName,
  initialWorkshopName,
  initialBio,
  initialWebsiteUrl,
  initialAvatarUrl,
  initialAvatarPath,
}: Props) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatarUrl)
  const [avatarPath, setAvatarPath] = useState<string | null>(initialAvatarPath)
  const [handle, setHandle] = useState(initialHandle)
  const [handleTouched, setHandleTouched] = useState(!!initialHandle)
  const [handleError, setHandleError] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function onWorkshopNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!handleTouched) setHandle(slugifyHandle(e.target.value))
  }

  function onHandleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setHandleTouched(true)
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setHandle(val)
    if (val && !isValidHandle(val)) {
      setHandleError('Lowercase letters, numbers, and hyphens only. Min 2 characters, must start and end with a letter or number.')
    } else {
      setHandleError('')
    }
  }

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
            className="w-[72px] h-[72px] rounded-full bg-sand flex items-center justify-center overflow-hidden shrink-0 border border-hairline hover:opacity-80 transition-opacity"
          >
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <RingsIcon size={28} stroke="currentColor" strokeWidth={1.4} className="text-bark" />
            )}
          </button>
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-bark hover:text-ink transition-colors underline underline-offset-2"
            >
              {avatarPreview ? 'Change image' : 'Upload image'}
            </button>
            <p className="text-xs text-bark mt-1">JPG or PNG, shown on your public piece pages</p>
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
          className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
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
          onChange={onWorkshopNameChange}
          placeholder="e.g. Cedarline Woodworks"
          className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
        />
        <p className="text-xs text-bark">
          Shown on public piece pages. If left blank, your name is used instead.
        </p>
      </div>

      {/* Workshop URL handle */}
      <div className="space-y-1.5">
        <label htmlFor="handle" className="block text-sm font-medium">
          Workshop URL
        </label>
        <div className="flex items-center border border-hairline rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-cedar">
          <span className="px-3 py-2 text-sm text-bark bg-sand border-r border-hairline select-none whitespace-nowrap">
            ringmark.org/
          </span>
          <input
            id="handle"
            name="handle"
            type="text"
            value={handle}
            onChange={onHandleChange}
            placeholder="moon-and-moss"
            className="flex-1 px-3 py-2 text-sm bg-paper focus:outline-none min-w-0"
          />
        </div>
        {handleError && <p className="text-xs text-destructive">{handleError}</p>}
        {initialHandle && handle !== initialHandle && !handleError && (
          <p className="text-xs text-amber-700">Changing this will break existing links to your maker page.</p>
        )}
        <p className="text-xs text-bark">
          {handle && !handleError
            ? <>Your maker page: <strong>ringmark.org/{handle}/maker</strong></>
            : 'Your public maker page URL. Suggested from your workshop name.'}
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
          className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar resize-none"
        />
      </div>

      {/* Website */}
      <div className="space-y-1.5">
        <label htmlFor="website_url" className="block text-sm font-medium">
          Website
        </label>
        <input
          id="website_url"
          name="website_url"
          type="url"
          defaultValue={initialWebsiteUrl}
          placeholder="https://yourworkshop.com"
          className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
        />
        <p className="text-xs text-bark">
          Optional. Links your workshop name on public piece pages.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2.5 bg-cedar text-paper rounded-md text-sm font-medium hover:bg-heartwood disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-bark">Saved.</span>}
      </div>
    </form>
  )
}
