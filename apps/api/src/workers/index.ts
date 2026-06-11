import { startUptimeWorker }  from './uptime'
import { startSslWorker }     from './ssl'
import { startScheduler }     from './scheduler'
import { startEventsWorker }  from './events'
import { startHealthWorker }  from './health'
import { startVulnWorker }    from './vuln'
import { startFormsWorker }   from './forms'
import { startVitalsWorker }  from './vitals'
import { startDigestWorker }  from './digest'

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

  console.log('[workers] uptime, ssl, scheduler, events, health, vuln, forms, vitals, digest started')

  return { uptimeWorker, sslWorker, schedulerWorker, eventsWorker, healthWorker, vulnWorker, formsWorker, vitalsWorker, digestWorker }
}
