import type { Db } from '../db/client.ts';
import { runCheckins } from './checkin.ts';
import { runDigests } from './digest.ts';
import type { Messenger } from './messenger.ts';
import { runReminders } from './reminders.ts';

const HOUR = 3_600_000;

/**
 * Runs every job once now and then at the top of each hour. Hourly is enough because
 * every schedule is day-granular; jobs are idempotent per local day, so a missed or
 * repeated tick (restart, downtime) neither drops nor duplicates a ping.
 */
export function startScheduler(db: Db, messenger: Messenger, onTick?: () => void): () => void {
  let running = false;
  let timer: NodeJS.Timeout;

  async function tick() {
    if (running) return;
    running = true;
    const now = new Date();
    for (const [name, job] of Object.entries({ runReminders, runDigests, runCheckins })) {
      try {
        const n = await job(db, messenger, now);
        if (n) console.log(`${name}: sent ${n}`);
      } catch (e) {
        console.error(`${name} failed:`, e);
      }
    }
    onTick?.();
    running = false;
  }

  function schedule() {
    timer = setTimeout(
      () => {
        void tick();
        schedule();
      },
      HOUR - (Date.now() % HOUR) + 1000,
    );
  }

  void tick();
  schedule();
  return () => clearTimeout(timer);
}
