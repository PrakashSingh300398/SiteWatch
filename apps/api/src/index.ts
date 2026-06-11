import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { prisma } from './lib/prisma'
import { redis } from './lib/redis'
import authPlugin from './plugins/auth'
import authRoutes from './routes/auth'
import sitesRoutes from './routes/sites'
import devicesRoutes from './routes/devices'
import dashboardRoutes from './routes/dashboard'
import alertsRoutes from './routes/alerts'
import eventsRoutes from './routes/events'
import { startWorkers } from './workers/index'

const isProd = process.env.NODE_ENV === 'production'

const app = Fastify({
  logger: isProd
    ? true
    : { transport: { target: 'pino-pretty', options: { colorize: true } } },
})

async function main() {
  // ── Security middleware ────────────────────────────────────────────────────
  await app.register(cors, { origin: true })
  await app.register(helmet)

  // ── Raw body capture (required for HMAC verification on agent routes) ──────
  // preParsing fires before any content-type parser, giving us the raw stream.
  // We collect it into req.rawBody and return a new stream so the default JSON
  // parser can still populate req.body normally.
  app.addHook('preParsing', async (_req, _reply, payload) => {
    const chunks: Buffer[] = []
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }
    const raw = Buffer.concat(chunks).toString('utf-8')
    _req.rawBody = raw
    const { Readable } = await import('node:stream')
    return Readable.from(raw)
  })

  // ── Auth plugin (adds fastify.authenticate decorator) ──────────────────────
  await app.register(authPlugin)

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(authRoutes)
  await app.register(sitesRoutes)
  await app.register(devicesRoutes)
  await app.register(dashboardRoutes)
  await app.register(alertsRoutes)
  await app.register(eventsRoutes)

  // ── Healthcheck ────────────────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version ?? '0.1.0',
        db: 'connected',
      })
    } catch {
      return reply.status(503).send({ status: 'error', db: 'unavailable' })
    }
  })

  // ── Background workers ─────────────────────────────────────────────────────
  const workers = await startWorkers()

  // ── Listen ─────────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT ?? 3000)
  await app.listen({ port, host: '0.0.0.0' })

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`)
    await Promise.all([
      workers.uptimeWorker.close(),
      workers.sslWorker.close(),
      workers.schedulerWorker.close(),
      workers.eventsWorker.close(),
      workers.healthWorker.close(),
      workers.vulnWorker.close(),
    ])
    await app.close()
    await prisma.$disconnect()
    await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
