/**
 * Label + field wrapper used by every object, story, and market form.
 *
 * The <label> wraps its children rather than sitting beside them, which gives
 * implicit label association for free — no htmlFor/id plumbing at ~20 call
 * sites. Before this, the label was a sibling with no association at all, so
 * screen readers announced the inputs unlabelled and tests couldn't select
 * them by their visible name.
 */
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
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">
        {label} {hint && <span className="text-xs text-bark font-normal ml-1">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
