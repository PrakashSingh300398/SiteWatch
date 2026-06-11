import { startUptimeWorker }  from './uptime'
import { startSslWorker }     from './ssl'
import { startScheduler }     from './scheduler'
import { startEventsWorker }  from './events'
import { startHealthWorker }  from './health'
import { startVulnWorker }    from './vuln'

export async function startWorkers() {
  const uptimeWorker    = startUptimeWorker()
  const sslWorker       = startSslWorker()
  const schedulerWorker = await startScheduler()
  const eventsWorker    = startEventsWorker()
  const healthWorker    = startHealthWorker()
  const vulnWorker      = startVulnWorker()

  console.log('[workers] uptime, ssl, scheduler, events, health, vuln started')

  return { uptimeWorker, sslWorker, schedulerWorker, eventsWorker, healthWorker, vulnWorker }
}
