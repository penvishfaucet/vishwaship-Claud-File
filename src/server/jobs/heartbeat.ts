/**
 * Last activity of the in-process job loop (this server process), for the jobs health check. Kept on globalThis because
 * Next.js loads instrumentation and route handlers as separate module copies.
 */
type Beat = { tickAt: Date | null; doneAt: Date | null; lastRan: number; lastError: string | null; trackingSlotAt: Date | null; trackingQueued: number };
const g = globalThis as unknown as { __vsJobsBeat?: Beat };
export const jobsHeartbeat: Beat = (g.__vsJobsBeat ??= { tickAt: null, doneAt: null, lastRan: 0, lastError: null, trackingSlotAt: null, trackingQueued: 0 });
