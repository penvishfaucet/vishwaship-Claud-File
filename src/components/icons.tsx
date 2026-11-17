/** Inline icons that match the live site's hand-drawn SVGs (stroke 2.4 arrow etc.). */
export function ArrowRight({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function Underline() {
  return (
    <svg viewBox="0 0 130 14" preserveAspectRatio="none" aria-hidden="true">
      <path d="M3 10 C 40 4, 90 3, 127 6" stroke="var(--orange)" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
