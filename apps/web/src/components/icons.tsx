/**
 * Cyflow icon set — black line icons drawn 1:1 from the approved prototype.
 * Each icon is a 24×24 stroke glyph; `sw` controls stroke width so the same
 * glyph can sit in the rail (1.9), a bubble (1.7), or the panel head (1.8).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { sw?: number };

function Glyph({ sw = 1.8, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      // Default to 1em so an unsized icon can never balloon to fill its flex
      // parent; explicit width/height props (spread below) still override this.
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function WebhookIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M9 6.5a3 3 0 1 1 4.9 2.32L11 14" />
      <path d="M6.5 15a3 3 0 1 0 3 3h5.2" />
      <path d="M15.5 9a3 3 0 1 1-1.6 5.5L11 10" />
    </Glyph>
  );
}

export function HttpIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" />
    </Glyph>
  );
}

export function TelegramIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M21 4 3 11l6 2.2L11 20l3-4.6L21 4Z" />
      <path d="M9 13.2 21 4" />
    </Glyph>
  );
}

export function RouterIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="5" cy="12" r="2.4" />
      <circle cx="19" cy="6" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <path d="M7.4 11 16.6 6.7" />
      <path d="M7.4 13l9.2 4.3" />
    </Glyph>
  );
}

export function IteratorIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 7h11l-2.5-2.5M4 7l2.5 2.5" />
      <path d="M20 17H9l2.5 2.5M20 17l-2.5-2.5" />
    </Glyph>
  );
}

export function AggregatorIcon(p: IconProps) {
  // Stacked layers — many bundles collected into one.
  return (
    <Glyph {...p}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </Glyph>
  );
}

export function OpenAiIcon(p: IconProps) {
  // Six-point spark — an AI mark.
  return (
    <Glyph {...p}>
      <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </Glyph>
  );
}

export function SlackIcon(p: IconProps) {
  // Channel hash.
  return (
    <Glyph {...p}>
      <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />
    </Glyph>
  );
}

export function GmailIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </Glyph>
  );
}

export function SheetsIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M4 15h16M10 4v16" />
    </Glyph>
  );
}

export function DataStoreIcon(p: IconProps) {
  // Database cylinder — the built-in key-value store.
  return (
    <Glyph {...p}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </Glyph>
  );
}

export function DiscordIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M7 6.5C9 5.7 15 5.7 17 6.5c2 3 2.5 6.5 2 11-1.4 1-3 1.7-4.5 2l-1-2c.8-.2 1.6-.5 2.3-1M6.5 15.7c.7.5 1.5.8 2.3 1l-1 2C6.3 18.2 4.7 17.5 3 16.5c-.5-4.5 0-8 2-11" />
      <circle cx="9.5" cy="13" r="1.1" />
      <circle cx="14.5" cy="13" r="1.1" />
    </Glyph>
  );
}
export function NotionIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8v8M9 8l6 8M15 8v8" />
    </Glyph>
  );
}
export function AirtableIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M9 10v9.5" />
    </Glyph>
  );
}
export function GithubIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="6" r="2.2" />
      <path d="M6.5 8.2v7.6M17.5 8.2V11a4 4 0 0 1-4 4H8.7" />
    </Glyph>
  );
}
export function GitlabIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M12 21 4 10l1.6-5 2.4 5h8l2.4-5L20 10 12 21Z" />
    </Glyph>
  );
}
export function DropboxIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M7 4 3.5 7 7 10l3.5-3L7 4ZM17 4l-3.5 3L17 10l3.5-3L17 4ZM3.5 13 7 10l3.5 3L7 16l-3.5-3ZM17 10l3.5 3L17 16l-3.5-3 3.5-3ZM8.5 17.5 12 15l3.5 2.5L12 20l-3.5-2.5Z" />
    </Glyph>
  );
}
export function CloudflareIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M15 16H6a3 3 0 0 1-.3-6A5 5 0 0 1 15 11a3.5 3.5 0 0 1 0 5Z" />
      <path d="M15 16h3.5a2.5 2.5 0 0 0 0-5H15" />
    </Glyph>
  );
}
export function SupabaseIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M12 3v8h6L12 21v-8H6l6-10Z" />
    </Glyph>
  );
}
export function TrelloIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <rect x="6.5" y="7" width="4" height="9" rx="1" />
      <rect x="13.5" y="7" width="4" height="5" rx="1" />
    </Glyph>
  );
}
export function AsanaIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="6.5" r="2.6" />
      <circle cx="6.5" cy="15" r="2.6" />
      <circle cx="17.5" cy="15" r="2.6" />
    </Glyph>
  );
}
export function HubspotIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="17" cy="8" r="2.4" />
      <circle cx="7" cy="16" r="3" />
      <path d="M17 10.4V13a3.5 3.5 0 0 1-3.5 3.5H10M17 5.6V4" />
    </Glyph>
  );
}
export function ClickupIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 15.5 8 11l4 3.5L16 10l4 5.5" />
      <path d="M8 7l4-3 4 3" />
    </Glyph>
  );
}
export function CalendlyIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M15 9.5a4 4 0 1 0 0 5" />
    </Glyph>
  );
}
export function TwilioIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9.5" cy="9.5" r="1.4" />
      <circle cx="14.5" cy="9.5" r="1.4" />
      <circle cx="9.5" cy="14.5" r="1.4" />
      <circle cx="14.5" cy="14.5" r="1.4" />
    </Glyph>
  );
}
export function StripeIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9 10.5c0-1 4-1.4 4 .3 0 1.6-4 1-4 2.8 0 1.3 3 1.3 4 .4" />
    </Glyph>
  );
}
export function ShopifyIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M14 4.5c-.6 0-1.2.4-1.6 1-.5-.3-1-.4-1.5-.3L6 6.5 5 20l10 1.5L16 6l-2-1.5Z" />
      <path d="M12 9c-1.6 0-2.4 1-2.4 2 0 1.6 2.6 1.6 2.6 3 0 .8-.8 1.2-1.7.9" />
    </Glyph>
  );
}
export function WooIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="3" />
      <path d="M7 10.5l1.2 4 1.3-4M11 10.5l1.2 4 1.3-4M15.5 10.5l1.2 4 1.3-4" />
    </Glyph>
  );
}
export function RssIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="6.5" cy="17.5" r="1.6" />
      <path d="M5 11a8 8 0 0 1 8 8M5 5.5a13.5 13.5 0 0 1 13.5 13.5" />
    </Glyph>
  );
}
export function WhatsappIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 20l1.4-4A8 8 0 1 1 8 18.6L4 20Z" />
      <path d="M9 9c0 4 2 6 6 6 .5-1.5.2-1.8-1-2.3-.8-.3-1 .6-1.6.4-1-.4-1.9-1.3-2.3-2.3-.2-.6.7-.8.4-1.6C10.4 8.3 10.5 8 9 8.5" />
    </Glyph>
  );
}
export function TwitterIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 4l7 9-7 7h2l6-6 5 6h4l-7.5-9.3L20 4h-2l-5.3 5.4L8 4H4Z" />
    </Glyph>
  );
}
export function ContactsIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="10.5" r="2.2" />
      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" />
    </Glyph>
  );
}
export function TasksIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 7l2 2 3-3M4 13l2 2 3-3M4 19l2 2 3-3" />
      <path d="M13 7h7M13 13h7M13 19h7" />
    </Glyph>
  );
}
export function YoutubeIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M11 9.5v5l4-2.5-4-2.5Z" />
    </Glyph>
  );
}
export function MondayIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M3 15c1.5-4 3-4 4.5 0M9.5 15c1.5-4 3-4 4.5 0" />
      <circle cx="18.5" cy="15.5" r="2" />
    </Glyph>
  );
}
export function DatabaseIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
    </Glyph>
  );
}
export function MongoIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M12 3c3 4 3 10 0 14-3-4-3-10 0-14Z" />
      <path d="M12 17v4" />
    </Glyph>
  );
}
export function RedisIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M3 7l9-3 9 3-9 3-9-3Z" />
      <path d="M3 12l9 3 9-3M3 16.5l9 3 9-3" />
    </Glyph>
  );
}
export function OutlookIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="10" y="6" width="11" height="12" rx="1.5" />
      <path d="M21 8l-5.5 4L10 8" />
      <rect x="2.5" y="4.5" width="9" height="15" rx="2" />
      <ellipse cx="7" cy="12" rx="2.3" ry="2.8" />
    </Glyph>
  );
}
export function OneDriveIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M8 17h10a3 3 0 0 0 .4-6A5 5 0 0 0 9 9.2 4 4 0 0 0 8 17Z" />
      <path d="M8 17a3.5 3.5 0 0 1-.5-7" />
    </Glyph>
  );
}
export function SunIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </Glyph>
  );
}
export function MoonIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
    </Glyph>
  );
}
export function ManualIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 8.5l5 3.5-5 3.5V8.5Z" />
    </Glyph>
  );
}
export function DriveIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M8 3h8l6 10h-8L8 3Z" />
      <path d="M2 17 8 7l4 6-4 8H2Z" />
      <path d="M22 13l-4 8H10l4-8h8Z" />
    </Glyph>
  );
}
export function BracesIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M8 4c-1.7 0-2.5.9-2.5 2.6V9c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v2.4C5.5 17.1 6.3 18 8 18" />
      <path d="M16 4c1.7 0 2.5.9 2.5 2.6V9c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v2.4c0 1.7-.8 2.6-2.5 2.6" />
    </Glyph>
  );
}
export function DelayIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </Glyph>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Glyph sw={2.1} {...p}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

export function ResetIcon(p: IconProps) {
  return (
    <Glyph sw={2} {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
    </Glyph>
  );
}

/** Solid play triangle (fill, not stroke). */
export function PlayIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" aria-hidden="true" {...p}>
      <path d="M7 5v14l12-7z" />
    </svg>
  );
}

/** Check mark — used in success badges (sw 3) and chips (sw 3.2). */
export function CheckIcon({ sw = 3, ...rest }: IconProps) {
  return (
    <Glyph sw={sw} {...rest}>
      <path d="M5 13l4 4L19 7" />
    </Glyph>
  );
}

/* ---- product / nav / ui icons ---- */
export function DashboardIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </Glyph>
  );
}
export function ScenariosIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="5" cy="6" r="2.4" />
      <circle cx="19" cy="12" r="2.4" />
      <circle cx="5" cy="18" r="2.4" />
      <path d="M7.3 7l9.4 4M7.3 17l9.4-4" />
    </Glyph>
  );
}
export function TemplateIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 9v11" />
    </Glyph>
  );
}
export function ConnectionsIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M9 7l-3 3a3.5 3.5 0 0 0 5 5l3-3" />
      <path d="M15 17l3-3a3.5 3.5 0 0 0-5-5l-3 3" />
    </Glyph>
  );
}
export function ExecutionsIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </Glyph>
  );
}
export function SettingsIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </Glyph>
  );
}
export function SearchIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Glyph>
  );
}
export function ChevronRightIcon(p: IconProps) {
  return (
    <Glyph sw={2.2} {...p}>
      <path d="M9 6l6 6-6 6" />
    </Glyph>
  );
}
export function ChevronDownIcon(p: IconProps) {
  return (
    <Glyph sw={2.2} {...p}>
      <path d="M6 9l6 6 6-6" />
    </Glyph>
  );
}
export function ArrowLeftIcon(p: IconProps) {
  return (
    <Glyph sw={2} {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Glyph>
  );
}
export function MinusIcon(p: IconProps) {
  return (
    <Glyph sw={2.1} {...p}>
      <path d="M5 12h14" />
    </Glyph>
  );
}
export function FitIcon(p: IconProps) {
  return (
    <Glyph sw={2} {...p}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    </Glyph>
  );
}
export function XIcon(p: IconProps) {
  return (
    <Glyph sw={2.1} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Glyph>
  );
}
export function CalendarIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </Glyph>
  );
}
export function MoreIcon(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" aria-hidden="true" {...p}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
export function CopyIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </Glyph>
  );
}
export function TrashIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
    </Glyph>
  );
}
export function DuplicateIcon(p: IconProps) {
  return (
    <Glyph {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </Glyph>
  );
}
export function BoltIcon(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" aria-hidden="true" {...p}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}
