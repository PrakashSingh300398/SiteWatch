import { startUptimeWorker } from './uptime'
import { startSslWorker } from './ssl'
import { startScheduler } from './scheduler'

export async function startWorkers() {
  const uptimeWorker = startUptimeWorker()
  const sslWorker = startSslWorker()
  const schedulerWorker = await startScheduler()

  console.log('[workers] uptime, ssl, scheduler started')

  return { uptimeWorker, sslWorker, schedulerWorker }
}
