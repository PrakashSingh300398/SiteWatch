const RESEND_API = 'https://api.resend.com/emails'
const FROM = process.env.RESEND_FROM_EMAIL ?? 'SiteWatch <noreply@sitewatch.app>'

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping email to', opts.to)
    return
  }

  try {
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: opts.to, subject: opts.subject, html: opts.html }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.warn(`[email] Resend error ${resp.status}: ${body}`)
    }
  } catch (err) {
    console.warn('[email] send failed:', (err as Error).message)
  }
}
