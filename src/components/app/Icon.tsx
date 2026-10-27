/**
 * Icons drawn to match the Figma sidebar and top bar. These are stand-ins:
 * swap them for the designer's SVG exports when they arrive.
 */
export type IconName =
  | "logo" | "home" | "requests" | "quotes" | "jobs" | "equipment" | "payments" | "bell"
  | "team" | "reports" | "settings" | "help" | "account" | "logout" | "search" | "chevron"
  | "store" | "lock" | "plus" | "dots" | "pin";

const P: Record<IconName, React.ReactNode> = {
  logo: (
    <g fill="currentColor">
      <circle cx="12" cy="12" r="2.6" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x="11" y="1.5" width="2" height="8" rx="1" transform={`rotate(${a} 12 12)`} />
      ))}
    </g>
  ),
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" fill="currentColor" />,
  requests: <path d="M6 2h8l4 4v16H6zM14 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  quotes: <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" /></g>,
  jobs: <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></g>,
  equipment: <g fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="17" r="3" /><circle cx="18" cy="17" r="2.5" /><path d="M4 14V7h6l2 4h5v6" strokeLinejoin="round" /></g>,
  payments: <g fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" /><path d="M16 9h6M19 6v6" strokeLinecap="round" /></g>,
  bell: <path d="M12 3a6 6 0 0 1 6 6v4l1.5 3h-15L6 13V9a6 6 0 0 1 6-6Zm0 19a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22Z" fill="currentColor" />,
  team: <g fill="currentColor"><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9" r="2.4" /><path d="M2.5 19c0-3.3 2.9-5.6 6.5-5.6s6.5 2.3 6.5 5.6z" /><path d="M17 13c2.6 0 4.5 1.6 4.5 3.8V19h-4z" /></g>,
  reports: <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" /></g>,
  settings: <path d="M12 2.6 20.1 7v10L12 21.4 3.9 17V7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  help: <g fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 13v-1a8 8 0 0 1 16 0v1" strokeLinecap="round" /><rect x="2.5" y="13" width="4" height="6" rx="2" /><rect x="17.5" y="13" width="4" height="6" rx="2" /></g>,
  account: <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="2.4" /><path d="M8.5 17c.6-1.7 1.9-2.6 3.5-2.6s2.9.9 3.5 2.6" strokeLinecap="round" /></g>,
  logout: <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" /><path d="M17 8.5 20.5 12 17 15.5M20 12h-9" strokeLinejoin="round" /></g>,
  search: <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></g>,
  chevron: <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  store: <path d="M4 4h16l1.4 4.5A3 3 0 0 1 18.5 12 3 3 0 0 1 16 10.6 3 3 0 0 1 13.5 12 3 3 0 0 1 11 10.6 3 3 0 0 1 8.5 12 3 3 0 0 1 6 10.6 3 3 0 0 1 2.6 8.5ZM5 12.6V20h14v-7.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />,
  lock: <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4.5" y="10" width="15" height="11" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></g>,
  plus: <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  dots: <g fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></g>,
  pin: <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Zm0-8.4a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z" fill="currentColor" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="icon">
      {P[name]}
    </svg>
  );
}
