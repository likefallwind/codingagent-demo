/**
 * Client for the tutor API.
 *
 * Every call takes an AbortSignal and every streaming call reports deltas as
 * they arrive. Nothing here decides anything about the lesson — it only carries
 * text between the learner and the server.
 */

async function postJSON(path, body, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`)
  return data
}

export const gradeAnswer = (body, signal) => postJSON('/api/tutor/grade', body, signal)
export const diagnose = (body, signal) => postJSON('/api/tutor/diagnose', body, signal)
export const checkHint = (body, signal) => postJSON('/api/tutor/check-hint', body, signal)

/**
 * Consume an SSE endpoint, invoking `onDelta` for each text fragment.
 *
 * Resolves with the full text. A server-sent `error` frame is thrown so the
 * caller can surface it, rather than leaving a half-written answer on screen.
 */
async function stream(path, body, onDelta, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `请求失败（${res.status}）`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      let frame
      try {
        frame = JSON.parse(t.slice(5).trim())
      } catch {
        continue
      }
      if (frame.error) throw new Error(frame.error)
      if (frame.delta) {
        full += frame.delta
        onDelta(full)
      }
    }
  }
  return full
}

export const askTutor = (body, onDelta, signal) => stream('/api/tutor/ask', body, onDelta, signal)
export const requestHint = (body, onDelta, signal) => stream('/api/tutor/hint', body, onDelta, signal)
