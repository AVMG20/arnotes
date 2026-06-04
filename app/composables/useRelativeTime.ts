import {
  formatDistanceToNow,
  isToday,
  isTomorrow,
  isYesterday,
  differenceInCalendarDays,
  format
} from 'date-fns'

export function relativeTime(ts: number | Date): string {
  const date = new Date(ts)
  const now = new Date()

  if (isToday(date)) {
    const mins = Math.round((now.getTime() - date.getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ago`
  }
  if (isYesterday(date)) return 'yesterday'
  if (isTomorrow(date)) return 'tomorrow'

  const diff = differenceInCalendarDays(date, now)
  if (diff > 1 && diff < 7) return `in ${diff} days`
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`

  return format(date, date.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

export function relativeTimeFull(ts: number | Date): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true })
}
