import { and, isNotNull, lt } from 'drizzle-orm'
import { db } from '../db'
import { projectColumns, projectTasks, TRASH_RETENTION_MS } from '../db/schema'

// A board's trash empties itself. Without this a column deleted once, by an
// agent at three in the morning, would sit in the database for the life of the
// install — and "Show trashed" would slowly turn into an archive of everything
// the board has ever thrown away.
//
// Notes are deliberately not touched here: their trash is emptied by hand from
// the notes list, and that is the behaviour people already rely on.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function purge() {
  const cutoff = Date.now() - TRASH_RETENTION_MS

  // Tasks first, so the count below reflects what was actually swept: removing
  // a column takes whatever is still in it through the foreign key, and those
  // rows would otherwise disappear without the task sweep ever seeing them.
  // Their ages never disagree — deleting a column relocates its live tasks to a
  // neighbour, so the only tasks left inside one are the ones trashed alongside
  // it, carrying its exact timestamp.
  const tasks = await db
    .delete(projectTasks)
    .where(and(isNotNull(projectTasks.deletedAt), lt(projectTasks.deletedAt, cutoff)))
    .returning({ id: projectTasks.id })

  const columns = await db
    .delete(projectColumns)
    .where(and(isNotNull(projectColumns.deletedAt), lt(projectColumns.deletedAt, cutoff)))
    .returning({ id: projectColumns.id })

  return { tasks: tasks.length, columns: columns.length }
}

export default defineNitroPlugin(() => {
  const sweep = async () => {
    try {
      const { tasks, columns } = await purge()
      if (tasks || columns) {
        console.log(`[trash] purged ${tasks} task(s) and ${columns} column(s) deleted over ${TRASH_RETENTION_MS / 86400000} days ago`)
      }
    } catch (error) {
      // A failed sweep is not worth taking the server down for; the next one is
      // an hour away and the rows are still there to be collected.
      console.error('[trash] purge failed', error)
    }
  }

  // Once on boot, so a long-stopped install tidies up on the way back rather
  // than waiting out an hour first.
  void sweep()

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  // The interval must not be what keeps the process alive on shutdown.
  timer.unref?.()
})
