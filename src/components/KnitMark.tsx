type KnitMarkProps = {
  size?: number
  className?: string
  /** Inverse = white container with navy mark; default is navy container with white mark. */
  inverse?: boolean
}

/**
 * KnitMark — Knit's brand mark for the Stake Suite.
 *
 * Treatment matches the v0.25.4 home-screen / PWA icon:
 *   - rounded square container in Knit rose (#E11D48 — the Gathered "K"
 *     chip color), or white in `inverse`
 *   - white interlocking rings ("knit together")
 *
 * The gold heart that used to sit at the join has been removed — the
 * design now leans on the two-rings symbolism alone. Mosiah 18:21 still
 * names the app; the glyph just doesn't render the heart literally.
 */
export default function KnitMark({ size = 32, className = '', inverse = false }: KnitMarkProps) {
  const containerFill = inverse ? '#FFFFFF' : '#E11D48'
  const stroke = inverse ? '#E11D48' : '#FFFFFF'
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
      {/* Two interlocking rings. Slightly larger + thicker than before so
          the glyph carries the square on its own now that the gold heart
          is gone. */}
      <circle
        cx="24"
        cy="32"
        r="15"
        fill="none"
        stroke={stroke}
        strokeWidth="3.8"
        strokeLinecap="round"
      />
      <circle
        cx="40"
        cy="32"
        r="15"
        fill="none"
        stroke={stroke}
        strokeWidth="3.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
