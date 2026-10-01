import type { Env, ThreadRecord } from './env';
import { THREAD_TTL } from './env';

export interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  [k: string]: unknown;
}

export async function slack(env: Env, method: string, payload: Record<string, unknown>): Promise<SlackResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as SlackResponse;
  if (!data.ok) console.error(`slack ${method} failed`, data.error);
  return data;
}

export function postInThread(env: Env, channel: string, threadTs: string, text: string, blocks?: unknown[]) {
  return slack(env, 'chat.postMessage', { channel, thread_ts: threadTs, text, ...(blocks ? { blocks } : {}), unfurl_links: false });
}

export function react(env: Env, channel: string, ts: string, name: string) {
  return slack(env, 'reactions.add', { channel, timestamp: ts, name });
}

export async function saveThread(env: Env, channel: string, ts: string, record: ThreadRecord) {
  await env.STATE.put(`thread:${channel}:${ts}`, JSON.stringify(record), { expirationTtl: THREAD_TTL });
}

export async function loadThread(env: Env, channel: string, ts: string): Promise<ThreadRecord | null> {
  return env.STATE.get<ThreadRecord>(`thread:${channel}:${ts}`, 'json');
}

/** A short context line in grey under a message. */
export const context = (text: string) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
export const section = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });
