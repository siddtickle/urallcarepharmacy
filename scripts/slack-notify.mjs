// Posts pipeline results back into Slack.
//   node scripts/slack-notify.mjs preview   (PREVIEW_URL, PR_NUMBER, PR_URL, BRANCH, THREAD_TS, SLACK_CHANNEL)
//   node scripts/slack-notify.mjs nochange  (THREAD_TS, SLACK_CHANNEL)
//   node scripts/slack-notify.mjs failed    (RUN_URL, THREAD_TS, SLACK_CHANNEL)
//   node scripts/slack-notify.mjs live      (SITE_URL, SLACK_CHANNEL, optional THREAD_TS, COMMIT_TITLE)
import { existsSync, readFileSync, statSync } from 'node:fs';

const { SLACK_BOT_TOKEN, SLACK_CHANNEL, THREAD_TS } = process.env;
const mode = process.argv[2];

async function api(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) console.error(method, data.error);
  return data;
}

async function uploadFiles(paths, comment) {
  const files = [];
  for (const path of paths.filter((p) => existsSync(p))) {
    const name = path.split('/').pop();
    const length = statSync(path).size;
    const res = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: { authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ filename: name, length: String(length) }),
    });
    const up = await res.json();
    if (!up.ok) {
      console.error('getUploadURLExternal', up.error);
      continue;
    }
    await fetch(up.upload_url, { method: 'POST', body: readFileSync(path) });
    files.push({ id: up.file_id, title: name.replace('.png', '').replace('shot-', 'Preview: ') });
  }
  if (files.length) await api('files.completeUploadExternal', { files, channel_id: SLACK_CHANNEL, thread_ts: THREAD_TS, initial_comment: comment });
}

const read = (p, fallback = '') => (existsSync(p) ? readFileSync(p, 'utf8').trim() : fallback);
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

if (mode === 'preview') {
  const { PREVIEW_URL, PR_NUMBER, PR_URL, BRANCH } = process.env;
  const summary = escape(read('.slack/summary.txt', 'Change made.')).slice(0, 2500);
  const qa = JSON.parse(read('.slack/qa.json', '{"problems":[]}'));
  const qaLine = qa.problems.length
    ? `:warning: *Automatic checks found ${qa.problems.length} issue(s):*\n${qa.problems.slice(0, 5).map((p) => `• ${escape(p)}`).join('\n')}`
    : ':white_check_mark: Automatic checks passed: page loads, no errors, no sideways scrolling on phone, tablet or desktop.';
  const value = JSON.stringify({ pr: Number(PR_NUMBER), branch: BRANCH, thread_ts: THREAD_TS });
  await api('chat.postMessage', {
    channel: SLACK_CHANNEL,
    thread_ts: THREAD_TS,
    text: `Preview ready: ${PREVIEW_URL}`,
    unfurl_links: false,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `:eyes: *Preview ready:* <${PREVIEW_URL}|open the preview site>\n\n${summary}` } },
      { type: 'section', text: { type: 'mrkdwn', text: qaLine } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Reply in this thread to ask for adjustments. Nothing is live until an admin presses Merge & deploy. <${PR_URL}|Code changes (PR #${PR_NUMBER})>` }] },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Merge & deploy' }, style: 'primary', action_id: 'merge_deploy', value,
            confirm: { title: { type: 'plain_text', text: 'Publish this change?' }, text: { type: 'mrkdwn', text: 'It will be live on the website in about a minute.' }, confirm: { type: 'plain_text', text: 'Publish' }, deny: { type: 'plain_text', text: 'Cancel' } } },
          { type: 'button', text: { type: 'plain_text', text: 'Discard' }, style: 'danger', action_id: 'discard', value,
            confirm: { title: { type: 'plain_text', text: 'Discard this change?' }, text: { type: 'mrkdwn', text: 'The preview and the draft change will be deleted.' }, confirm: { type: 'plain_text', text: 'Discard' }, deny: { type: 'plain_text', text: 'Keep' } } },
        ],
      },
    ],
  });
  await uploadFiles(['.slack/shot-phone.png', '.slack/shot-tablet.png', '.slack/shot-desktop.png'], 'Screenshots of the preview:');
} else if (mode === 'nochange') {
  const summary = escape(read('.slack/summary.txt', '')).slice(0, 2500);
  await api('chat.postMessage', { channel: SLACK_CHANNEL, thread_ts: THREAD_TS, text: `:thinking_face: I didn't change any files.\n${summary}` });
} else if (mode === 'failed') {
  await api('chat.postMessage', { channel: SLACK_CHANNEL, thread_ts: THREAD_TS, text: `:x: Something went wrong while making this change, so nothing was published. Try rephrasing in this thread, or ask Sid to check the <${process.env.RUN_URL}|run log>.` });
} else if (mode === 'live') {
  const title = process.env.COMMIT_TITLE ? ` (${escape(process.env.COMMIT_TITLE)})` : '';
  await api('chat.postMessage', {
    channel: SLACK_CHANNEL,
    ...(THREAD_TS ? { thread_ts: THREAD_TS, reply_broadcast: true } : {}),
    text: `:white_check_mark: Live on <${process.env.SITE_URL}|the website>${title}.`,
    unfurl_links: false,
  });
} else {
  throw new Error(`unknown mode ${mode}`);
}
