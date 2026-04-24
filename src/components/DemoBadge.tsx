export default function DemoBadge({ when = true }: { when?: boolean }) {
  if (!when) return null
  return (
    <span
      title="Demo data — clear it from /admin/demo"
      className="ml-2 inline-flex items-center rounded-full bg-fuchsia-100 text-fuchsia-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide align-middle"
    >
      demo
    </span>
  )
}
