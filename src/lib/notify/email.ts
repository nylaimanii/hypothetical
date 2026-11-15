// emails pdf reports over gmail smtp. every report is also saved to data/reports/.
// missing env logs once and skips sending. never throws.
import fs from 'node:fs'
import path from 'node:path'
import nodemailer from 'nodemailer'
import type { RunRecord } from '../types'
import { dirs } from '../evolve/store'
import { digestPdf, moonPdf, type DigestInput } from './pdf'

let warned = false
function emailEnv() {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD, to = process.env.EMAIL_TO
  if (user && pass && to) return { user, pass, to }
  if (!warned) { console.log('[email] GMAIL_USER, GMAIL_APP_PASSWORD or EMAIL_TO missing, saving reports to data/reports only'); warned = true }
  return null
}

export async function sendReport(subject: string, body: string, filename: string, pdf: Buffer): Promise<{ saved: string; sent: boolean }> {
  fs.mkdirSync(dirs.reports, { recursive: true })
  const saved = path.join(dirs.reports, filename)
  fs.writeFileSync(saved, pdf)
  const env = emailEnv()
  if (!env) return { saved, sent: false }
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: env.user, pass: env.pass } })
    await t.sendMail({ from: `hypothetical <${env.user}>`, to: env.to, subject, text: body, attachments: [{ filename, content: pdf }] })
    return { saved, sent: true }
  } catch (e) {
    console.log(`[email] send failed: ${(e as Error).message}`)
    return { saved, sent: false }
  }
}

export async function sendDigest(input: DigestInput) {
  try {
    const pdf = await digestPdf(input)
    const g = input.generation
    const best = [...g.population].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
    const r = await sendReport(
      `hypothetical: generation ${g.generation} digest`,
      `generation ${g.generation} finished. best: ${best?.name} at ${best?.score}. full digest attached.`,
      `digest-gen-${g.generation}.pdf`, pdf,
    )
    console.log(`[email] digest ${r.sent ? 'sent' : 'saved'}: ${r.saved}`)
  } catch (e) {
    console.log(`[email] digest failed: ${(e as Error).message}`)
  }
}

export async function sendMoonReport(record: RunRecord) {
  try {
    const pdf = await moonPdf(record)
    const s = record.summary
    const r = await sendReport(
      `hypothetical: moon landing, ${s.runId}`,
      `world ${s.runId} (gen ${record.generation}) landed a crew on ${s.endDate}. the full story is attached.`,
      `moon-${s.runId}.pdf`, pdf,
    )
    console.log(`[email] moon report ${r.sent ? 'sent' : 'saved'}: ${r.saved}`)
  } catch (e) {
    console.log(`[email] moon report failed: ${(e as Error).message}`)
  }
}
