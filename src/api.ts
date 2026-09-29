export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000), cache: 'no-store' })
  const result = await response.json().catch(() => { throw Error('The server returned an unreadable response. Retry shortly.') })
  if (!response.ok) throw Error(result.error || 'Request failed.')
  return result
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Please retry.'
