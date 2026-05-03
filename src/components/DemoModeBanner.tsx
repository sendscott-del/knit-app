import { KNIT_DEMO_ROLE_LABELS, useDemoMode, type KnitDemoRole } from '@/lib/demoMode'

/**
 * Banner shown across the top of every Knit admin screen when the trainer
 * has flipped the demo banner on. Independent of the existing
 * /admin/demo Load/Clear seed-data buttons — that controls what the
 * database holds; this banner just adds a "viewing as <role>" overlay
 * so trainers can talk through what each role experiences.
 */
export default function DemoModeBanner() {
  const { demoBannerOn, demoRole, setDemoRole, setDemoBannerOn } = useDemoMode()
  if (!demoBannerOn) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full px-4 py-2 flex items-center justify-between gap-3 text-white text-xs"
      style={{ background: 'repeating-linear-gradient(45deg, #b45309, #b45309 12px, #92400e 12px, #92400e 24px)' }}
    >
      <span className="font-bold uppercase tracking-wider">Demo</span>
      <span className="hidden sm:inline opacity-80">
        Walk through Knit as different roles. Pair with /admin/demo Load to populate the database.
      </span>
      <div className="flex items-center gap-2">
        <label className="font-medium opacity-80">Viewing as</label>
        <select
          value={demoRole}
          onChange={(e) => setDemoRole(e.target.value as KnitDemoRole)}
          className="bg-white/10 border border-white/40 rounded px-2 py-0.5 text-white"
        >
          {Object.entries(KNIT_DEMO_ROLE_LABELS).map(([k, label]) => (
            <option key={k} value={k} className="text-black">
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setDemoBannerOn(false)}
          className="ml-1 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider border border-white/50 hover:bg-white/15 rounded"
        >
          Exit
        </button>
      </div>
    </div>
  )
}

export function DemoBannerToggle() {
  const { demoBannerOn, setDemoBannerOn } = useDemoMode()
  return (
    <button
      type="button"
      onClick={() => setDemoBannerOn(!demoBannerOn)}
      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between border border-gray-200 rounded-md"
    >
      <span>Show demo role banner</span>
      <span className={`text-xs font-bold uppercase ${demoBannerOn ? 'text-amber-700' : 'text-gray-400'}`}>
        {demoBannerOn ? 'On' : 'Off'}
      </span>
    </button>
  )
}
