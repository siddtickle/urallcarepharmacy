// Small pure helpers. No Worker-only APIs here, so they run under `node --test` too.

/** Escape user text for Slack mrkdwn. */
export function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turn a Slack message's text into plain text for an email or a Google reply. */
export function slackToPlain(s: string): string {
  return s
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<tel:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<mailto:([^>]+)>/g, '$1')
    .replace(/<@[A-Z0-9]+(\|[^>]+)?>/g, '')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Thread messages starting with "note:" or "//" stay internal and are never sent to the customer. */
export function isInternalNote(text: string): boolean {
  return /^\s*(note\s*:|\/\/)/i.test(text);
}

export function isPlausibleEmail(s: string): boolean {
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(s) && s.length <= 200;
}

/** Ticket numbers like AC-7K3P9 (no 0/O/1/I to avoid confusion on the phone). */
export function makeTicket(random: Uint8Array): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[random[i] % alphabet.length];
  return `AC-${out}`;
}

const STAR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export function starNumber(starRating: string | undefined): number {
  return STAR_WORDS[starRating ?? ''] ?? 0;
}

export function starString(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

/**
 * Google returns translated reviews as "(Translated by Google) <english>\n\n(Original)\n<original>".
 * Show the English part only.
 */
export function cleanReviewText(s: string | undefined): string {
  if (!s) return '';
  const translated = s.match(/\(Translated by Google\)\s*([\s\S]*?)\s*\(Original\)/);
  return (translated ? translated[1] : s).trim();
}

/** True when `origin` is in the allow list. Entries like "*.example.pages.dev" match any subdomain. */
export function originAllowed(origin: string | null, allowList: string): boolean {
  if (!origin) return false;
  let host: string;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return false;
    host = u.host;
  } catch {
    return false;
  }
  return allowList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => {
      const pattern = entry.replace(/^https?:\/\//, '');
      if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
      return host === pattern;
    });
}

/** Git branch for a change request, from the Slack thread timestamp. */
export function branchForThread(threadTs: string): string {
  return `slack/change-${threadTs.replace('.', '-')}`;
}

/** Hex HMAC-SHA256, using Web Crypto (Workers and Node 20+). */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a request really came from Slack. https://api.slack.com/authentication/verifying-requests-from-slack */
export async function verifySlackSignature(
  signingSecret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 60 * 5) return false;
  const expected = 'v0=' + (await hmacHex(signingSecret, `v0:${timestamp}:${rawBody}`));
  return timingSafeEqual(expected, signature);
}
