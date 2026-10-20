// Time-zone labels shared by the setup screens, Settings and the review queue. Kept in ui/ so
// shared UI never imports from app/ (app/setup/languages re-exports it).

/** "Europe/London" → "London"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function timeZoneCity(zone: string): string {
  return (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
}
