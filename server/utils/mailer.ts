// server/utils/mailer.ts
import nodemailer from 'nodemailer'
import { useRuntimeConfig } from '#imports'

export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const cfg = useRuntimeConfig()
  if (!cfg.smtpUrl) return // no SMTP configured → no-op (push remains primary)
  const transport = nodemailer.createTransport(cfg.smtpUrl as string)
  await transport.sendMail({ from: 'money@argontechs.dev', ...msg })
}
