import { Queue } from 'bullmq'

// BullMQ bundles its own ioredis. Pass plain connection options to avoid
// the type mismatch that occurs when passing an external ioredis instance.
function parseBullConnection(url: string) {
  try {
    const u = new URL(url)
    return {
      host: u.hostname,
      port: Number(u.port) || 6379,
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      ...(u.pathname && u.pathname !== '/' ? { db: Number(u.pathname.slice(1)) || 0 } : {}),
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
    }
  } catch {
    return { host: 'localhost', port: 6379, maxRetriesPerRequest: null as null, enableReadyCheck: false }
  }
}

export const BULL_CONNECTION = parseBullConnection(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
)

export const uptimeQueue    = new Queue('uptime',    { connection: BULL_CONNECTION })
export const sslQueue       = new Queue('ssl',       { connection: BULL_CONNECTION })
export const schedulerQueue = new Queue('scheduler', { connection: BULL_CONNECTION })
export const eventsQueue    = new Queue('events',    { connection: BULL_CONNECTION })
export const healthQueue    = new Queue('health',    { connection: BULL_CONNECTION })
export const vulnQueue      = new Queue('vuln',      { connection: BULL_CONNECTION })
export const formsQueue     = new Queue('forms',     { connection: BULL_CONNECTION })
export const vitalsQueue    = new Queue('vitals',    { connection: BULL_CONNECTION })
export const digestQueue    = new Queue('digest',    { connection: BULL_CONNECTION })
export const gscQueue       = new Queue('gsc',       { connection: BULL_CONNECTION })
export const seoCrawlQueue  = new Queue('seoCrawl',  { connection: BULL_CONNECTION })
export const aiQueue        = new Queue('ai',        { connection: BULL_CONNECTION })
