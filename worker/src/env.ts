export interface Env {
  /** Thread mappings, review state, rate limits, cached reviews. */
  STATE: KVNamespace;

  // Plain settings (wrangler.toml [vars])
  SITE_URL: string; // https://www.urallcarepharmacy.com
  ALLOWED_ORIGINS: string; // comma list; "*.allcare-pharmacy.pages.dev" style wildcards allowed
  SLACK_INQUIRIES_CHANNEL: string; // channel ID of #website-inquiries
  SLACK_REVIEWS_CHANNEL: string; // channel ID of #google-reviews
  SLACK_CHANGES_CHANNEL: string; // channel ID of #website-changes
  SLACK_DEPLOYERS: string; // comma list of Slack user IDs allowed to press "Merge & deploy"
  GITHUB_REPO: string; // owner/repo
  EMAIL_FROM: string; // "AllCare Pharmacy <hello@urallcarepharmacy.com>"
  EMAIL_REPLY_TO: string; // where customers' email replies land
  GOOGLE_ACCOUNT_ID: string; // numeric, from scripts/google-auth.mjs
  GOOGLE_LOCATION_ID: string; // numeric, from scripts/google-auth.mjs
  STORE_PHONE: string;

  // Secrets (wrangler secret put …)
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  TURNSTILE_SECRET: string;
  RESEND_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  GITHUB_TOKEN: string;
}

/** What a Slack thread is about, stored under thread:<channel>:<ts>. */
export type ThreadRecord =
  | {
      kind: 'contact';
      ticket: string;
      name: string;
      email?: string;
      phone?: string;
      contactPref: string;
      topic: string;
      message: string;
      repliesSent?: number;
    }
  | { kind: 'review'; reviewId: string; reviewer: string; stars: number }
  | { kind: 'change'; branch: string; requestedBy: string };

export const THREAD_TTL = 60 * 60 * 24 * 365; // keep thread links for a year
