// One-time helper: sign in with the Google account that manages the AllCare Business Profile,
// then prints the refresh token, account ID and location ID the backend needs.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs
//
// The OAuth client must be a "Desktop app" client in the same Google Cloud project that has
// Business Profile API access approved.
import http from 'node:http';
import { exec } from 'node:child_process';

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.');
  process.exit(1);
}

const port = 53682;
const redirectUri = `http://127.0.0.1:${port}/callback`;
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/business.manage',
    access_type: 'offline',
    prompt: 'consent',
  });

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, redirectUri);
    if (url.pathname !== '/callback') return res.end();
    const c = url.searchParams.get('code');
    res.end(c ? 'Signed in. You can close this tab and go back to the terminal.' : 'Sign-in failed.');
    server.close();
    c ? resolve(c) : reject(new Error(url.searchParams.get('error') ?? 'no code'));
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('\nOpening Google sign-in. If nothing opens, visit:\n' + authUrl + '\n');
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${opener} "${authUrl}"`);
  });
});

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
});
const tokens = await tokenRes.json();
if (!tokens.refresh_token) {
  console.error('No refresh token returned:', tokens);
  process.exit(1);
}
const auth = { authorization: `Bearer ${tokens.access_token}` };

const accounts = await (await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth })).json();
if (!accounts.accounts?.length) {
  console.error('No Business Profile accounts found for this Google user:', accounts);
  process.exit(1);
}

console.log('\nGOOGLE_REFRESH_TOKEN (save with: npx wrangler secret put GOOGLE_REFRESH_TOKEN):');
console.log(tokens.refresh_token);
console.log('\nBusiness locations this account manages:');
for (const acct of accounts.accounts) {
  const locs = await (
    await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`, { headers: auth })
  ).json();
  for (const loc of locs.locations ?? []) {
    const addr = loc.storefrontAddress?.addressLines?.join(' ') ?? '';
    console.log(`\n  ${loc.title} — ${addr}`);
    console.log(`  GOOGLE_ACCOUNT_ID  = "${acct.name.split('/')[1]}"`);
    console.log(`  GOOGLE_LOCATION_ID = "${loc.name.split('/')[1]}"`);
  }
}
console.log('\nPut the two IDs for 6341 Livingston Rd into worker/wrangler.toml.');
