/**
 * Operator alerts. Set COMMIT_ALERT_WEBHOOK to a Discord (or Slack) incoming-webhook URL to be told about new
 * payout requests and coin reports. Delivery is best-effort and never blocks or fails the user's request.
 */
export function createAlerts(url = process.env.COMMIT_ALERT_WEBHOOK, request: typeof fetch = fetch) {
  let target: URL | null = null
  try { if (url) { target = new URL(url); if (target.protocol !== 'https:') target = null } } catch { target = null }
  if (url && !target) console.error('COMMIT_ALERT_WEBHOOK must be an https URL; alerts are disabled.')
  return {
    enabled: !!target,
    send(text: string) {
      if (!target) return
      const content = text.slice(0, 1900)
      // allowed_mentions: user-supplied text must never ping @everyone or roles in the operator's channel
      void request(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, text: content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(5000), redirect: 'error' })
        .then(response => { if (!response.ok) console.error(`Commit alert webhook returned ${response.status}.`) })
        .catch(() => console.error('Commit alert webhook unreachable.'))
    },
  }
}
export type Alerts = ReturnType<typeof createAlerts>
/** Show user-supplied text inert: one line, code-formatted (no links or mentions render), bounded. */
export const quote = (text: string) => '`' + text.replace(/[`\r\n]/g, ' ').replace(/@/g, '@\u200b').slice(0, 120) + '`'
