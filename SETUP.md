# AllCare Pharmacy website: setup guide

This repo is three things:

| Folder | What it is | Runs on |
| --- | --- | --- |
| `site/` | The public website (Astro, static pages) | Cloudflare Pages |
| `worker/` | The backend: contact form, Slack, Google reviews | Cloudflare Workers, at `api.urallcarepharmacy.com` |
| `.github/workflows/`, `scripts/` | Slack change requests → preview → deploy | GitHub Actions |

How the pieces talk:

```
Contact form ──► backend ──► #website-inquiries ──(thread reply)──► backend ──► email to customer (Resend)
Google ──(checked every 15 min)──► backend ──► #google-reviews ──(thread reply)──► backend ──► public reply on Google
#website-changes ──► backend ──► GitHub Actions: Claude edits site/ → preview on pages.dev → screenshots + buttons in the thread
"Merge & deploy" button ──► backend merges the PR ──► GitHub Actions publishes ──► "Live" message in the thread
```

Plan on an afternoon for setup. Google's API approval (step 6) can take days to weeks, so **start step 6a first**; everything else works without it, and the site shows a fixed rating until it's approved.

## What it costs

| Service | Cost |
| --- | --- |
| Cloudflare (site, backend, spam check, storage) | Free tier |
| GitHub (private repo, Actions) | Free tier (2,000 Action minutes a month; a change uses about 4) |
| Resend (sending reply emails) | Free up to 3,000 emails a month, 100 a day |
| Google Business Profile API | Free |
| Slack | Works on the free plan; free plan hides history older than 90 days |
| Anthropic API (Claude making website changes) | Pay per use; a typical small change is well under $1. Set a monthly limit in the console. |

---

## 1. GitHub

1. Create a **private** repository, e.g. `allcare-pharmacy-site`, and push this folder to it.
2. Repo **Settings → Actions → General → Workflow permissions**: choose *Read and write permissions* and tick **Allow GitHub Actions to create and approve pull requests**.
3. Create a **fine-grained personal access token** (GitHub → Settings → Developer settings) for the backend:
   - Repository access: only this repo
   - Permissions: **Contents: Read and write**, **Pull requests: Read and write**
   - Save it for step 8 as `GITHUB_TOKEN`.

## 2. Cloudflare

1. Create a Cloudflare account and **add the domain** `urallcarepharmacy.com`. Cloudflare copies the existing DNS records; check they look right, then change the nameservers at the domain registrar to the two Cloudflare gives you. (Do this when you're ready to launch. Until the switch, the old site keeps running.)
2. Install tools once: `npm install` in `worker/`, then `cd worker && npx wrangler login`.
3. Create the storage the backend uses:
   ```sh
   npx wrangler kv namespace create STATE
   ```
   Copy the `id` it prints into `worker/wrangler.toml` (`REPLACE_WITH_KV_NAMESPACE_ID`).
4. Create the website project:
   ```sh
   npx wrangler pages project create allcare-pharmacy --production-branch main
   ```
   Then in the dashboard: **Workers & Pages → allcare-pharmacy → Custom domains** → add `www.urallcarepharmacy.com` and `urallcarepharmacy.com`.
   If you use a different project name, change `*.allcare-pharmacy.pages.dev` in `wrangler.toml` to match.
5. **Turnstile** (spam protection): dashboard → Turnstile → Add widget. Hostnames: `urallcarepharmacy.com`, `allcare-pharmacy.pages.dev`. Widget mode: *Managed*. Keep the **site key** (public) and **secret key**.
6. **API token** for GitHub Actions: My Profile → API Tokens → Create Token → *Edit Cloudflare Workers* template, and add **Cloudflare Pages: Edit**. Note your **Account ID** (right sidebar of any zone page).
7. Old page addresses from the WordPress site already redirect to the right homepage sections (`site/public/_redirects`), so search rank and bookmarks carry over.

## 3. Slack

1. Create three channels and copy each **channel ID** (open the channel → click its name → bottom of the *About* tab):
   - `#website-inquiries`: Contact Us messages
   - `#google-reviews`: new Google reviews
   - `#website-changes`: **make this private**, admins only. Anyone in it can request website changes.
2. Go to <https://api.slack.com/apps> → **Create New App → From an app manifest**, choose your workspace, paste `slack-app-manifest.yaml`.
3. **Basic Information → Signing Secret**: save as `SLACK_SIGNING_SECRET`.
4. **Install App** → install to workspace → copy the **Bot User OAuth Token** (`xoxb-…`) as `SLACK_BOT_TOKEN`.
5. In each of the three channels, type `/invite @AllCare Website`.
6. Copy the **member ID** of everyone allowed to publish changes (click their name → ⋮ → *Copy member ID*).
7. After step 8 (backend deployed), return to the app's **Event Subscriptions** page and click **Retry** next to the Request URL until it shows *Verified*. Do the same for **Interactivity**.

## 4. Email replies (Resend)

1. Sign up at <https://resend.com>, **Domains → Add domain** `urallcarepharmacy.com`, and add the DNS records it shows in Cloudflare DNS. Wait for *Verified*.
2. **API Keys → Create** (sending access) → save as `RESEND_API_KEY`.
3. Replies go out from `hello@urallcarepharmacy.com` (change `EMAIL_FROM` in `wrangler.toml` if you prefer), and when customers reply to that email it lands in `urallcarepharmacy@gmail.com` (`EMAIL_REPLY_TO`).

## 5. Claude (for website changes)

1. Create an API key at <https://console.anthropic.com> → save as `ANTHROPIC_API_KEY`.
2. Set a monthly spend limit under **Billing → Limits**.

## 6. Google reviews

a. **Request API access now.** The Business Profile API is free but needs approval:
   1. Create a project at <https://console.cloud.google.com>.
   2. Submit the access request form: <https://developers.google.com/my-business/content/prereqs> (use the Google account that manages the AllCare listing; approval usually takes a few days to a few weeks).
   3. Once approved, enable **My Business Account Management API**, **My Business Business Information API** and **Google My Business API** in that project.

b. **Get the sign-in token.** In the Cloud project: **APIs & Services → OAuth consent screen** (External; add yourself as a test user, then *Publish app* so the token doesn't expire after 7 days) → **Credentials → Create OAuth client ID → Desktop app**. Then on your computer:
   ```sh
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
   ```
   Sign in as a manager of the listing. Google may warn that the app is unverified; since it's your own app, choose *Advanced → Continue*. It prints `GOOGLE_REFRESH_TOKEN`, `GOOGLE_ACCOUNT_ID` and `GOOGLE_LOCATION_ID`.

c. The first time the backend checks Google it quietly records the existing reviews; only reviews posted after that go to Slack.

## 7. Fill in `worker/wrangler.toml`

Set the KV id, `GITHUB_REPO`, the three channel IDs, `SLACK_DEPLOYERS`, and the two Google IDs (leave `"0"` until step 6 is done).

## 8. Deploy the backend

```sh
cd worker
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GOOGLE_CLIENT_ID      # when step 6 is done
npx wrangler secret put GOOGLE_CLIENT_SECRET  # when step 6 is done
npx wrangler secret put GOOGLE_REFRESH_TOKEN  # when step 6 is done
npm test && npx wrangler deploy
curl https://api.urallcarepharmacy.com/health   # should print ok
```

Then finish Slack step 3.7.

## 9. GitHub secrets and variables

Repo **Settings → Secrets and variables → Actions**.

| Secrets | |
| --- | --- |
| `ANTHROPIC_API_KEY` | step 5 |
| `CLOUDFLARE_API_TOKEN` | step 2.6 |
| `CLOUDFLARE_ACCOUNT_ID` | step 2.6 |
| `SLACK_BOT_TOKEN` | step 3.4 |

| Variables | |
| --- | --- |
| `PAGES_PROJECT` | `allcare-pharmacy` |
| `PUBLIC_API_BASE` | `https://api.urallcarepharmacy.com` |
| `PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key, step 2.5 |
| `SLACK_CHANGES_CHANNEL` | channel ID of `#website-changes` |

Then **Actions → Deploy → Run workflow** to publish the site for the first time.

## 10. Test it end to end

- [ ] `https://www.urallcarepharmacy.com` loads, shows Open/Closed correctly, and the menu works on a phone.
- [ ] Send the Contact Us form with your own email. It appears in `#website-inquiries` within seconds.
- [ ] Reply in that thread. You get the email; the reply gets a ✉️ reaction.
- [ ] Reply with `note: test`. No email is sent.
- [ ] In `#website-changes`, post *"Change the hero heading to 'Your family pharmacy in Oxon Hill.'"*. Within ~5 minutes the thread has a preview link, screenshots and buttons.
- [ ] Reply in the thread with a tweak; a new preview arrives.
- [ ] Press **Merge & deploy**; a minute later the thread says *Live* and the site shows the change.
- [ ] (After Google approval) Leave a test review from a personal account; it appears in `#google-reviews` within 15 minutes. Reply in the thread and check it on Google Maps.

---

## Using it day to day

**#website-inquiries.** Every Contact Us message arrives here. Reply in its thread and the reply is **emailed to the customer**, signed as AllCare Pharmacy. If they gave only a phone number, the bot reminds you to call. Start a message with `note:` to talk with the team without emailing anyone.

**#google-reviews.** New reviews arrive within 15 minutes; 1–3 star reviews are flagged. Reply in the thread and it's posted as the **public** owner reply on Google. Replying again replaces the earlier reply. `note:` keeps a message internal.

**#website-changes.** Post what you want changed in plain words, with photos attached if needed (e.g. *"Add that we're closed Thanksgiving Day"* or *"Use this photo of the counter in the About section"*). The bot replies with a preview link, phone/tablet/desktop screenshots and automatic checks. Reply in the thread to adjust. When it looks right, an admin presses **Merge & deploy**. Nothing changes on the live site until then. Type `help` in the channel for a reminder.

## Privacy note

The form asks people not to include medication or health details and to call about prescriptions, but some will anyway. Whatever they type lands in Slack and, when you reply, in email. Slack's free and paid plans below Enterprise can't be covered by a HIPAA business associate agreement, so treat those threads with care: don't repeat health details back in replies; ask the person to call instead.

## Holidays and hours

Edit `site/src/lib/hours.ts` (`CLOSED_DATES`, `SPECIAL_HOURS`), or just ask in `#website-changes`: *"We're closed Nov 26 and close at 2pm on Dec 24."*

## Local development

```sh
cd site && npm install && npm run dev          # http://localhost:4321
cd worker && npm install && npm test && npx tsc --noEmit
```
