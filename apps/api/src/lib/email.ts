const RESEND_API   = 'https://api.resend.com/emails'
const FROM         = process.env.RESEND_FROM_EMAIL ?? 'SiteWatch <noreply@sitewatch.app>'
const APP_SCHEME   = 'sitewatch'

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

export async function sendResetEmail(to: string, token: string): Promise<void> {
  const deepLink = `${APP_SCHEME}://reset-password?token=${token}`
  await sendEmail({
    to,
    subject: 'Reset your SiteWatch password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0f172a">Reset your SiteWatch password</h2>
        <p>Tap the button below to open the app, or enter the code manually.</p>
        <a href="${deepLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
          Reset password
        </a>
        <p style="color:#64748b;font-size:13px">Or enter this code in the Reset Password screen:<br>
          <code style="background:#f1f5f9;padding:4px 8px;border-radius:4px;font-size:15px">${token}</code>
        </p>
        <p style="color:#94a3b8;font-size:12px">Expires in 1 hour. If you didn't request this, ignore it.</p>
      </div>
    `,
  })
}
