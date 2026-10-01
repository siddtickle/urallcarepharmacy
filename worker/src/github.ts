import type { Env } from './env';

async function gh(env: Env, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'allcare-slack-bot',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export interface ChangeRequest {
  request: string;
  channel: string;
  thread_ts: string;
  branch: string;
  user: string;
  files: { name: string; url: string }[];
  revision: boolean;
}

/** Start the "make a website change" GitHub Actions workflow. */
export async function dispatchChange(env: Env, payload: ChangeRequest): Promise<boolean> {
  const res = await gh(env, 'POST', '/dispatches', { event_type: 'slack-change', client_payload: payload });
  if (!res.ok) console.error('dispatch failed', res.status, await res.text());
  return res.ok;
}

export async function mergePullRequest(env: Env, pr: number, threadTs: string, approver: string): Promise<{ ok: boolean; error?: string }> {
  const res = await gh(env, 'PUT', `/pulls/${pr}/merge`, {
    merge_method: 'squash',
    commit_message: `Approved in Slack by ${approver}\n\nSlack-Thread: ${threadTs}`,
  });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  return { ok: false, error: data.message ?? String(res.status) };
}

export async function closePullRequest(env: Env, pr: number, branch: string): Promise<boolean> {
  const res = await gh(env, 'PATCH', `/pulls/${pr}`, { state: 'closed' });
  await gh(env, 'DELETE', `/git/refs/heads/${branch}`);
  return res.ok;
}
