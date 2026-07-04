export function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">
        {label} {hint && <span className="text-xs text-bark font-normal ml-1">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
