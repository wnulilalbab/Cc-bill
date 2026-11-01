// "Today" for the screens: the device's local calendar date (YYYY-MM-DD), not the UTC one. In Jakarta (UTC+7) the
// UTC date is still yesterday until 07:00, which would show the wrong "As of" date and installments snapshot.
export function localIsoDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
