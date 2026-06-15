import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { callClaude, AI_MODEL_FAST, stripPii } from '../lib/anthropic'
import { BULL_CONNECTION } from '../lib/queue'

// Monthly quota by plan
const PLAN_QUOTA: Record<string, number> = {
  starter: 100,
  pro:     500,
  agency:  500,
}

async function getMonthlyUsage(orgId: string): Promise<number> {
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  return prisma.aiInsight.count({
    where: {
      site: { org_id: orgId },
      kind: 'brief',
      created_at: { gte: monthStart },
    },
  })
}

export async function runAiBrief(alertId: string): Promise<void> {
  // Idempotency: one brief per alert
  const existing = await prisma.aiInsight.findFirst({
    where: { alert_id: alertId, kind: 'brief' },
  })
  if (existing) return

  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      site: {
        select: {
          id: true, url: true, name: true, org_id: true,
          wp_version: true, php_version: true, active_theme: true,
          org: { select: { plan: true } },
        },
      },
    },
  })
  if (!alert) return

  const { site } = alert
  const quota = PLAN_QUOTA[site.org.plan] ?? 100

  // Check quota
  const usage = await getMonthlyUsage(site.org_id)
  if (usage >= quota) {
    console.info(`[ai.brief] org ${site.org_id} hit monthly quota (${usage}/${quota}), skipping`)
    return
  }

  // Get last 20 events for context (strip PII)
  const events = await prisma.event.findMany({
    where: { site_id: site.id },
    orderBy: { occurred_at: 'desc' },
    take: 20,
    select: { type: true, severity: true, occurred_at: true, actor: true, data: true },
  })

  // Get recent plugin updates for "what changed" context
  const recentUpdates = events
    .filter(e => e.type === 'plugin.updated' || e.type === 'core.updated' || e.type === 'plugin.installed')
    .slice(0, 5)
    .map(e => {
      const d = e.data as Record<string, unknown> | null
      return `${e.type}: ${String(d?.name ?? d?.version ?? '')}`
    })

  const theme = site.active_theme as Record<string, string> | null

  const systemPrompt = `You are SiteWatch, a WordPress monitoring assistant for web agencies.
Provide concise, actionable analysis. Never mention passwords, usernames, emails, or API keys.
Format your response with exactly two sections labeled "What happened:" and "How to fix:" on their own lines.`

  const eventLines = events
    .slice(0, 15)
    .map(e => {
      const safe = stripPii(e.data)
      const actor = stripPii(e.actor) as Record<string, unknown> | null
      const actorStr = actor?.user_login ? ` by ${actor.user_login}` : ''
      return `- [${e.severity}] ${e.type}${actorStr} at ${new Date(e.occurred_at).toISOString()} ${safe ? JSON.stringify(safe).slice(0, 120) : ''}`
    })
    .join('\n')

  const userPrompt = `Alert triggered on WordPress site "${site.name}" (${site.url}):

Severity: ${alert.severity.toUpperCase()}
Alert: ${alert.title}
Details: ${alert.body}

Site context:
- WordPress ${site.wp_version ?? 'unknown'}, PHP ${site.php_version ?? 'unknown'}
- Active theme: ${theme?.name ?? 'unknown'} v${theme?.version ?? '?'}
${recentUpdates.length > 0 ? `- Recent changes: ${recentUpdates.join('; ')}` : ''}

Recent activity (newest first):
${eventLines || '(no recent events)'}

Provide 3-5 sentences explaining the likely cause and 2-4 concrete fix steps.`

  try {
    const { text, usage } = await callClaude({
      model:       AI_MODEL_FAST,
      maxTokens:   512,
      systemPrompt,
      userPrompt,
    })

    await prisma.aiInsight.create({
      data: {
        site_id:           site.id,
        alert_id:          alertId,
        kind:              'brief',
        model:             AI_MODEL_FAST,
        prompt_tokens:     usage.input_tokens,
        completion_tokens: usage.output_tokens,
        content:           text,
      },
    })

    console.info(`[ai.brief] alert ${alertId} brief generated (${usage.input_tokens}in/${usage.output_tokens}out)`)
  } catch (err) {
    // Graceful degradation — alert was already delivered, brief is optional
    console.warn('[ai.brief] failed:', (err as Error).message)
  }
}

export function startAiWorker() {
  return new Worker(
    'ai',
    async job => {
      if (job.name === 'ai.brief') {
        const { alertId } = job.data as { alertId: string }
        await runAiBrief(alertId)
      }
    },
    { connection: BULL_CONNECTION, concurrency: 2 },
  )
}
