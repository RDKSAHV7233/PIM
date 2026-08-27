#!/usr/bin/env node
/**
 * Webhook handler that auto-sorts incoming alias emails into dedicated folders.
 *
 * Deploy this as an Express route or standalone server. When Hostinger sends
 * a message.received webhook, this handler checks the To/Delivered-To headers
 * and moves the message to the matching alias folder.
 *
 * Standalone:  HOSTINGER_MAIL_TOKEN=<token> node scripts/hostinger-alias-webhook-handler.cjs
 * As module:   const { handleWebhook } = require('./hostinger-alias-webhook-handler.cjs');
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────

const MAIL_TOKEN = process.env.HOSTINGER_MAIL_TOKEN;
const WEBHOOK_SECRET = process.env.HOSTINGER_WEBHOOK_SECRET || '';
const PORT = parseInt(process.env.WEBHOOK_PORT || '3099', 10);

if (!MAIL_TOKEN) {
  console.error('HOSTINGER_MAIL_TOKEN env var is required');
  process.exit(1);
}

const MAILBOX_RESOURCE_ID = process.env.HOSTINGER_MAILBOX_ID || 'AC6a04a5fed4ed551d0bb09ad90a9b';

const ALIAS_FOLDER_MAP = {
  'support@vexapim.com':       'INBOX.Support',
  'billing@vexapim.com':       'INBOX.Billing',
  'admin@vexapim.com':         'INBOX.Admin',
  'team@vexapim.com':          'INBOX.Team',
  'noreply@vexapim.com':       'INBOX.Noreply',
  'notifications@vexapim.com': 'INBOX.Notifications',
  'onboarding@vexapim.com':    'INBOX.Onboarding',
  'sales@vexapim.com':         'INBOX.Sales',
  'vishal@vexapim.com':        'INBOX.Vishal',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function mailApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.mail.hostinger.com',
      method,
      path,
      headers: {
        'Authorization': `Bearer ${MAIL_TOKEN}`,
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
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET) return true;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

function extractRecipients(headers) {
  const addrs = new Set();
  const fields = ['to', 'cc', 'delivered-to', 'x-original-to', 'envelope-to'];
  for (const field of fields) {
    const val = headers[field] || headers[field.charAt(0).toUpperCase() + field.slice(1)] || '';
    for (const part of String(val).toLowerCase().split(/[,;\s]+/)) {
      const m = part.match(/([a-z0-9._+-]+@[a-z0-9.-]+)/);
      if (m) addrs.add(m[1]);
    }
  }
  return [...addrs];
}

// ── Core handler ────────────────────────────────────────────────────────────

async function handleWebhook(event) {
  if (event.event !== 'message.received') return { action: 'ignored', reason: 'not message.received' };

  const msg = event.data || {};
  const uid = msg.uid;
  const folder = msg.folder || 'INBOX';
  const headers = msg.headers || {};

  const recipients = extractRecipients(headers);
  const subject = headers.subject || headers.Subject || '(no subject)';

  for (const addr of recipients) {
    const targetFolder = ALIAS_FOLDER_MAP[addr];
    if (targetFolder && folder !== targetFolder) {
      const encodedFolder = encodeURIComponent(folder);
      const res = await mailApi(
        'POST',
        `/api/v1/mailboxes/${MAILBOX_RESOURCE_ID}/folders/${encodedFolder}/messages/${uid}/move`,
        { targetFolder }
      );

      if (res.status < 300) {
        console.log(`[${new Date().toISOString()}] Moved msg #${uid} "${subject}" -> ${targetFolder} (alias: ${addr})`);
        return { action: 'moved', uid, from: folder, to: targetFolder, alias: addr };
      } else {
        console.log(`[${new Date().toISOString()}] Move failed for msg #${uid}: ${JSON.stringify(res.data)}`);
        return { action: 'error', uid, error: res.data };
      }
    }
  }

  return { action: 'no-match', uid, recipients };
}

// ── Standalone server ───────────────────────────────────────────────────────

if (require.main === module) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/hostinger-mail') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const raw = Buffer.concat(chunks).toString();

        const sig = req.headers['x-webhook-signature'] || '';
        if (WEBHOOK_SECRET && !verifySignature(raw, sig)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid signature' }));
          return;
        }

        try {
          const event = JSON.parse(raw);
          const result = await handleWebhook(event);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', aliases: Object.keys(ALIAS_FOLDER_MAP) }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(PORT, () => {
    console.log(`Hostinger alias webhook handler listening on port ${PORT}`);
    console.log(`Endpoint: POST /webhook/hostinger-mail`);
    console.log(`Health:   GET  /health`);
    console.log(`Aliases:  ${Object.keys(ALIAS_FOLDER_MAP).join(', ')}`);
  });
}

module.exports = { handleWebhook, ALIAS_FOLDER_MAP };
