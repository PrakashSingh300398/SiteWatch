import { describe, it, expect } from 'vitest'

// Pure helper extracted from the correlation logic so it can be unit-tested
// without a DB. The worker itself is integration-tested via the full stack.

interface CauseEvent {
  type: string
  occurred_at: Date
  data: Record<string, unknown> | null
}

function buildCorrelatedBody(
  baseBody: string,
  causeEvent: CauseEvent | null,
  downtimeAt: Date,
): string {
  if (!causeEvent) return baseBody
  const name = String(causeEvent.data?.name ?? causeEvent.data?.plugin ?? causeEvent.type)
  const sec = Math.round((downtimeAt.getTime() - new Date(causeEvent.occurred_at).getTime()) / 1000)
  return `${baseBody}\n\nLikely cause: "${name}" was updated ${sec}s before the outage.`
}

describe('downtime correlation', () => {
  const downtimeAt = new Date('2026-06-11T12:00:00Z')
  const baseBody = 'Returned HTTP 503'

  it('returns base body when no cause event', () => {
    expect(buildCorrelatedBody(baseBody, null, downtimeAt)).toBe(baseBody)
  })

  it('appends cause note using data.name', () => {
    const cause: CauseEvent = {
      type: 'plugin_updated',
      occurred_at: new Date('2026-06-11T11:58:30Z'),  // 90s before
      data: { name: 'WooCommerce', plugin: 'woocommerce/woocommerce.php' },
    }
    const result = buildCorrelatedBody(baseBody, cause, downtimeAt)
    expect(result).toContain('WooCommerce')
    expect(result).toContain('90s before the outage')
  })

  it('falls back to data.plugin when name is absent', () => {
    const cause: CauseEvent = {
      type: 'plugin_updated',
      occurred_at: new Date('2026-06-11T11:59:00Z'),  // 60s before
      data: { plugin: 'contact-form-7/wp-contact-form-7.php' },
    }
    const result = buildCorrelatedBody(baseBody, cause, downtimeAt)
    expect(result).toContain('contact-form-7/wp-contact-form-7.php')
    expect(result).toContain('60s before the outage')
  })

  it('falls back to event type when data is null', () => {
    const cause: CauseEvent = {
      type: 'core_updated',
      occurred_at: new Date('2026-06-11T11:57:00Z'),  // 3 min before
      data: null,
    }
    const result = buildCorrelatedBody(baseBody, cause, downtimeAt)
    expect(result).toContain('core_updated')
    expect(result).toContain('180s before the outage')
  })

  it('handles theme_updated correctly', () => {
    const cause: CauseEvent = {
      type: 'theme_updated',
      occurred_at: new Date('2026-06-11T11:59:30Z'),  // 30s before
      data: { name: 'Astra' },
    }
    const result = buildCorrelatedBody(baseBody, cause, downtimeAt)
    expect(result).toContain('Astra')
    expect(result).toContain('30s before the outage')
  })

  it('handles plugin_deactivated as a cause', () => {
    const cause: CauseEvent = {
      type: 'plugin_deactivated',
      occurred_at: new Date('2026-06-11T11:58:00Z'),  // 2 min before
      data: { name: 'WP Super Cache' },
    }
    const result = buildCorrelatedBody(baseBody, cause, downtimeAt)
    expect(result).toContain('WP Super Cache')
    expect(result).toContain('120s before the outage')
  })
})
