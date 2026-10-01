// QA for a preview deployment: screenshots at phone, tablet and desktop width, plus a basic health check.
// Usage: node scripts/qa-screenshots.mjs <url>   → writes .slack/shot-*.png and .slack/qa.json
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) throw new Error('usage: qa-screenshots.mjs <url>');
mkdirSync('.slack', { recursive: true });

const sizes = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1366, height: 900 },
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const problems = [];
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.name === 'desktop' ? 1 : 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).host === new URL(url).host) errors.push(`${r.status()} ${r.url()}`);
  });
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  if (!res || !res.ok()) problems.push(`${s.name}: page returned ${res?.status()}`);
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${s.name}: page is ${overflow}px wider than the screen (sideways scrolling)`);
  for (const e of errors) problems.push(`${s.name}: ${e}`);
  await page.screenshot({ path: `.slack/shot-${s.name}.png`, fullPage: true });
  await page.close();
}
await browser.close();

writeFileSync('.slack/qa.json', JSON.stringify({ problems: [...new Set(problems)] }, null, 2));
console.log(problems.length ? `QA found ${problems.length} problem(s)` : 'QA passed');
