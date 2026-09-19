/**
 * Minimax API adapter.
 *
 * Three things about this provider drive the shape of this file, all verified
 * against the live API rather than assumed:
 *
 *  1. `response_format: {type:'json_schema'}` is SILENTLY IGNORED. Passing a strict
 *     schema returns ordinary markdown prose with no error. So structured output
 *     has to be obtained with `json_object` plus a schema described in the prompt,
 *     then parsed defensively here.
 *  2. `json_object` responses arrive wrapped in a ```json fence, so the content is
 *     not directly JSON.parse-able.
 *  3. Every model is a reasoning model. Tokens are spent on `reasoning_content`
 *     first, so a small max_tokens yields `finish_reason: 'length'` with an EMPTY
 *     `content`. Budgets here are deliberately generous.
 */

const API_BASE = process.env.MINIMAX_API_BASE ?? 'https://api.minimaxi.com/v1'
const ENDPOINT = `${API_BASE}/text/chatcompletion_v2`

/** Interactive paths use a highspeed variant; authoring uses the strongest model. */
export const MODELS = {
  interactive: process.env.MINIMAX_MODEL_FAST ?? 'MiniMax-M2.7-highspeed',
  authoring: process.env.MINIMAX_MODEL_STRONG ?? 'MiniMax-M3',
}

function apiKey() {
  const k = process.env.MINIMAX_API_KEY
  if (!k) throw new Error('MINIMAX_API_KEY is not set')
  return k
}

/**
 * Strip a markdown code fence and any prose around a JSON object.
 * Returns the raw text unchanged when there is nothing fence-like to remove.
 */
export function unfence(text) {
  if (!text) return ''
  const t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  // Some replies lead with a sentence before the object; take the outermost braces.
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first !== -1 && last > first) return t.slice(first, last + 1)
  return t
}

/** Parse a model reply as JSON, tolerating fences and surrounding prose. */
export function parseJSONReply(text) {
  const cleaned = unfence(text)
  try {
    return { ok: true, value: JSON.parse(cleaned) }
  } catch (err) {
    return { ok: false, error: err.message, raw: text, cleaned }
  }
}

async function call(body, { signal } = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Minimax HTTP ${res.status}: ${detail.slice(0, 500)}`)
  }
  return res
}

/** Plain completion. Returns the assistant text. */
export async function chat(messages, { model = MODELS.interactive, maxTokens = 2048, temperature = 0.3, signal } = {}) {
  const res = await call({ model, messages, max_tokens: maxTokens, temperature }, { signal })
  const data = await res.json()
  if (data?.base_resp?.status_code) {
    throw new Error(`Minimax error ${data.base_resp.status_code}: ${data.base_resp.status_msg}`)
  }
  const choice = data.choices?.[0]
  const content = choice?.message?.content ?? ''
  // A reasoning model that ran out of budget mid-thought returns empty content;
  // surface that as an error rather than passing '' up as if it were an answer.
  if (!content && choice?.finish_reason === 'length') {
    throw new Error('Minimax truncated during reasoning — raise maxTokens')
  }
  return content
}

/**
 * Completion constrained to a JSON object.
 *
 * `schemaHint` is a human-readable description of the required shape, injected
 * into the system prompt — this provider gives us no enforced schema, so the
 * prompt plus `validate` is the only guarantee we get. On a parse or validation
 * failure the model is asked once more with the failure quoted back to it.
 */
export async function chatJSON(messages, { schemaHint, validate, repair, model = MODELS.interactive, maxTokens = 3000, temperature = 0.2, signal } = {}) {
  const system = {
    role: 'system',
    content:
      `You must reply with a single JSON object and nothing else. No prose, no markdown fence.\n` +
      `Required shape:\n${schemaHint}`,
  }
  const body = (msgs) => ({
    model,
    messages: [system, ...msgs],
    max_tokens: maxTokens,
    temperature,
    response_format: { type: 'json_object' },
  })

  let res = await call(body(messages), { signal })
  let text = (await res.json()).choices?.[0]?.message?.content ?? ''
  let parsed = parseJSONReply(text)
  let problem = parsed.ok ? validate?.(parsed.value) : `not valid JSON (${parsed.error})`

  if (parsed.ok && !problem) return parsed.value

  // One corrective retry, quoting what was wrong. Beyond this we fail loudly
  // rather than silently handing the caller a half-shaped object.
  const retryMessages = [
    ...messages,
    { role: 'assistant', content: text.slice(0, 1500) },
    { role: 'user', content: `That reply was rejected: ${problem}. Reply again with ONLY the JSON object in the required shape.` },
  ]
  res = await call(body(retryMessages), { signal })
  text = (await res.json()).choices?.[0]?.message?.content ?? ''
  parsed = parseJSONReply(text)
  if (!parsed.ok) throw new Error(`Minimax did not return JSON after retry: ${parsed.error}`)
  problem = validate?.(parsed.value)
  if (!problem) return parsed.value
  // Last resort before failing: a caller-supplied mechanical fix (say, cutting
  // an over-long reply back to whole sentences), accepted only if the result
  // then passes the same validation.
  const repaired = repair?.(parsed.value)
  if (repaired && !validate?.(repaired)) return repaired
  throw new Error(`Minimax JSON failed validation after retry: ${problem}`)
}

/**
 * Streaming completion. Yields assistant text deltas only — `reasoning_content`
 * deltas are dropped, since the learner should see the answer, not the model's
 * private deliberation.
 */
export async function* chatStream(messages, { model = MODELS.interactive, maxTokens = 2048, temperature = 0.4, signal } = {}) {
  const res = await call({ model, messages, max_tokens: maxTokens, temperature, stream: true }, { signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are newline-delimited; keep the trailing partial line buffered.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let frame
      try {
        frame = JSON.parse(payload)
      } catch {
        continue // ignore keepalives and malformed frames
      }
      const delta = frame.choices?.[0]?.delta
      if (delta?.content) yield delta.content
    }
  }
}
