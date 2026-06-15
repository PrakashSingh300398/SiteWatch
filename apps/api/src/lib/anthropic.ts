const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

export const AI_MODEL_FAST  = process.env.AI_MODEL_FAST  ?? 'claude-haiku-4-5-20251001'
export const AI_MODEL_SMART = process.env.AI_MODEL_SMART ?? 'claude-sonnet-4-6'

export interface AnthropicUsage {
  input_tokens: number
  output_tokens: number
}

export interface AnthropicResponse {
  content: Array<{ type: string; text: string }>
  usage: AnthropicUsage
}

export async function callClaude(opts: {
  model: string
  maxTokens: number
  systemPrompt?: string
  userPrompt: string
}): Promise<{ text: string; usage: AnthropicUsage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: opts.userPrompt },
  ]

  const body: Record<string, unknown> = {
    model:      opts.model,
    max_tokens: opts.maxTokens,
    messages,
  }
  if (opts.systemPrompt) body.system = opts.systemPrompt

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': API_VERSION,
      'content-type':      'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Anthropic API error ${resp.status}: ${text}`)
  }

  const data = await resp.json() as AnthropicResponse
  const text = data.content.find(c => c.type === 'text')?.text ?? ''
  return { text, usage: data.usage }
}

// Strip PII from event data before sending to AI
export function stripPii(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    // Redact email-like strings
    return obj.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
  }
  if (Array.isArray(obj)) return obj.map(stripPii)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      // Drop sensitive fields entirely
      if (['password', 'password_hash', 'site_key', 'site_key_hash', 'refresh_token', 'token', 'secret'].includes(k)) continue
      // Redact IP to first two octets only
      if (k === 'ip' && typeof v === 'string') {
        const parts = v.split('.')
        out[k] = parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : '[ip]'
        continue
      }
      // Redact email fields
      if (['email', 'user_email'].includes(k)) {
        out[k] = '[email]'
        continue
      }
      out[k] = stripPii(v)
    }
    return out
  }
  return obj
}
