// End-to-end flows through the Worker with Slack, Resend, Google, GitHub and Turnstile faked.
// Run: npx tsx --test test/flows.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { hmacHex } from '../src/util.ts';

// ---------- fakes ----------
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

interface Call { url: string; method: string; body: any; headers: Record<string, string> }
let calls: Call[] = [];
let googleReviews: any[] = [];
let slackTs = 1000;

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  let body: any = init.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {}
  } else if (body instanceof URLSearchParams) body = Object.fromEntries(body);
  calls.push({ url, method, body, headers: init.headers ?? {} });

  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url.includes('turnstile')) return ok({ success: true });
  if (url.startsWith('https://slack.com/api/chat.postMessage')) return ok({ ok: true, ts: `${++slackTs}.000100`, channel: body.channel });
  if (url.startsWith('https://slack.com/api/')) return ok({ ok: true });
  if (url.startsWith('https://api.resend.com/')) return ok({ id: 'email_1' });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'ya29.test', expires_in: 3600 });
  if (url.includes('mybusiness.googleapis.com') && method === 'GET')
    return ok({ reviews: googleReviews, averageRating: 4.62, totalReviewCount: 98 });
  if (url.includes('mybusiness.googleapis.com') && method === 'PUT') return ok({ comment: body.comment });
  if (url.startsWith('https://api.github.com/')) return new Response(null, { status: url.endsWith('/merge') ? 200 : 204 });
  throw new Error(`unexpected fetch ${method} ${url}`);
}) as typeof fetch;

const SECRET = 'signing-secret';
let kv: FakeKV;
let env: any;
let pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as any;
const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

beforeEach(() => {
  calls = [];
  pending = [];
  kv = new FakeKV();
  env = {
    STATE: kv,
    SITE_URL: 'https://www.urallcarepharmacy.com',
    ALLOWED_ORIGINS: 'www.urallcarepharmacy.com,*.allcare-pharmacy.pages.dev',
    SLACK_INQUIRIES_CHANNEL: 'CINQ',
    SLACK_REVIEWS_CHANNEL: 'CREV',
    SLACK_CHANGES_CHANNEL: 'CCHG',
    SLACK_DEPLOYERS: 'UADMIN',
    GITHUB_REPO: 'sid/allcare',
    EMAIL_FROM: 'AllCare <hello@urallcarepharmacy.com>',
    EMAIL_REPLY_TO: 'urallcarepharmacy@gmail.com',
    GOOGLE_ACCOUNT_ID: '111',
    GOOGLE_LOCATION_ID: '222',
    STORE_PHONE: '301-485-0000',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_SIGNING_SECRET: SECRET,
    TURNSTILE_SECRET: 't',
    RESEND_API_KEY: 'r',
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 'g',
    GOOGLE_REFRESH_TOKEN: 'g',
    GITHUB_TOKEN: 'gh',
  };
});

async function slackRequest(path: string, raw: string, opts: { badSig?: boolean } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + (await hmacHex(opts.badSig ? 'wrong' : SECRET, `v0:${ts}:${raw}`));
  const res = await worker.fetch(
    new Request(`https://api.urallcarepharmacy.com${path}`, {
      method: 'POST',
      headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig },
      body: raw,
    }),
    env,
    ctx,
  );
  await settle();
  return res;
}
let eventN = 0;
const messageEvent = (event: Record<string, unknown>) =>
  slackRequest('/slack/events', JSON.stringify({ type: 'event_callback', event_id: `Ev${++eventN}`, event: { type: 'message', ...event } }));

async function submitContact(fields: Record<string, string>, origin = 'https://www.urallcarepharmacy.com') {
  const res = await worker.fetch(
    new Request('https://api.urallcarepharmacy.com/api/contact', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify({ turnstileToken: 'tok', topic: 'General question', contactPref: 'email', ...fields }),
    }),
    env,
    ctx,
  );
  return { res, body: (await res.json()) as any };
}

// ---------- tests ----------

test('contact form posts to #website-inquiries and a thread reply emails the customer', async () => {
  const { res, body } = await submitContact({ name: 'Jane Doe', email: 'jane@example.com', message: 'Do you carry knee braces?' });
  assert.equal(res.status, 200);
  assert.match(body.ticket, /^AC-/);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://www.urallcarepharmacy.com');

  const post = calls.find((c) => c.url.endsWith('chat.postMessage'))!;
  assert.equal(post.body.channel, 'CINQ');
  const blockText = JSON.stringify(post.body.blocks);
  assert.match(blockText, /Jane Doe/);
  assert.match(blockText, /knee braces/);
  assert.doesNotMatch(blockText, /TEST from a preview/);
  const threadTs = `${slackTs}.000100`;

  calls = [];
  await messageEvent({ channel: 'CINQ', user: 'USTAFF', text: 'Yes &amp; we have sizes S–XL. <@UBOT>', ts: '2000.1', thread_ts: threadTs });
  const email = calls.find((c) => c.url.startsWith('https://api.resend.com'))!;
  assert.ok(email, 'email sent');
  assert.deepEqual(email.body.to, ['jane@example.com']);
  assert.equal(email.body.reply_to, 'urallcarepharmacy@gmail.com');
  assert.match(email.body.text, /^Hi Jane,/);
  assert.match(email.body.text, /Yes & we have sizes S–XL\./);
  assert.match(email.body.text, /> Do you carry knee braces\?/);
  assert.ok(calls.some((c) => c.url.endsWith('reactions.add') && c.body.name === 'email'));
});

test('note: replies are never emailed', async () => {
  await submitContact({ name: 'Jane', email: 'jane@example.com', message: 'Hi' });
  const threadTs = `${slackTs}.000100`;
  calls = [];
  await messageEvent({ channel: 'CINQ', user: 'USTAFF', text: 'note: I will call her', ts: '2000.2', thread_ts: threadTs });
  assert.equal(calls.length, 0);
});

test('Slack retries of the same event are ignored', async () => {
  await submitContact({ name: 'Jane', email: 'jane@example.com', message: 'Hi' });
  const threadTs = `${slackTs}.000100`;
  calls = [];
  const raw = JSON.stringify({ type: 'event_callback', event_id: 'EvDUP', event: { type: 'message', channel: 'CINQ', user: 'U1', text: 'Hello', ts: '3000.1', thread_ts: threadTs } });
  await slackRequest('/slack/events', raw);
  await slackRequest('/slack/events', raw);
  assert.equal(calls.filter((c) => c.url.startsWith('https://api.resend.com')).length, 1);
});

test('phone-only contact: thread reply is not emailed, team is reminded to call', async () => {
  await submitContact({ name: 'Bob', phone: '240-555-0100', contactPref: 'phone', message: 'Call me' });
  const threadTs = `${slackTs}.000100`;
  calls = [];
  await messageEvent({ channel: 'CINQ', user: 'USTAFF', text: 'Will call', ts: '2000.3', thread_ts: threadTs });
  assert.ok(!calls.some((c) => c.url.startsWith('https://api.resend.com')));
  assert.match(calls.find((c) => c.url.endsWith('chat.postMessage'))!.body.text, /240-555-0100/);
});

test('contact form: preview origin is flagged, unknown origin and honeypot are handled', async () => {
  await submitContact({ name: 'T', email: 't@example.com', message: 'x' }, 'https://slack-change-1.allcare-pharmacy.pages.dev');
  assert.match(JSON.stringify(calls.find((c) => c.url.endsWith('chat.postMessage'))!.body.blocks), /TEST from a preview/);

  const evil = await submitContact({ name: 'T', email: 't@example.com', message: 'x' }, 'https://evil.example');
  assert.equal(evil.res.status, 403);

  calls = [];
  const bot = await submitContact({ name: 'T', email: 't@example.com', message: 'x', company: 'Spam Inc' });
  assert.equal(bot.res.status, 200);
  assert.equal(calls.length, 0, 'honeypot submissions never reach Slack');

  const missing = await submitContact({ name: 'T', message: 'x' });
  assert.equal(missing.res.status, 400);
});

test('bad Slack signature is rejected', async () => {
  const res = await slackRequest('/slack/events', JSON.stringify({ type: 'url_verification', challenge: 'abc' }), { badSig: true });
  assert.equal(res.status, 401);
  const good = await slackRequest('/slack/events', JSON.stringify({ type: 'url_verification', challenge: 'abc' }));
  assert.equal(await good.text(), 'abc');
});

test('reviews: first sync is silent, new review goes to Slack, thread reply posts on Google', async () => {
  const review = (id: string, stars: string, comment: string, t: string) => ({
    name: `accounts/111/locations/222/reviews/${id}`, reviewId: id, reviewer: { displayName: `Person ${id}` },
    starRating: stars, comment, createTime: t, updateTime: t,
  });
  googleReviews = [review('old1', 'FIVE', 'Wonderful staff who always take the time to explain everything.', '2026-09-01T10:00:00Z')];
  await worker.scheduled!({} as any, env, ctx);
  await settle();
  assert.ok(!calls.some((c) => c.url.endsWith('chat.postMessage')), 'no Slack posts on first run');
  const cached = JSON.parse(kv.store.get('reviews:public')!);
  assert.equal(cached.rating, 4.6);
  assert.equal(cached.count, 98);
  assert.equal(cached.reviews.length, 1);

  calls = [];
  googleReviews = [review('new1', 'TWO', 'Waited too long.', '2026-10-01T15:00:00Z'), ...googleReviews];
  await worker.scheduled!({} as any, env, ctx);
  await settle();
  const posts = calls.filter((c) => c.url.endsWith('chat.postMessage'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.channel, 'CREV');
  assert.match(JSON.stringify(posts[0].body.blocks), /Low rating/);
  const threadTs = `${slackTs}.000100`;

  // Running again does not repost.
  calls = [];
  await worker.scheduled!({} as any, env, ctx);
  await settle();
  assert.equal(calls.filter((c) => c.url.endsWith('chat.postMessage')).length, 0);

  calls = [];
  await messageEvent({ channel: 'CREV', user: 'USTAFF', text: "We're sorry about the wait. Please call us so we can make it right.", ts: '4000.1', thread_ts: threadTs });
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.ok(put.url.endsWith('/accounts/111/locations/222/reviews/new1/reply'));
  assert.equal(put.body.comment, "We're sorry about the wait. Please call us so we can make it right.");
});

test('reviews: an edited review is noted in its thread', async () => {
  const r = { name: 'x', reviewId: 'e1', reviewer: { displayName: 'Ed' }, starRating: 'THREE', comment: 'ok', createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z' };
  kv.store.set('reviews:initialized', 'yes');
  googleReviews = [r];
  await worker.scheduled!({} as any, env, ctx);
  await settle();
  calls = [];
  googleReviews = [{ ...r, starRating: 'FIVE', comment: 'Actually great!', updateTime: '2026-10-02T00:00:00Z' }];
  await worker.scheduled!({} as any, env, ctx);
  await settle();
  const post = calls.find((c) => c.url.endsWith('chat.postMessage'))!;
  assert.match(post.body.text, /edited this review/);
  assert.ok(post.body.thread_ts);
});

test('change request dispatches to GitHub; revisions reuse the branch; only admins can merge', async () => {
  await messageEvent({ channel: 'CCHG', user: 'USID', text: 'Add that we are closed on Thanksgiving', ts: '5000.123' });
  const dispatch = calls.find((c) => c.url.endsWith('/dispatches'))!;
  assert.equal(dispatch.body.event_type, 'slack-change');
  assert.equal(dispatch.body.client_payload.branch, 'slack/change-5000-123');
  assert.equal(dispatch.body.client_payload.thread_ts, '5000.123');
  assert.equal(dispatch.body.client_payload.revision, false);

  calls = [];
  await messageEvent({ channel: 'CCHG', user: 'USID', text: 'Make it bold', ts: '5001.1', thread_ts: '5000.123' });
  const rev = calls.find((c) => c.url.endsWith('/dispatches'))!;
  assert.equal(rev.body.client_payload.branch, 'slack/change-5000-123');
  assert.equal(rev.body.client_payload.revision, true);

  const action = (user: string, action_id: string) =>
    'payload=' +
    encodeURIComponent(
      JSON.stringify({
        type: 'block_actions',
        user: { id: user, name: 'sid' },
        channel: { id: 'CCHG' },
        message: { ts: '5002.1', thread_ts: '5000.123', blocks: [{ type: 'section' }, { type: 'actions' }], text: 'Preview' },
        actions: [{ action_id, value: JSON.stringify({ pr: 7, branch: 'slack/change-5000-123', thread_ts: '5000.123' }) }],
      }),
    );

  calls = [];
  await slackRequest('/slack/interactions', action('USOMEONE', 'merge_deploy'));
  assert.ok(!calls.some((c) => c.url.endsWith('/merge')), 'non-admin cannot merge');
  assert.ok(calls.some((c) => c.url.endsWith('chat.postEphemeral')));

  calls = [];
  await slackRequest('/slack/interactions', action('UADMIN', 'merge_deploy'));
  const merge = calls.find((c) => c.url.endsWith('/pulls/7/merge'))!;
  assert.equal(merge.method, 'PUT');
  assert.match(merge.body.commit_message, /Slack-Thread: 5000\.123/);
  const update = calls.find((c) => c.url.endsWith('chat.update'))!;
  assert.ok(!update.body.blocks.some((b: any) => b.type === 'actions'), 'buttons removed after merge');
});

test('ignores bot messages, other channels and edits', async () => {
  await messageEvent({ channel: 'CCHG', bot_id: 'B1', text: 'Live!', ts: '6000.1' });
  await messageEvent({ channel: 'CCHG', user: 'U1', subtype: 'message_changed', ts: '6000.2' });
  await messageEvent({ channel: 'COTHER', user: 'U1', text: 'hello', ts: '6000.3', thread_ts: '1.1' });
  assert.equal(calls.length, 0);
});

test('public reviews endpoint', async () => {
  const empty = await worker.fetch(new Request('https://api.urallcarepharmacy.com/api/reviews'), env, ctx);
  assert.equal(empty.status, 503);
  kv.store.set('reviews:public', JSON.stringify({ rating: 4.6, count: 97, reviews: [] }));
  const res = await worker.fetch(new Request('https://api.urallcarepharmacy.com/api/reviews'), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});
