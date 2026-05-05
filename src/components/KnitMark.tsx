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
 *   - prominent gold heart at the join, matching the visual weight of the
 *     gold accent on the other suite marks (Magnify's lens, Steward's
 *     check, Glean's wheat, Tidings's signal sweep). The heart ties to
 *     the verse Knit is named for: "their hearts were knit together in
 *     unity and in love" — Mosiah 18:21.
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
      {/* Gold heart at the join. Two rounded lobes meeting in the cleft,
          sloping down to a point. Sized to read clearly at 28px and to
          balance the weight of Steward's check and Magnify's lens. */}
      <path
        d="M32 41 C 28 38, 24 35, 24 30 C 24 27, 26 25, 28.5 25 C 30.5 25, 32 26.5, 32 28 C 32 26.5, 33.5 25, 35.5 25 C 38 25, 40 27, 40 30 C 40 35, 36 38, 32 41 Z"
        fill={accent}
      />
    </svg>
  )
}
