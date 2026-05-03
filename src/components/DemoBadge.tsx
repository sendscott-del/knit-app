export default function DemoBadge({ when = true }: { when?: boolean }) {
  if (!when) return null
  return (
    <span
      title="Demo data — clear it from /admin/demo"
      className="ml-2 inline-flex items-center rounded-full bg-brand-accent-light text-brand-primary-dark px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle border border-brand-accent/40"
    >
      Demo
    </span>
  )
}
