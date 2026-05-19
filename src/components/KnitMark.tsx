type KnitMarkProps = {
  size?: number
  className?: string
  /** Inverse = white container with navy mark; default is navy container with white mark. */
  inverse?: boolean
}

/**
 * KnitMark — Knit's brand mark for the Stake Suite.
 *
 * Treatment matches the v0.25.1 home-screen / PWA icon:
 *   - rounded square container in Knit rose (#E11D48 — the Gathered "K"
 *     chip color), or white in `inverse`
 *   - white interlocking rings ("knit together")
 *   - gold heart at the join — ties to Mosiah 18:21
 *
 * Previously the container was navy to match the rest of the suite chrome;
 * the cross-app icon refresh moved every app to its own brand color so the
 * home-screen icon, the Gathered chip, and the in-app mark all agree.
 */
export default function KnitMark({ size = 32, className = '', inverse = false }: KnitMarkProps) {
  const containerFill = inverse ? '#FFFFFF' : '#E11D48'
  const stroke = inverse ? '#E11D48' : '#FFFFFF'
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
