#!/usr/bin/env node
/**
 * Hostinger Email Alias & Folder Setup
 *
 * Creates email aliases on vexapim.com via the Hostinger Hosting API,
 * then auto-sorts incoming messages into dedicated folders via the Mail API.
 *
 * Usage:
 *   HOSTINGER_API_TOKEN=<hosting-api-token> node scripts/hostinger-email-alias-setup.cjs [--create-aliases] [--setup-webhook <url>] [--sort-existing] [--list]
 *
 * Tokens:
 *   HOSTINGER_API_TOKEN  — Hosting API token from hPanel → API (for alias CRUD)
 *   HOSTINGER_MAIL_TOKEN — Mail API token from Agentic Mail → API access (for folders/messages)
 */

'use strict';

const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────

const HOSTING_API_BASE = 'developers.hostinger.com';
const MAIL_API_BASE = 'api.mail.hostinger.com';

const HOSTING_TOKEN = process.env.HOSTINGER_API_TOKEN || '';
const MAIL_TOKEN = process.env.HOSTINGER_MAIL_TOKEN || '';

if (!MAIL_TOKEN) {
  console.error('HOSTINGER_MAIL_TOKEN env var is required');
  process.exit(1);
}

const MAILBOX_RESOURCE_ID = process.env.HOSTINGER_MAILBOX_ID || 'AC6a04a5fed4ed551d0bb09ad90a9b';
const PRIMARY_ADDRESS = 'info@vexapim.com';

const ALIAS_FOLDER_MAP = {
  'support':       'INBOX.Support',
  'billing':       'INBOX.Billing',
  'admin':         'INBOX.Admin',
  'team':          'INBOX.Team',
  'noreply':       'INBOX.Noreply',
  'notifications': 'INBOX.Notifications',
  'onboarding':    'INBOX.Onboarding',
  'sales':         'INBOX.Sales',
  'vishal':        'INBOX.Vishal',
};

// ── HTTP helper ─────────────────────────────────────────────────────────────

function request(host, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: host,
      method,
      path,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        if (res.statusCode >= 400) {
          const err = new Error(`${res.statusCode} ${method} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
          err.status = res.statusCode;
          err.body = data;
          reject(err);
        } else {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function hostingApi(method, path, body) {
  return request(HOSTING_API_BASE, method, path, HOSTING_TOKEN, body);
}

function mailApi(method, path, body) {
  return request(MAIL_API_BASE, method, path, MAIL_TOKEN, body);
}

// ── Commands ────────────────────────────────────────────────────────────────

async function listCurrentState() {
  console.log('\n📋 Current Mailbox State');
  console.log('─'.repeat(50));

  // Folders
  const folders = await mailApi('GET', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/folders`);
  console.log('\nFolders:');
  for (const f of folders.data.data) {
    const badge = f.specialUse ? ` (${f.specialUse})` : '';
    console.log(`  ${f.path.padEnd(25)} ${String(f.messageCount).padStart(4)} msgs, ${String(f.unreadCount).padStart(4)} unread${badge}`);
  }

  // Quota
  const quota = await mailApi('GET', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/quota`);
  const storage = quota.data.data.quotas.find((q) => q.resourceName === 'STORAGE');
  const messages = quota.data.data.quotas.find((q) => q.resourceName === 'MESSAGE');
  console.log(`\nQuota:`);
  if (storage) console.log(`  Storage:  ${(storage.usage / 1024).toFixed(1)} KB / ${(storage.limit / 1048576).toFixed(0)} MB (${storage.percentage}%)`);
  if (messages) console.log(`  Messages: ${messages.usage} / ${messages.limit} (${messages.percentage}%)`);

  // Aliases (needs hosting token)
  if (HOSTING_TOKEN) {
    try {
      const me = await mailApi('GET', '/api/v1/me');
      const orderId = me.data.data.orderResourceId;
      const aliases = await hostingApi('GET', `/api/mail/v1/orders/${orderId}/aliases`);
      console.log('\nAliases:');
      const aliasList = aliases.data.data || aliases.data;
      if (Array.isArray(aliasList) && aliasList.length > 0) {
        for (const a of aliasList) {
          console.log(`  ${a.address} → ${a.mailbox?.address || PRIMARY_ADDRESS} [${a.is_active ? 'active' : 'inactive'}]`);
        }
      } else {
        console.log('  (none configured)');
      }
    } catch (err) {
      console.log(`\nAliases: ⚠️  Could not list (${err.message})`);
    }
  } else {
    console.log('\nAliases: (set HOSTINGER_API_TOKEN to list)');
  }
}

async function createAliases() {
  if (!HOSTING_TOKEN) {
    console.error('\n❌ HOSTINGER_API_TOKEN is required to create aliases.');
    console.error('   Get it from hPanel → API → Create token');
    console.error('   Then run: HOSTINGER_API_TOKEN=<token> node scripts/hostinger-email-alias-setup.cjs --create-aliases');
    process.exit(1);
  }

  console.log('\n🔧 Creating Aliases');
  console.log('─'.repeat(50));

  const localParts = Object.keys(ALIAS_FOLDER_MAP);
  const results = [];

  for (const localPart of localParts) {
    if (localPart === 'info') continue; // skip primary
    const alias = `${localPart}@vexapim.com`;
    try {
      const res = await hostingApi('POST', `/api/mail/v1/mailboxes/${MAILBOX_RESOURCE_ID}/aliases`, {
        local_part: localPart,
      });
      const created = res.data.data || res.data;
      console.log(`  ✅ ${alias} → created (id: ${created.id})`);
      results.push({ alias, id: created.id, status: 'created' });
    } catch (err) {
      if (err.status === 422 || err.status === 409) {
        console.log(`  ⏭️  ${alias} → already exists`);
        results.push({ alias, status: 'exists' });
      } else {
        console.log(`  ❌ ${alias} → failed: ${err.message}`);
        results.push({ alias, status: 'failed', error: err.message });
      }
    }
  }

  return results;
}

async function ensureFolders() {
  console.log('\n📁 Ensuring Folders');
  console.log('─'.repeat(50));

  const existing = await mailApi('GET', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/folders`);
  const existingPaths = new Set(existing.data.data.map((f) => f.path));

  for (const [alias, folder] of Object.entries(ALIAS_FOLDER_MAP)) {
    if (existingPaths.has(folder)) {
      console.log(`  ⏭️  ${folder} → exists`);
    } else {
      const name = folder.replace('INBOX.', '');
      try {
        await mailApi('POST', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/folders`, { name });
        console.log(`  ✅ ${folder} → created`);
      } catch (err) {
        console.log(`  ❌ ${folder} → failed: ${err.message}`);
      }
    }
  }
}

async function setupWebhook(webhookUrl) {
  if (!webhookUrl) {
    console.error('\n❌ Webhook URL required: --setup-webhook <url>');
    process.exit(1);
  }

  console.log('\n🔗 Setting Up Webhook');
  console.log('─'.repeat(50));

  try {
    const res = await mailApi('POST', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/webhooks`, {
      url: webhookUrl,
      events: ['message.received'],
    });
    const wh = res.data.data || res.data;
    console.log(`  ✅ Webhook created`);
    console.log(`  ID:     ${wh.id}`);
    console.log(`  URL:    ${webhookUrl}`);
    console.log(`  Secret: ${wh.secret}`);
    console.log('\n  ⚠️  Save the secret — it is shown only once!');
    console.log('  The webhook will fire on every incoming message.');
    console.log('  Your endpoint should move messages to the correct folder based on the To: address.');
  } catch (err) {
    console.log(`  ❌ Failed: ${err.message}`);
  }
}

async function sortExistingMessages() {
  console.log('\n📬 Sorting Existing INBOX Messages by Alias');
  console.log('─'.repeat(50));

  let page = 1;
  let moved = 0;
  const aliasAddresses = Object.keys(ALIAS_FOLDER_MAP).map((lp) => `${lp}@vexapim.com`);

  while (true) {
    const res = await mailApi('GET', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/folders/INBOX/messages?page=${page}&perPage=50`);
    const messages = res.data.data || [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      const recipients = new Set();
      for (const list of [msg.to, msg.cc, msg.bcc].filter(Boolean)) {
        for (const entry of list) {
          if (entry.address) recipients.add(entry.address.toLowerCase());
        }
      }

      for (const [localPart, targetFolder] of Object.entries(ALIAS_FOLDER_MAP)) {
        const aliasAddr = `${localPart}@vexapim.com`;
        if (recipients.has(aliasAddr)) {
          try {
            await mailApi('POST', `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/folders/INBOX/messages/${msg.uid}/move`, {
              targetFolder,
            });
            const subj = (msg.subject || '(no subject)').substring(0, 60);
            console.log(`  msg #${msg.uid} -> ${targetFolder} (${aliasAddr}) "${subj}"`);
            moved++;
          } catch (err) {
            console.log(`  msg #${msg.uid} -> move failed: ${err.message}`);
          }
          break;
        }
      }
    }

    const pagination = res.data.pagination;
    if (!pagination || page >= pagination.totalPages) break;
    page++;
  }

  console.log(`\n  Moved ${moved} messages total.`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || '--list';

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Hostinger Email Alias & Folder Setup          ║');
  console.log('║   Mailbox: info@vexapim.com                     ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    switch (cmd) {
      case '--list':
        await listCurrentState();
        break;

      case '--create-aliases':
        await ensureFolders();
        await createAliases();
        break;

      case '--setup-webhook':
        await setupWebhook(args[1]);
        break;

      case '--sort-existing':
        await sortExistingMessages();
        break;

      case '--full-setup':
        await ensureFolders();
        await createAliases();
        if (args[1]) await setupWebhook(args[1]);
        await sortExistingMessages();
        break;

      default:
        console.log(`
Usage:
  --list              Show current folders, quota, and aliases
  --create-aliases    Create all aliases (needs HOSTINGER_API_TOKEN)
  --setup-webhook <url>  Set up message.received webhook
  --sort-existing     Move existing INBOX messages to alias folders
  --full-setup [url]  Run everything: folders + aliases + webhook + sort

Environment:
  HOSTINGER_API_TOKEN   Hosting API token (hPanel → API) for alias CRUD
  HOSTINGER_MAIL_TOKEN  Mail API token (Agentic Mail → API access) for folders/messages
`);
    }
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  }
}

main();
