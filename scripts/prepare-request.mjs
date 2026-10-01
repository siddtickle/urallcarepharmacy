// Turns a Slack change request (GitHub repository_dispatch payload) into a prompt for Claude Code.
// Downloads any attached photos into site/public/uploads/ so Claude can use them.
// Reads: PAYLOAD (JSON), SLACK_BOT_TOKEN. Writes: .slack/prompt.md, .slack/request.json
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const payload = JSON.parse(process.env.PAYLOAD ?? '{}');
mkdirSync('.slack', { recursive: true });
writeFileSync('.slack/request.json', JSON.stringify(payload, null, 2));

const IMAGE_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const saved = [];
for (const f of payload.files ?? []) {
  const ext = extname(f.name).toLowerCase();
  if (!IMAGE_TYPES.has(ext)) continue;
  if (!/^https:\/\/files\.slack\.com\//.test(f.url)) continue; // only Slack's own file host
  const res = await fetch(f.url, { headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  if (!res.ok) continue;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) continue;
  const safe = basename(f.name, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'photo';
  const name = `${safe}-${Date.now().toString(36)}${ext === '.jpeg' ? '.jpg' : ext}`;
  mkdirSync('site/public/uploads', { recursive: true });
  writeFileSync(`site/public/uploads/${name}`, buf);
  saved.push(`site/public/uploads/${name}`);
}

let history = '';
try {
  history = execSync('git log origin/main..HEAD --format=%B', { encoding: 'utf8' }).trim();
} catch {}

const prompt = `You are updating the website for AllCare Pharmacy, a family-owned pharmacy in Oxon Hill, MD.
The site is an Astro project in the site/ folder (pages in site/src/pages, styles in site/src/styles/global.css,
store facts in site/src/config.ts, opening hours and holiday closures in site/src/lib/hours.ts).

A member of the pharmacy team asked for this change in Slack:
"""
${payload.request || '(no text; see the attached photos)'}
"""
${saved.length ? `\nThey attached these photos, already saved in the repo: ${saved.join(', ')}.\nReference them from pages as /uploads/<file name>. Give every image meaningful alt text.\n` : ''}
${payload.revision ? `\nThis is a follow-up in the same Slack thread. Earlier requests in this thread, already applied on this branch:\n"""\n${history || '(none)'}\n"""\nAdjust the existing work rather than starting over.\n` : ''}
Rules:
- Only edit files inside site/. Never touch worker/, scripts/, .github/ or any secrets.
- Keep the existing look: Figtree font, navy/blue/red colours, rounded cards. Keep it working on phones (the site has breakpoints at 860px and 480px).
- Keep it accessible: real links and buttons, alt text, labels on form fields, readable contrast.
- Do not add analytics, tracking pixels, chat widgets or third-party scripts.
- Never invent facts (prices, services, hours, staff names, reviews). If the request needs a fact you don't have, leave the page unchanged in that spot and say what is missing.
- When done, run \`npm run build\` and \`npm test\` in site/ and fix any errors.

Finish with a short summary for a non-technical store owner: 2 to 4 plain bullet points of what changed, plus anything you could not do and why. No code, no file paths.`;

writeFileSync('.slack/prompt.md', prompt);
console.log(`Prompt written. ${saved.length} attachment(s) saved.`);
