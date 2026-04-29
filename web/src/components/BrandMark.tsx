export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-label="NeuroWorks">
      <defs>
        <linearGradient id="nw-y" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6a623" />
          <stop offset="100%" stopColor="#e9911a" />
        </linearGradient>
        <linearGradient id="nw-v" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9d6bff" />
          <stop offset="100%" stopColor="#6438c9" />
        </linearGradient>
        <linearGradient id="nw-c" x1="0.5" y1="1" x2="0.5" y2="0">
          <stop offset="0%" stopColor="#ee5a3c" />
          <stop offset="100%" stopColor="#ff7657" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="11" r="7" fill="#15140f" stroke="#cdc6b4" strokeWidth="1.5" />
      <path d="M32 22 L8 56 L32 44 Z" fill="url(#nw-y)" />
      <path d="M32 22 L56 56 L32 44 Z" fill="url(#nw-v)" />
      <path d="M8 56 L56 56 L32 44 Z" fill="url(#nw-c)" />
    </svg>
  );
}
