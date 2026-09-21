import { addDays, addMonths, addWeeks, addYears, format, isValid, nextDay, previousDay, startOfDay, type Day } from 'date-fns'

// What can be typed after `@`: a small natural-language date parser. It reads
// English and Dutch, because notes here are written in both.
//
//   today · tomorrow · yesterday · now · vandaag · morgen · overmorgen
//   fri · next friday · last monday · volgende week · next month
//   in 3 days · 2w · 10 days ago · over 2 weken
//   25 dec · dec 25 · 25-12 · 25/12/2026 · 2026-12-25
//   …any of which may end in a time: 15:00 · 9am · at 14 · om 9u
//
// A date without a time is stored as local midnight, which is how the chip
// knows not to show one.

export interface DateItem {
  id: string
  label: string
  hint: string
  date: string
}

const WEEKDAYS: Record<string, Day> = {
  sunday: 0, sun: 0, zondag: 0, zo: 0,
  monday: 1, mon: 1, maandag: 1, ma: 1,
  tuesday: 2, tue: 2, tues: 2, dinsdag: 2, di: 2,
  wednesday: 3, wed: 3, woensdag: 3, wo: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, donderdag: 4, do: 4,
  friday: 5, fri: 5, vrijdag: 5, vr: 5,
  saturday: 6, sat: 6, zaterdag: 6, za: 6
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, januari: 0,
  february: 1, feb: 1, februari: 1,
  march: 2, mar: 2, maart: 2, mrt: 2,
  april: 3, apr: 3,
  may: 4, mei: 4,
  june: 5, jun: 5, juni: 5,
  july: 6, jul: 6, juli: 6,
  august: 7, aug: 7, augustus: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, oktober: 9, okt: 9,
  november: 10, nov: 10,
  december: 11, dec: 11
}

type Unit = 'day' | 'week' | 'month' | 'year'

const UNITS: Record<string, Unit> = {
  d: 'day', day: 'day', days: 'day', dag: 'day', dagen: 'day',
  w: 'week', wk: 'week', week: 'week', weeks: 'week', weken: 'week',
  m: 'month', mo: 'month', month: 'month', months: 'month', maand: 'month', maanden: 'month',
  y: 'year', yr: 'year', year: 'year', years: 'year', jaar: 'year'
}

const NEXT = new Set(['next', 'volgende', 'komende'])
const LAST = new Set(['last', 'previous', 'vorige', 'afgelopen'])

function shift(date: Date, amount: number, unit: Unit): Date {
  if (unit === 'day') return addDays(date, amount)
  if (unit === 'week') return addWeeks(date, amount)
  if (unit === 'month') return addMonths(date, amount)
  return addYears(date, amount)
}

function plural(amount: number, unit: Unit): string {
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`
}

// ─── Time of day ─────────────────────────────────────────────

interface Time { hours: number, minutes: number }

// Takes a trailing time off the query: "fri 15:00", "tomorrow at 9am", "morgen om 14u".
function splitTime(query: string): { rest: string, time: Time | null } {
  const match = /(?:^|\s)(?:(?:at|om|@)\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|u|uur|h)?$/i.exec(query)
  if (!match) return { rest: query, time: null }
  const [whole, hourText, minuteText, suffix] = match
  const explicit = !!minuteText || !!suffix || /(?:at|om|@)\s*\d/i.test(whole)
  // A bare number is a day of the month or an amount, not an hour.
  if (!explicit) return { rest: query, time: null }

  let hours = Number(hourText)
  const minutes = Number(minuteText ?? 0)
  const meridiem = suffix?.toLowerCase()
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  if (hours > 23 || minutes > 59) return { rest: query, time: null }
  return { rest: query.slice(0, match.index).trim(), time: { hours, minutes } }
}

// ─── Day ─────────────────────────────────────────────────────

interface DayMatch { label: string, date: Date }

function candidate(label: string, date: Date): DayMatch[] {
  return isValid(date) ? [{ label, date }] : []
}

// Words that stand for a day on their own, matched by prefix so the list
// narrows as it is typed.
function keywordDays(text: string, today: Date): DayMatch[] {
  const keywords: [string[], string, Date][] = [
    [['today', 'vandaag'], 'Today', today],
    [['tomorrow', 'tmr', 'morgen'], 'Tomorrow', addDays(today, 1)],
    [['overmorgen'], 'Day after tomorrow', addDays(today, 2)],
    [['yesterday', 'gisteren'], 'Yesterday', addDays(today, -1)],
    [['next week', 'volgende week'], 'Next week', addWeeks(today, 1)],
    [['next month', 'volgende maand'], 'Next month', addMonths(today, 1)],
    [['next year', 'volgend jaar'], 'Next year', addYears(today, 1)],
    [['last week', 'vorige week'], 'Last week', addWeeks(today, -1)],
    [['last month', 'vorige maand'], 'Last month', addMonths(today, -1)]
  ]
  return keywords
    .filter(([words]) => words.some(word => word.startsWith(text)))
    .map(([, label, date]) => ({ label, date }))
}

function weekdayDays(text: string, today: Date): DayMatch[] {
  const words = text.split(' ')
  const direction = words.length === 2 ? words[0]! : ''
  const name = words.length === 2 ? words[1]! : words[0]!
  if (words.length > 2 || (direction && !NEXT.has(direction) && !LAST.has(direction))) return []

  const days = new Set<Day>()
  for (const [word, day] of Object.entries(WEEKDAYS)) {
    // Two-letter Dutch abbreviations ("do", "ma") only match whole.
    if (name && (word === name || (word.length > 2 && name.length >= 2 && word.startsWith(name)))) days.add(day)
  }

  return [...days].map((day) => {
    if (LAST.has(direction)) return { label: `Last ${WEEKDAY_NAMES[day]}`, date: previousDay(today, day) }
    // "Next friday" is the coming Friday; the hint spells out which date that is.
    return { label: `${NEXT.has(direction) ? 'Next ' : ''}${WEEKDAY_NAMES[day]}`, date: nextDay(today, day) }
  })
}

function relativeDays(text: string, today: Date): DayMatch[] {
  const ago = /^(\d{1,3})\s*([a-z]+)\s+(?:ago|geleden)$/.exec(text)
  if (ago) {
    const unit = UNITS[ago[2]!]
    return unit ? candidate(`${plural(Number(ago[1]), unit)} ago`, shift(today, -Number(ago[1]), unit)) : []
  }

  const ahead = /^(?:(?:in|over)\s+)?(\d{1,3})\s*([a-z]*)$/.exec(text)
  if (!ahead) return []
  const amount = Number(ahead[1])
  const typed = ahead[2]!
  // With the unit still missing or half typed, offer every unit it could be.
  const units = [...new Set(Object.entries(UNITS).filter(([word]) => word.startsWith(typed)).map(([, unit]) => unit))]
  const prefixed = /^(in|over)\s/.test(text)
  if (!typed && !prefixed) return []
  return units.flatMap(unit => candidate(`In ${plural(amount, unit)}`, shift(today, amount, unit)))
}

function withYear(today: Date, month: number, day: number, year?: number): Date {
  if (year !== undefined) return new Date(year < 100 ? 2000 + year : year, month, day)
  const thisYear = new Date(today.getFullYear(), month, day)
  // Without a year a date means the next time it comes round.
  return thisYear.getTime() < today.getTime() ? new Date(today.getFullYear() + 1, month, day) : thisYear
}

function realDate(date: Date, month: number, day: number): boolean {
  return isValid(date) && date.getMonth() === month && date.getDate() === day
}

function explicitDays(text: string, today: Date): DayMatch[] {
  let date: Date | null = null
  let month = 0
  let day = 0

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const numeric = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(text)
  const dayMonth = /^(\d{1,2})(?:st|nd|rd|th|e)?\s+([a-z]+)\.?(?:\s+(\d{4}))?$/.exec(text)
  const monthDay = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(text)

  if (iso) {
    month = Number(iso[2]) - 1
    day = Number(iso[3])
    date = new Date(Number(iso[1]), month, day)
  } else if (numeric) {
    // Day first, as it is written in Dutch.
    day = Number(numeric[1])
    month = Number(numeric[2]) - 1
    date = withYear(today, month, day, numeric[3] ? Number(numeric[3]) : undefined)
  } else if (dayMonth && dayMonth[2]! in MONTHS) {
    day = Number(dayMonth[1])
    month = MONTHS[dayMonth[2]!]!
    date = withYear(today, month, day, dayMonth[3] ? Number(dayMonth[3]) : undefined)
  } else if (monthDay && monthDay[1]! in MONTHS) {
    day = Number(monthDay[2])
    month = MONTHS[monthDay[1]!]!
    date = withYear(today, month, day, monthDay[3] ? Number(monthDay[3]) : undefined)
  }

  if (!date || !realDate(date, month, day)) return []
  return [{ label: format(date, date.getFullYear() === today.getFullYear() ? 'MMMM d' : 'MMMM d, yyyy'), date }]
}

// ─── Suggestions ─────────────────────────────────────────────

function toItem({ label, date }: DayMatch, time: Time | null): DateItem {
  const at = new Date(date)
  if (time) at.setHours(time.hours, time.minutes, 0, 0)
  return {
    id: `${label}-${at.getTime()}`,
    label: time ? `${label}, ${format(at, 'HH:mm')}` : label,
    hint: format(at, at.getFullYear() === new Date().getFullYear() ? 'EEE, MMM d' : 'EEE, MMM d, yyyy'),
    date: at.toISOString()
  }
}

const LIMIT = 7

export function suggestDates(query: string, now = new Date()): DateItem[] {
  const today = startOfDay(now)
  const text = query.toLowerCase().replace(/\s+/g, ' ').trim()

  if (!text) {
    return [
      { label: 'Today', date: today },
      { label: 'Tomorrow', date: addDays(today, 1) },
      ...weekdayDays('monday', today),
      ...weekdayDays('friday', today),
      { label: 'Next week', date: addWeeks(today, 1) },
      { label: 'In 2 weeks', date: addWeeks(today, 2) },
      { label: 'Next month', date: addMonths(today, 1) }
    ].map(match => toItem(match, null))
  }

  const items: DateItem[] = []
  if ('now'.startsWith(text) || 'nu' === text) {
    items.push({ id: 'now', label: 'Now', hint: format(now, 'EEE, MMM d · HH:mm'), date: now.toISOString() })
  }

  const { rest, time } = splitTime(text)
  // "15:00" on its own is today at that time.
  const attempts: [string, Time | null][] = rest === text ? [[text, null]] : [[rest, time], [text, null]]
  for (const [dayText, at] of attempts) {
    const days = dayText
      ? [...keywordDays(dayText, today), ...weekdayDays(dayText, today), ...relativeDays(dayText, today), ...explicitDays(dayText, today)]
      : [{ label: 'Today', date: today }]
    items.push(...days.map(match => toItem(match, at)))
    if (items.length) break
  }

  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.date + item.label) && seen.add(item.date + item.label)).slice(0, LIMIT)
}
