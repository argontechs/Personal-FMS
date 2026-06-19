// server/utils/alert.ts
// sendAlert: always logs [ALERT], also emails via mailer when SMTP is configured.
// Never throws — a broken alert path must not mask the original failure.

export async function sendAlert(subject: string, body: string): Promise<void> {
  const ts = new Date().toISOString()
  // Always emit a distinct log line regardless of SMTP state.
  console.error(`[ALERT] ${ts} ${subject} — ${body}`)

  try {
    const { sendMail } = await import('./mailer')
    await sendMail({ to: 'yongwei1127@gmail.com', subject: `[FMS ALERT] ${subject}`, text: body })
  } catch (err) {
    // Mailer failure (e.g. SMTP not configured, transport error) must not propagate.
    console.error(`[ALERT] mailer error (non-fatal): ${err}`)
  }
}
