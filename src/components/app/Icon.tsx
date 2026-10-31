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
  IconTrashCan,
  IconTruck,
  IconUser,
} from "@central-icons-react/round-filled-radius-2-stroke-2";

const ICONS = {
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
  trash: IconTrashCan,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const C = ICONS[name];
  return <C size={size} className="icon" aria-hidden />;
}

/** The tile the design puts beside a request: a truck for ploughing, cherries for harvesting. */
export function ServiceIcon({ service }: { service: string }) {
  const harvesting = service === "harvesting";
  return (
    <span className={`request-icon${harvesting ? " request-icon--harvest" : ""}`} aria-hidden="true">
      <img src={harvesting ? "/icons/harvest.svg" : "/icons/plough.svg"} alt="" width={harvesting ? 24 : 22} height={harvesting ? 24 : 17} />
    </span>
  );
}
