'use client'

import { useRouter } from 'next/navigation'
import { useRef } from 'react'

export function SearchInput({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (timer.current) clearTimeout(timer.current)
    const val = e.target.value.trim()
    timer.current = setTimeout(() => {
      router.push(val ? `/?q=${encodeURIComponent(val)}` : '/')
    }, 300)
  }

  return (
    <input
      type="search"
      defaultValue={defaultValue}
      onChange={handleChange}
      placeholder="Search by ID or title…"
      className="w-full border border-input rounded-md px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}
