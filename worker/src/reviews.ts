import type { Env } from './env';
import { context, postInThread, saveThread, section, slack } from './slack';
import { cleanReviewText, slackEscape, starNumber, starString } from './util';

// Google Business Profile API (v4 reviews). Needs API access approved for the Google Cloud project
// and an OAuth refresh token from a manager of the listing (see scripts/google-auth.mjs).

interface GoogleReview {
  name: string; // accounts/{a}/locations/{l}/reviews/{reviewId}
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
}
interface ListResponse {
  reviews?: GoogleReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}
interface SeenReview {
  ts: string; // Slack message ts
  stars: number;
  comment: string;
}
export interface PublicReview {
  author: string;
  rating: number;
  text: string;
  date: string;
}

async function googleToken(env: Env): Promise<string> {
  const cached = await env.STATE.get('google:access_token');
  if (cached) return cached;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await env.STATE.put('google:access_token', data.access_token, { expirationTtl: Math.max(60, data.expires_in - 300) });
  return data.access_token;
}

const reviewsBase = (env: Env) =>
  `https://mybusiness.googleapis.com/v4/accounts/${env.GOOGLE_ACCOUNT_ID}/locations/${env.GOOGLE_LOCATION_ID}/reviews`;

async function listReviews(env: Env): Promise<ListResponse> {
  const token = await googleToken(env);
  const res = await fetch(`${reviewsBase(env)}?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`google reviews ${res.status}: ${await res.text()}`);
  return (await res.json()) as ListResponse;
}

/** Post or replace the business's public reply to a review. */
export async function replyToReview(env: Env, reviewId: string, comment: string): Promise<{ ok: boolean; error?: string }> {
  const token = await googleToken(env);
  const res = await fetch(`${reviewsBase(env)}/${encodeURIComponent(reviewId)}/reply`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ comment: comment.slice(0, 4000) }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
}

function publicReviews(list: GoogleReview[]): PublicReview[] {
  return list
    .map((r) => ({ r, text: cleanReviewText(r.comment), stars: starNumber(r.starRating) }))
    .filter(({ r, text, stars }) => stars >= 4 && text.length >= 40 && text.length <= 600 && !r.reviewer?.isAnonymous)
    .sort((a, b) => b.r.createTime.localeCompare(a.r.createTime))
    .slice(0, 8)
    .map(({ r, text, stars }) => ({ author: r.reviewer?.displayName ?? 'Google user', rating: stars, text, date: r.createTime }));
}

function reviewBlocks(env: Env, r: GoogleReview, mapsUrl: string) {
  const stars = starNumber(r.starRating);
  const text = cleanReviewText(r.comment);
  const who = slackEscape(r.reviewer?.displayName ?? 'A Google user');
  return [
    section(`:star: *New Google review* · ${starString(stars)} (${stars}/5)${stars && stars <= 3 ? '  :warning: *Low rating, please reply today*' : ''}`),
    section(`*${who}*\n${text ? slackEscape(text).slice(0, 2900).replace(/^/gm, '>') : '_(rating only, no written review)_'}`),
    context(
      `<${mapsUrl}|Open on Google> · Reply in this thread to post a *public* reply on Google as AllCare. Replying again replaces it. Start with \`note:\` to discuss internally.`,
    ),
  ];
}

/** Cron job: refresh the site's review cache and post anything new to Slack. */
export async function syncReviews(env: Env, mapsUrl: string): Promise<void> {
  const data = await listReviews(env);
  const list = data.reviews ?? [];

  await env.STATE.put(
    'reviews:public',
    JSON.stringify({
      rating: Math.round((data.averageRating ?? 0) * 10) / 10,
      count: data.totalReviewCount ?? list.length,
      reviews: publicReviews(list),
      updatedAt: new Date().toISOString(),
    }),
  );

  // On the very first run, remember existing reviews without flooding Slack.
  const firstRun = !(await env.STATE.get('reviews:initialized'));

  for (const r of [...list].reverse()) {
    const key = `review:${r.reviewId}`;
    const seen = await env.STATE.get<SeenReview>(key, 'json');
    const stars = starNumber(r.starRating);
    const comment = cleanReviewText(r.comment);

    if (!seen) {
      if (firstRun) {
        await env.STATE.put(key, JSON.stringify({ ts: '', stars, comment } satisfies SeenReview));
        continue;
      }
      const post = await slack(env, 'chat.postMessage', {
        channel: env.SLACK_REVIEWS_CHANNEL,
        text: `New ${stars}-star Google review from ${r.reviewer?.displayName ?? 'a Google user'}`,
        blocks: reviewBlocks(env, r, mapsUrl),
        unfurl_links: false,
      });
      if (!post.ok || !post.ts) continue; // try again next run
      await env.STATE.put(key, JSON.stringify({ ts: post.ts, stars, comment } satisfies SeenReview));
      await saveThread(env, env.SLACK_REVIEWS_CHANNEL, post.ts, {
        kind: 'review',
        reviewId: r.reviewId,
        reviewer: r.reviewer?.displayName ?? 'Google user',
        stars,
      });
      continue;
    }

    // The reviewer edited their review: note it in the original thread.
    if (seen.ts && (seen.stars !== stars || seen.comment !== comment)) {
      await postInThread(
        env,
        env.SLACK_REVIEWS_CHANNEL,
        seen.ts,
        `:pencil2: The reviewer edited this review. Now ${starString(stars)} (${stars}/5):\n${comment ? slackEscape(comment).replace(/^/gm, '>') : '_(no text)_'}`,
      );
      await env.STATE.put(key, JSON.stringify({ ...seen, stars, comment } satisfies SeenReview));
    }
  }

  if (firstRun) await env.STATE.put('reviews:initialized', new Date().toISOString());
}
