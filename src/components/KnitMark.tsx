type KnitMarkProps = {
  size?: number
  className?: string
  /** Inverse = white container with navy mark; default is navy container with white mark. */
  inverse?: boolean
}

/**
 * KnitMark — Knit's brand mark for the Stake Suite.
 *
 * Treatment matches the suite pattern (Magnify, Steward, Tidings):
 *   - rounded square container, navy background by default
 *   - white stylized mark inside (two interlocked rings — "knit together")
 *   - small gold accent (matches the brand-accent that runs through every app)
 */
export default function KnitMark({ size = 32, className = '', inverse = false }: KnitMarkProps) {
  const containerFill = inverse ? '#FFFFFF' : '#1B3A6B'
  const stroke = inverse ? '#1B3A6B' : '#FFFFFF'
  const accent = '#C9A84C'
  const radius = Math.round(size * 0.225)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Knit"
    >
      <rect width="64" height="64" rx={radius * 2} fill={containerFill} />
      {/* Two interlocking rings — "hearts knit together" */}
      <circle
        cx="25"
        cy="32"
        r="13"
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle
        cx="39"
        cy="32"
        r="13"
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Gold accent dot at the join — the suite's brand-accent */}
      <circle cx="32" cy="32" r="2.5" fill={accent} />
    </svg>
  )
}
