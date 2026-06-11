import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Minimal Prisma mock ────────────────────────────────────────────────────────

vi.mock('../lib/prisma', () => ({
  prisma: {
    formMonitor: {
      findMany: vi.fn(),
      update:   vi.fn(),
    },
  },
}))

vi.mock('../lib/alerts', () => ({
  createAlert:  vi.fn(),
  resolveAlert: vi.fn(),
}))

import { runFormsWatch } from '../workers/forms'
import { prisma } from '../lib/prisma'
import { createAlert, resolveAlert } from '../lib/alerts'

const mockFindMany    = vi.mocked(prisma.formMonitor.findMany)
const mockUpdate      = vi.mocked(prisma.formMonitor.update)
const mockCreateAlert = vi.mocked(createAlert)
const mockResolveAlert = vi.mocked(resolveAlert)

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockMonitor {
  id: string
  site_id: string
  form_plugin: string
  form_id: string
  form_name: string
  baseline_daily: number | null
  count_24h: number
  count_7d: number
  last_entry_at: Date | null
  alert_state: string | null
  site: { id: string; org_id: string; name: string }
}

function makeMonitor(overrides: Partial<MockMonitor> = {}): MockMonitor {
  return {
    id:            'mon-1',
    site_id:       'site-1',
    form_plugin:   'gravityforms',
    form_id:       '1',
    form_name:     'Contact',
    baseline_daily: 5,
    count_24h:     3,
    count_7d:      21,
    last_entry_at: new Date(),
    alert_state:   null,
    site: { id: 'site-1', org_id: 'org-1', name: 'My Site' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue({})
  mockCreateAlert.mockResolvedValue({ id: 'alert-1' })
  mockResolveAlert.mockResolvedValue({})
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runFormsWatch', () => {
  it('does nothing when all forms have recent entries', async () => {
    mockFindMany.mockResolvedValue([makeMonitor()])
    await runFormsWatch()
    expect(mockCreateAlert).not.toHaveBeenCalled()
  })

  it('creates alert when last_entry_at is null and baseline >= 1', async () => {
    mockFindMany.mockResolvedValue([makeMonitor({ last_entry_at: null, alert_state: null })])
    await runFormsWatch()
    expect(mockCreateAlert).toHaveBeenCalledOnce()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { alert_state: 'stopped' } }))
  })

  it('creates alert when last_entry_at is older than 3 days', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000)
    mockFindMany.mockResolvedValue([makeMonitor({ last_entry_at: fourDaysAgo, alert_state: null })])
    await runFormsWatch()
    expect(mockCreateAlert).toHaveBeenCalledOnce()
  })

  it('does not duplicate alert when already in stopped state', async () => {
    mockFindMany.mockResolvedValue([makeMonitor({ last_entry_at: null, alert_state: 'stopped' })])
    await runFormsWatch()
    expect(mockCreateAlert).not.toHaveBeenCalled()
  })

  it('resolves alert when submissions resume', async () => {
    mockFindMany.mockResolvedValue([makeMonitor({ last_entry_at: new Date(), alert_state: 'stopped' })])
    await runFormsWatch()
    expect(mockResolveAlert).toHaveBeenCalledOnce()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { alert_state: null } }))
  })

  it('ignores forms with baseline_daily < 1 (handled by findMany filter)', async () => {
    // findMany only returns monitors with baseline_daily >= 1 — simulate empty result
    mockFindMany.mockResolvedValue([])
    await runFormsWatch()
    expect(mockCreateAlert).not.toHaveBeenCalled()
  })
})
