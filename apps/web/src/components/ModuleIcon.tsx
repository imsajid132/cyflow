import {
  WebhookIcon,
  ManualIcon,
  HttpIcon,
  TelegramIcon,
  IteratorIcon,
  AggregatorIcon,
  RouterIcon,
  DataStoreIcon,
  DelayIcon,
  OpenAiIcon,
  SlackIcon,
  GmailIcon,
  SheetsIcon,
  BracesIcon,
  DriveIcon,
  CalendarIcon,
  DiscordIcon,
  NotionIcon,
  AirtableIcon,
  GithubIcon,
  GitlabIcon,
  DropboxIcon,
  CloudflareIcon,
  SupabaseIcon,
  TrelloIcon,
  AsanaIcon,
  HubspotIcon,
  ClickupIcon,
  CalendlyIcon,
  TwilioIcon,
  StripeIcon,
  ShopifyIcon,
  WooIcon,
  RssIcon,
  WhatsappIcon,
  TwitterIcon,
  ContactsIcon,
  TasksIcon,
  YoutubeIcon,
  MondayIcon,
  DatabaseIcon,
  MongoIcon,
  RedisIcon,
  OutlookIcon,
  OneDriveIcon,
  SmtpIcon,
} from "./icons";

/** Maps a module's app/operation to its app icon. */
export function ModuleIcon({ app, operation, sw }: { app: string; operation: string; sw?: number }) {
  if (app === "webhook") return <WebhookIcon sw={sw} />;
  if (app === "manual") return <ManualIcon sw={sw} />;
  if (app === "http") return <HttpIcon sw={sw} />;
  if (app === "telegram") return <TelegramIcon sw={sw} />;
  if (app === "openai") return <OpenAiIcon sw={sw} />;
  if (app === "slack") return <SlackIcon sw={sw} />;
  if (app === "gmail") return <GmailIcon sw={sw} />;
  if (app === "sheets") return <SheetsIcon sw={sw} />;
  if (app === "drive") return <DriveIcon sw={sw} />;
  if (app === "calendar") return <CalendarIcon sw={sw} />;
  if (app === "discord") return <DiscordIcon sw={sw} />;
  if (app === "notion") return <NotionIcon sw={sw} />;
  if (app === "airtable") return <AirtableIcon sw={sw} />;
  if (app === "github") return <GithubIcon sw={sw} />;
  if (app === "gitlab") return <GitlabIcon sw={sw} />;
  if (app === "dropbox") return <DropboxIcon sw={sw} />;
  if (app === "cloudflare") return <CloudflareIcon sw={sw} />;
  if (app === "supabase") return <SupabaseIcon sw={sw} />;
  if (app === "trello") return <TrelloIcon sw={sw} />;
  if (app === "asana") return <AsanaIcon sw={sw} />;
  if (app === "hubspot") return <HubspotIcon sw={sw} />;
  if (app === "clickup") return <ClickupIcon sw={sw} />;
  if (app === "calendly") return <CalendlyIcon sw={sw} />;
  if (app === "twilio") return <TwilioIcon sw={sw} />;
  if (app === "stripe") return <StripeIcon sw={sw} />;
  if (app === "shopify") return <ShopifyIcon sw={sw} />;
  if (app === "woocommerce") return <WooIcon sw={sw} />;
  if (app === "rss") return <RssIcon sw={sw} />;
  if (app === "whatsapp") return <WhatsappIcon sw={sw} />;
  if (app === "twitter") return <TwitterIcon sw={sw} />;
  if (app === "contacts") return <ContactsIcon sw={sw} />;
  if (app === "tasks") return <TasksIcon sw={sw} />;
  if (app === "youtube") return <YoutubeIcon sw={sw} />;
  if (app === "monday") return <MondayIcon sw={sw} />;
  if (app === "postgres" || app === "mysql") return <DatabaseIcon sw={sw} />;
  if (app === "mongodb") return <MongoIcon sw={sw} />;
  if (app === "redis") return <RedisIcon sw={sw} />;
  if (app === "outlook") return <OutlookIcon sw={sw} />;
  if (app === "onedrive") return <OneDriveIcon sw={sw} />;
  if (app === "smtp") return <SmtpIcon sw={sw} />;
  if (app === "core") return <DelayIcon sw={sw} />;
  if (app === "utils") return <BracesIcon sw={sw} />;
  if (app === "datastore") return <DataStoreIcon sw={sw} />;
  if (app === "flow") {
    if (operation === "router") return <RouterIcon sw={sw} />;
    if (operation === "iterator") return <IteratorIcon sw={sw} />;
    return <AggregatorIcon sw={sw} />;
  }
  return <RouterIcon sw={sw} />;
}
