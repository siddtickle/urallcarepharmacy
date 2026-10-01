import type { Env, ThreadRecord } from './env';
import { handleContact } from './contact';
import { replyEmailBody, sendEmail } from './email';
import { closePullRequest, dispatchChange, mergePullRequest } from './github';
import { replyToReview, syncReviews } from './reviews';
import { context, loadThread, postInThread, react, saveThread, slack } from './slack';
import { branchForThread, isInternalNote, originAllowed, slackToPlain, verifySlackSignature } from './util';

const MAPS_URL = 'https://maps.google.com/?cid=11211760498866517960';

interface SlackMessageEvent {
  type: 'message';
  subtype?: string;
  bot_id?: string;
  user?: string;
  channel: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  files?: { name: string; url_private_download?: string; url_private?: string }[];
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  return originAllowed(origin, env.ALLOWED_ORIGINS)
    ? {
        'access-control-allow-origin': origin!,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
        vary: 'origin',
      }
    : {};
}

async function readSlackRequest(req: Request, env: Env): Promise<string | null> {
  const raw = await req.text();
  const ok = await verifySlackSignature(
    env.SLACK_SIGNING_SECRET,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature'),
    raw,
    Math.floor(Date.now() / 1000),
  );
  return ok ? raw : null;
}

// ---------- Slack thread replies ----------

async function onContactReply(env: Env, ev: SlackMessageEvent, rec: Extract<ThreadRecord, { kind: 'contact' }>) {
  const threadTs = ev.thread_ts!;
  if (!rec.email) {
    if (!rec.repliesSent) {
      await postInThread(env, ev.channel, threadTs, `:telephone_receiver: Not sent. ${rec.name} didn't give an email. Please call or text ${rec.phone}.`);
      await saveThread(env, ev.channel, threadTs, { ...rec, repliesSent: 1 });
    }
    return;
  }
  const reply = slackToPlain(ev.text ?? '');
  if (!reply) return;
  const result = await sendEmail(env, {
    to: rec.email,
    subject: `Re: your message to AllCare Pharmacy (${rec.ticket})`,
    text: replyEmailBody(env, reply, rec),
    idempotencyKey: `slack-${ev.channel}-${ev.ts}`,
  });
  if (result.ok) {
    await react(env, ev.channel, ev.ts, 'email');
    await saveThread(env, ev.channel, threadTs, { ...rec, repliesSent: (rec.repliesSent ?? 0) + 1 });
    if (!rec.repliesSent) {
      await slack(env, 'chat.postMessage', {
        channel: ev.channel,
        thread_ts: threadTs,
        text: `Emailed to ${rec.email}`,
        blocks: [context(`:white_check_mark: Emailed to ${rec.email}. Their reply will arrive at ${env.EMAIL_REPLY_TO}. Messages marked :email: in this thread were sent.`)],
      });
    }
  } else {
    await postInThread(env, ev.channel, threadTs, `:x: That reply was *not* emailed (${result.error}). Please try again or call ${rec.phone ?? 'them'}.`);
  }
}

async function onReviewReply(env: Env, ev: SlackMessageEvent, rec: Extract<ThreadRecord, { kind: 'review' }>) {
  const reply = slackToPlain(ev.text ?? '');
  if (!reply) return;
  const result = await replyToReview(env, rec.reviewId, reply);
  if (result.ok) {
    await react(env, ev.channel, ev.ts, 'globe_with_meridians');
    await slack(env, 'chat.postMessage', {
      channel: ev.channel,
      thread_ts: ev.thread_ts,
      text: 'Posted on Google',
      blocks: [context(`:white_check_mark: Posted on Google as AllCare's public reply to ${rec.reviewer}. Anyone can see it. Replying again replaces it.`)],
    });
  } else {
    await postInThread(env, ev.channel, ev.thread_ts!, `:x: Couldn't post that reply on Google (${result.error}).`);
  }
}

async function onChangeMessage(env: Env, ev: SlackMessageEvent) {
  const text = slackToPlain(ev.text ?? '');
  const files = (ev.files ?? [])
    .map((f) => ({ name: f.name, url: f.url_private_download ?? f.url_private ?? '' }))
    .filter((f) => f.url)
    .slice(0, 5);
  if (!text && !files.length) return;

  // A reply inside an existing change thread = a revision to that change.
  if (ev.thread_ts && ev.thread_ts !== ev.ts) {
    const rec = await loadThread(env, ev.channel, ev.thread_ts);
    if (rec?.kind !== 'change') return;
    const ok = await dispatchChange(env, {
      request: text,
      channel: ev.channel,
      thread_ts: ev.thread_ts,
      branch: rec.branch,
      user: ev.user ?? '',
      files,
      revision: true,
    });
    await react(env, ev.channel, ev.ts, ok ? 'hammer_and_wrench' : 'x');
    return;
  }

  if (/^\s*help\s*$/i.test(text)) {
    await postInThread(
      env,
      ev.channel,
      ev.ts,
      [
        '*How website changes work*',
        '1. Post what you want changed as a new message here (attach photos if needed).',
        '2. I make the change and reply in the thread with a preview link and screenshots.',
        '3. Reply in the thread to ask for adjustments, or press *Merge & deploy* to put it live.',
        'Start a message with `note:` to talk without triggering a change.',
      ].join('\n'),
    );
    return;
  }

  const branch = branchForThread(ev.ts);
  await saveThread(env, ev.channel, ev.ts, { kind: 'change', branch, requestedBy: ev.user ?? '' });
  const ok = await dispatchChange(env, { request: text, channel: ev.channel, thread_ts: ev.ts, branch, user: ev.user ?? '', files, revision: false });
  await postInThread(
    env,
    ev.channel,
    ev.ts,
    ok
      ? ":hammer_and_wrench: On it. I'll post a preview link and screenshots here in a few minutes."
      : ':x: I couldn\'t start the change (GitHub rejected the request). Check the GITHUB_TOKEN setting.',
  );
}

async function handleMessageEvent(env: Env, ev: SlackMessageEvent) {
  if (ev.bot_id || (ev.subtype && ev.subtype !== 'file_share') || !ev.user) return;
  if (isInternalNote(ev.text ?? '')) return;

  if (ev.channel === env.SLACK_CHANGES_CHANNEL) return onChangeMessage(env, ev);

  if (!ev.thread_ts || ev.thread_ts === ev.ts) return;
  const rec = await loadThread(env, ev.channel, ev.thread_ts);
  if (!rec) return;
  if (rec.kind === 'contact' && ev.channel === env.SLACK_INQUIRIES_CHANNEL) return onContactReply(env, ev, rec);
  if (rec.kind === 'review' && ev.channel === env.SLACK_REVIEWS_CHANNEL) return onReviewReply(env, ev, rec);
}

async function handleEvents(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await readSlackRequest(req, env);
  if (raw === null) return new Response('bad signature', { status: 401 });
  const body = JSON.parse(raw) as { type: string; challenge?: string; event_id?: string; event?: SlackMessageEvent };

  if (body.type === 'url_verification') return new Response(body.challenge ?? '', { headers: { 'content-type': 'text/plain' } });
  if (body.type !== 'event_callback' || !body.event || body.event.type !== 'message') return new Response('ok');

  // Slack retries if we're slow; never act on the same event twice.
  const dedupeKey = `event:${body.event_id}`;
  if (await env.STATE.get(dedupeKey)) return new Response('ok');
  await env.STATE.put(dedupeKey, '1', { expirationTtl: 3600 });

  ctx.waitUntil(handleMessageEvent(env, body.event).catch((e) => console.error('event handler failed', e)));
  return new Response('ok');
}

// ---------- Buttons ----------

interface BlockActionsPayload {
  type: 'block_actions';
  user: { id: string; username?: string; name?: string };
  channel: { id: string };
  message: { ts: string; thread_ts?: string; blocks: { type: string }[]; text?: string };
  actions: { action_id: string; value: string }[];
}

async function handleAction(env: Env, p: BlockActionsPayload) {
  const action = p.actions[0];
  if (!action) return;
  const { pr, branch, thread_ts } = JSON.parse(action.value) as { pr: number; branch: string; thread_ts: string };
  const allowed = env.SLACK_DEPLOYERS.split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(p.user.id)) {
    await slack(env, 'chat.postEphemeral', {
      channel: p.channel.id,
      user: p.user.id,
      thread_ts,
      text: "Only website admins can publish or discard changes. Ask an admin to press the button.",
    });
    return;
  }

  const keep = p.message.blocks.filter((b) => b.type !== 'actions');
  if (action.action_id === 'merge_deploy') {
    const result = await mergePullRequest(env, pr, thread_ts, p.user.name ?? p.user.id);
    if (!result.ok) {
      await postInThread(env, p.channel.id, thread_ts, `:x: Couldn't merge (${result.error}). The change is still waiting in pull request #${pr}.`);
      return;
    }
    await slack(env, 'chat.update', {
      channel: p.channel.id,
      ts: p.message.ts,
      text: p.message.text ?? 'Approved',
      blocks: [...keep, context(`:rocket: Approved by <@${p.user.id}>. Deploying to the live site…`)],
    });
  } else if (action.action_id === 'discard') {
    await closePullRequest(env, pr, branch);
    await slack(env, 'chat.update', {
      channel: p.channel.id,
      ts: p.message.ts,
      text: p.message.text ?? 'Discarded',
      blocks: [...keep, context(`:wastebasket: Discarded by <@${p.user.id}>. Nothing was published.`)],
    });
  }
}

async function handleInteractions(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const raw = await readSlackRequest(req, env);
  if (raw === null) return new Response('bad signature', { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get('payload') ?? '{}') as BlockActionsPayload;
  if (payload.type === 'block_actions') ctx.waitUntil(handleAction(env, payload).catch((e) => console.error('action failed', e)));
  return new Response('');
}

// ---------- Entry points ----------

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);

    if (req.method === 'OPTIONS' && url.pathname === '/api/contact') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'POST' && url.pathname === '/api/contact') return handleContact(req, env, cors);

    if (req.method === 'GET' && url.pathname === '/api/reviews') {
      const cached = await env.STATE.get('reviews:public');
      return new Response(cached ?? JSON.stringify({ error: 'not_ready' }), {
        status: cached ? 200 : 503,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=600' },
      });
    }

    if (req.method === 'POST' && url.pathname === '/slack/events') return handleEvents(req, env, ctx);
    if (req.method === 'POST' && url.pathname === '/slack/interactions') return handleInteractions(req, env, ctx);
    if (url.pathname === '/health') return new Response('ok');
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      syncReviews(env, MAPS_URL).catch(async (e) => {
        console.error('review sync failed', e);
        // Tell the team at most once a day, so a broken Google connection doesn't go unnoticed.
        if (!(await env.STATE.get('alert:reviews'))) {
          await env.STATE.put('alert:reviews', '1', { expirationTtl: 86400 });
          await slack(env, 'chat.postMessage', {
            channel: env.SLACK_REVIEWS_CHANNEL,
            text: `:warning: I couldn't check Google for new reviews: ${String(e).slice(0, 300)}. See SETUP.md, "Google reviews".`,
          });
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;
