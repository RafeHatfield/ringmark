import Link from 'next/link'

export function RingsIcon({
  size = 16,
  stroke = '#B0612F',
  strokeWidth = 1.6,
  className,
}: {
  size?: number
  stroke?: string
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" stroke={stroke} strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="20.5" cy="20" r="4" />
      <circle cx="20" cy="20" r="10" />
      <circle cx="19.5" cy="20" r="16" />
    </svg>
  )
}

export function PublicFooter({ paddingClassName = 'py-[30px]' }: { paddingClassName?: string }) {
  return (
    <footer className={`text-center ${paddingClassName}`}>
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[#9C9080] no-underline text-[12px] tracking-[0.05em] rounded-md px-2 py-1.5 hover:text-heartwood transition-colors"
      >
        <RingsIcon size={16} stroke="currentColor" />
        <span>Tracked with Ringmark</span>
      </Link>
    </footer>
  )
}
