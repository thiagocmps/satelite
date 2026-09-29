/** Glifo de satelite (vista frontal-ish): corpo + paineis solares + antena. */
export function SatelliteIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* corpo */}
      <rect x="9.5" y="9.2" width="5" height="6.4" rx="1.3" />
      {/* paineis solares */}
      <rect x="3.4" y="10.6" width="4.4" height="1.6" rx="0.5" />
      <rect x="16.2" y="10.6" width="4.4" height="1.6" rx="0.5" />
      <rect x="3.4" y="13.4" width="4.4" height="1.6" rx="0.5" />
      <rect x="16.2" y="13.4" width="4.4" height="1.6" rx="0.5" />
      {/* antena + alimentador (ponto do sinal) */}
      <path d="M12 9.2V6.4" />
      <circle cx="12" cy="4.9" r="1.35" />
      <circle cx="12" cy="4.9" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}