/**
 * The app's icon set: Central Icon System (Iconists), the same library the design uses.
 *
 * Variant: round, filled, corner radius 2, stroke 2
 * (`@central-icons-react/round-filled-radius-2-stroke-2`).
 * Round / filled / stroke 2 were matched against the Figma frames. The three corner-radius
 * options differ by about 1% of pixels at this size, so radius 2 is a default, not a reading.
 *
 * Installing the package needs CENTRAL_LICENSE_KEY in the environment: see README.
 * `name` stays stable so screens never import icon names directly.
 */
import {
  IconArrowBoxLeft,
  IconArrowUpRight,
  IconBell,
  IconBubbleInfo,
  IconBubbleQuestion,
  IconCalendar2,
  IconCalendarRepeat,
  IconChevronRight,
  IconDotGrid1x3Horizontal,
  IconFileDownload,
  IconGarage,
  IconHeadphones,
  IconHomeDoor,
  IconLock,
  IconMagnifyingGlass,
  IconMapPin,
  IconMoneyHand,
  IconNoteText,
  IconPeopleIdCard2,
  IconPlusMedium,
  IconResize,
  IconSettingsGear1,
  IconSquareGridCircle,
  IconStore1,
  IconSuitcaseWork,
  IconTeam,
  IconTruck,
  IconUser,
} from "@central-icons-react/round-filled-radius-2-stroke-2";

/** The Sagora mark. Brand, not part of the icon library: replace with the designer's SVG. */
function LogoMark({ size = 24, ...rest }: { size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
      <g fill="currentColor">
        <circle cx="12" cy="12" r="2.6" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x="11" y="1.5" width="2" height="8" rx="1" transform={`rotate(${a} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

const ICONS = {
  logo: LogoMark,
  home: IconHomeDoor,
  requests: IconFileDownload,
  quotes: IconNoteText,
  jobs: IconSuitcaseWork,
  equipment: IconTruck,
  payments: IconMoneyHand,
  bell: IconBell,
  team: IconTeam,
  reports: IconBubbleQuestion,
  settings: IconSettingsGear1,
  help: IconHeadphones,
  account: IconPeopleIdCard2,
  logout: IconArrowBoxLeft,
  search: IconMagnifyingGlass,
  chevron: IconChevronRight,
  // "See all" in the design is a diagonal arrow, not a chevron: it leaves this screen.
  arrowOut: IconArrowUpRight,
  store: IconStore1,
  lock: IconLock,
  plus: IconPlusMedium,
  dots: IconDotGrid1x3Horizontal,
  pin: IconMapPin,
  user: IconUser,
  // Request detail rows, matched to the Requests design (15-6284).
  serviceType: IconSquareGridCircle,
  farmSize: IconResize,
  calendar: IconCalendar2,
  calendarAlt: IconCalendarRepeat,
  village: IconGarage,
  info: IconBubbleInfo,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const C = ICONS[name];
  return <C size={size} className="icon" aria-hidden />;
}
