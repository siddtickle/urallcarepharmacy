import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchForThread,
  cleanReviewText,
  hmacHex,
  isInternalNote,
  isPlausibleEmail,
  makeTicket,
  originAllowed,
  slackEscape,
  slackToPlain,
  starNumber,
  verifySlackSignature,
} from '../src/util.ts';

test('slackToPlain turns Slack markup into readable text', () => {
  assert.equal(slackToPlain('<@U123ABC> we have it &amp; it is ready'), 'we have it & it is ready');
  assert.equal(slackToPlain('See <https://example.com|our page>'), 'See our page (https://example.com)');
  assert.equal(slackToPlain('Call <tel:3014850000|301-485-0000>'), 'Call 301-485-0000');
  assert.equal(slackToPlain('email <mailto:a@b.com|a@b.com>'), 'email a@b.com');
  assert.equal(slackToPlain('1 &lt; 2 &gt; 0'), '1 < 2 > 0');
});

test('internal notes are recognised', () => {
  assert.ok(isInternalNote('note: she called back'));
  assert.ok(isInternalNote('  NOTE : x'));
  assert.ok(isInternalNote('// internal'));
  assert.ok(!isInternalNote('Thanks, see you Monday'));
  assert.ok(!isInternalNote('Notes are ready'));
});

test('slackEscape', () => {
  assert.equal(slackEscape('<b> & </b>'), '&lt;b&gt; &amp; &lt;/b&gt;');
});

test('email check', () => {
  assert.ok(isPlausibleEmail('jane.doe@gmail.com'));
  assert.ok(!isPlausibleEmail('jane@'));
  assert.ok(!isPlausibleEmail('a b@c.com'));
});

test('ticket format', () => {
  const t = makeTicket(new Uint8Array([0, 1, 2, 3, 31]));
  assert.match(t, /^AC-[2-9A-HJ-NP-Z]{5}$/);
});

test('origins', () => {
  const list = 'www.urallcarepharmacy.com,urallcarepharmacy.com,*.allcare-pharmacy.pages.dev,localhost:4321';
  assert.ok(originAllowed('https://www.urallcarepharmacy.com', list));
  assert.ok(originAllowed('https://slack-change-1.allcare-pharmacy.pages.dev', list));
  assert.ok(originAllowed('http://localhost:4321', list));
  assert.ok(!originAllowed('https://evil.com', list));
  assert.ok(!originAllowed('https://allcare-pharmacy.pages.dev.evil.com', list));
  assert.ok(!originAllowed('http://www.urallcarepharmacy.com', list));
  assert.ok(!originAllowed(null, list));
});

test('reviews helpers', () => {
  assert.equal(starNumber('FIVE'), 5);
  assert.equal(starNumber('STAR_RATING_UNSPECIFIED'), 0);
  assert.equal(cleanReviewText('(Translated by Google) Great staff\n\n(Original)\nExcelente personal'), 'Great staff');
  assert.equal(cleanReviewText('  Plain review  '), 'Plain review');
});

test('branch name', () => {
  assert.equal(branchForThread('1790871806.712400'), 'slack/change-1790871806-712400');
});

test('Slack signature verification', async () => {
  const secret = '8f742231b10e8888abcd99yyyzzz85a5';
  const body = 'token=xyz&team_id=T1';
  const ts = '1790871800';
  const sig = 'v0=' + (await hmacHex(secret, `v0:${ts}:${body}`));
  assert.ok(await verifySlackSignature(secret, ts, sig, body, 1790871810));
  assert.ok(!(await verifySlackSignature(secret, ts, sig, body + 'x', 1790871810)), 'tampered body');
  assert.ok(!(await verifySlackSignature(secret, ts, sig, body, 1790871800 + 600)), 'too old');
  assert.ok(!(await verifySlackSignature(secret, null, sig, body, 1790871810)), 'missing header');
});

test('Slack signature matches Slack’s published example', async () => {
  // From https://api.slack.com/authentication/verifying-requests-from-slack
  const secret = '8f742231b10e8888abcd99yyyzzz85a5';
  const ts = '1531420618';
  const body =
    'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
  const sig = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
  assert.ok(await verifySlackSignature(secret, ts, sig, body, 1531420618));
});
