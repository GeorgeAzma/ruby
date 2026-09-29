// Uploads a package to the Chrome Web Store and submits it for review, using a service account.
//
//   node tools/publish.js ruby.zip
//
// Used by the Update dictionary workflow when these repository secrets are set (Settings > Secrets
// and variables > Actions); without them the workflow prepares a manual upload instead.
//   CWS_SERVICE_ACCOUNT_KEY  JSON key of the service account
//   CWS_PUBLISHER_ID         Developer dashboard > Publisher > Settings
//   CWS_EXTENSION_ID         The extension's ID
//
// One-time setup, after the first version is live in the store:
//   1. Google Cloud Console: create a project, enable the Chrome Web Store API, create a service
//      account, and download a JSON key for it.
//   2. Chrome Web Store developer dashboard > Account: add the service account's email.
//   3. Add the three secrets above to the GitHub repository.
// API reference: https://developer.chrome.com/docs/webstore/using-api

const crypto = require('crypto');
const fs = require('fs');

const { CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;
const API = 'https://chromewebstore.googleapis.com';
const ITEM = `publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}`;

// Service account -> signed JWT -> OAuth access token
async function accessToken() {
  const key = JSON.parse(CWS_SERVICE_ACCOUNT_KEY);
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = { iss: key.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}`;
  const assertion = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
  const res = await call('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  return res.access_token;
}

async function call(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method} ${url} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const file = process.argv[2];
  if (!file || !CWS_SERVICE_ACCOUNT_KEY || !CWS_PUBLISHER_ID || !CWS_EXTENSION_ID) {
    throw new Error('Usage: node tools/publish.js <package.zip>, with CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID and CWS_EXTENSION_ID set');
  }
  const headers = { Authorization: `Bearer ${await accessToken()}` };

  let status = await call(`${API}/upload/v2/${ITEM}:upload`, { method: 'POST', headers, body: fs.readFileSync(file) });
  for (let i = 0; JSON.stringify(status).includes('IN_PROGRESS'); i++) {
    if (i === 30) throw new Error('Upload still processing after 5 minutes');
    await new Promise((r) => setTimeout(r, 10000));
    status = await call(`${API}/v2/${ITEM}:fetchStatus`, { method: 'GET', headers });
  }
  if (JSON.stringify(status).includes('FAILED')) throw new Error(`Upload failed: ${JSON.stringify(status)}`);
  console.log('Uploaded:', JSON.stringify(status));

  const published = await call(`${API}/v2/${ITEM}:publish`, { method: 'POST', headers });
  console.log('Submitted for review:', JSON.stringify(published));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
