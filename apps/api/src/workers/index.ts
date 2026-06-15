import { startUptimeWorker }  from './uptime'
import { startSslWorker }     from './ssl'
import { startScheduler }     from './scheduler'
import { startEventsWorker }  from './events'
import { startHealthWorker }  from './health'
import { startVulnWorker }    from './vuln'
import { startFormsWorker }   from './forms'
import { startVitalsWorker }  from './vitals'
import { startDigestWorker }  from './digest'
import { startGscWorker }     from './gsc'
import { startCrawlWorker }   from './crawl'
import { startAiWorker }      from './ai'

export async function startWorkers() {
  const uptimeWorker    = startUptimeWorker()
  const sslWorker       = startSslWorker()
  const schedulerWorker = await startScheduler()
  const eventsWorker    = startEventsWorker()
  const healthWorker    = startHealthWorker()
  const vulnWorker      = startVulnWorker()
  const formsWorker     = startFormsWorker()
  const vitalsWorker    = startVitalsWorker()
  const digestWorker    = startDigestWorker()
  const gscWorker       = startGscWorker()
  const crawlWorker     = startCrawlWorker()
  const aiWorker        = startAiWorker()

  console.log('[workers] uptime, ssl, scheduler, events, health, vuln, forms, vitals, digest, gsc, crawl, ai started')

  return { uptimeWorker, sslWorker, schedulerWorker, eventsWorker, healthWorker, vulnWorker, formsWorker, vitalsWorker, digestWorker, gscWorker, crawlWorker, aiWorker }
}
