import type { Env } from './env';

/** Send a plain-text email through Resend (https://resend.com/docs/api-reference/emails/send-email). */
export async function sendEmail(
  env: Env,
  msg: { to: string; subject: string; text: string; idempotencyKey: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'idempotency-key': msg.idempotencyKey,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], reply_to: env.EMAIL_REPLY_TO, subject: msg.subject, text: msg.text }),
  });
  if (res.ok) return { ok: true };
  const body = await res.text();
  console.error('resend failed', res.status, body);
  return { ok: false, error: `${res.status} ${body.slice(0, 200)}` };
}

export function replyEmailBody(env: Env, reply: string, original: { name: string; message: string }): string {
  const quoted = original.message
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return [
    `Hi ${original.name.split(' ')[0]},`,
    '',
    reply,
    '',
    '—',
    'AllCare Pharmacy, Orthopedic and Medical Supplies',
    `${env.STORE_PHONE} · 6341 Livingston Road, Oxon Hill, MD 20745`,
    'Mon–Fri 9am–6pm · Sat 10am–2pm',
    '',
    'You wrote:',
    quoted,
  ].join('\n');
}
