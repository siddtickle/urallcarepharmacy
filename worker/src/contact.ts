import type { Env } from './env';
import { context, saveThread, section, slack } from './slack';
import { isPlausibleEmail, makeTicket, originAllowed, slackEscape } from './util';

interface ContactInput {
  name?: string;
  email?: string;
  phone?: string;
  contactPref?: string;
  topic?: string;
  message?: string;
  company?: string; // honeypot
  turnstileToken?: string;
}

const PREFS = new Set(['email', 'phone', 'text']);
const json = (body: unknown, status: number, headers: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function verifyTurnstile(env: Env, token: string, ip: string | null): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}

/** At most `limit` messages per IP per hour. KV is eventually consistent, so this is a soft limit. */
async function overLimit(env: Env, ip: string, limit = 5): Promise<boolean> {
  const key = `rl:contact:${ip}`;
  const count = Number((await env.STATE.get(key)) ?? '0');
  if (count >= limit) return true;
  await env.STATE.put(key, String(count + 1), { expirationTtl: 3600 });
  return false;
}

export async function handleContact(req: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const origin = req.headers.get('origin');
  if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return json({ error: 'forbidden' }, 403, cors);

  let input: ContactInput;
  try {
    input = (await req.json()) as ContactInput;
  } catch {
    return json({ error: 'bad_request' }, 400, cors);
  }

  // Bots fill the hidden "company" field. Pretend it worked.
  if (input.company) return json({ ok: true }, 200, cors);

  const name = (input.name ?? '').trim().slice(0, 100);
  const email = (input.email ?? '').trim().slice(0, 200);
  const phone = (input.phone ?? '').trim().slice(0, 30);
  const message = (input.message ?? '').trim().slice(0, 3000);
  const topic = (input.topic ?? 'General question').trim().slice(0, 80);
  const contactPref = PREFS.has(input.contactPref ?? '') ? (input.contactPref as string) : email ? 'email' : 'phone';

  if (!name || !message || (!email && !phone)) return json({ error: 'missing_fields' }, 400, cors);
  if (email && !isPlausibleEmail(email)) return json({ error: 'bad_email' }, 400, cors);

  const ip = req.headers.get('cf-connecting-ip');
  if (!(await verifyTurnstile(env, input.turnstileToken ?? '', ip))) return json({ error: 'verification_failed' }, 400, cors);
  if (ip && (await overLimit(env, ip))) return json({ error: 'rate_limited' }, 429, cors);

  const ticket = makeTicket(crypto.getRandomValues(new Uint8Array(5)));
  const isPreview = !!origin && new URL(origin).host !== new URL(env.SITE_URL).host;
  const prefLabel = { email: 'Email', phone: 'Phone call', text: 'Text message' }[contactPref];

  const howToReply = email
    ? `Reply in this thread to email *${slackEscape(email)}*. Start a message with \`note:\` to keep it internal.`
    : `No email given. Call or text *${slackEscape(phone)}*; replies in this thread stay internal.`;

  const lines = [
    `*Name:* ${slackEscape(name)}`,
    email ? `*Email:* ${slackEscape(email)}` : null,
    phone ? `*Phone:* ${slackEscape(phone)}` : null,
    `*Prefers:* ${prefLabel}`,
  ].filter(Boolean);

  const post = await slack(env, 'chat.postMessage', {
    channel: env.SLACK_INQUIRIES_CHANNEL,
    text: `New website message from ${name} (${topic})`,
    unfurl_links: false,
    blocks: [
      section(`${isPreview ? '*[TEST from a preview site]* ' : ''}:incoming_envelope: *New website message* · ${slackEscape(topic)}`),
      section(lines.join('\n')),
      section(slackEscape(message).slice(0, 2900).replace(/^/gm, '>')),
      context(`${ticket} · ${howToReply}`),
    ],
  });
  if (!post.ok || !post.ts) return json({ error: 'send_failed' }, 502, cors);

  await saveThread(env, env.SLACK_INQUIRIES_CHANNEL, post.ts, {
    kind: 'contact',
    ticket,
    name,
    email: email || undefined,
    phone: phone || undefined,
    contactPref,
    topic,
    message,
  });

  return json({ ok: true, ticket }, 200, cors);
}
