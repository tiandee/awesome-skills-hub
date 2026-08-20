'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { createUiService, serviceError } = require('./service');

const PUBLIC_ROOT = path.join(__dirname, 'public');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const MAX_BODY_BYTES = 64 * 1024;

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

function securityHeaders(contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, securityHeaders('application/json; charset=utf-8'));
  response.end(JSON.stringify(payload, null, 2) + '\n');
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ''), 'utf8');
  const second = Buffer.from(String(right || ''), 'utf8');
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function requireSession(request, sessionToken) {
  if (!safeEqual(request.headers['x-ash-session'], sessionToken)) {
    throw serviceError(403, 'SESSION_REQUIRED', 'This write-capable API request needs the ASH page session token.');
  }
}

function readJsonBody(request) {
  return new Promise(function read(resolve, reject) {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on('data', function chunk(value) {
      if (failed) return;
      size += value.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(serviceError(413, 'BODY_TOO_LARGE', 'Request body exceeds 64 KiB.'));
        return;
      }
      chunks.push(value);
    });
    request.on('end', function complete() {
      if (failed) return;
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(serviceError(400, 'INVALID_JSON', 'Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function sendStatic(response, route, sessionToken) {
  const selected = STATIC_FILES[route];
  if (!selected) return false;
  let content = fs.readFileSync(path.join(PUBLIC_ROOT, selected.file));
  if (selected.file === 'index.html') {
    content = Buffer.from(content.toString('utf8').replace('__ASH_SESSION_TOKEN__', sessionToken), 'utf8');
  }
  response.writeHead(200, Object.assign(
    { 'Content-Length': content.length },
    securityHeaders(selected.type),
  ));
  response.end(content);
  return true;
}

function createUiServer(settings, options) {
  const opts = options || {};
  const service = opts.service || createUiService(settings, opts.serviceOptions);
  const sessionToken = opts.sessionToken || crypto.randomBytes(24).toString('hex');

  const server = http.createServer(function handle(request, response) {
    Promise.resolve().then(async function route() {
      const selected = new URL(request.url, 'http://localhost');
      const pathname = selected.pathname;

      if (request.method === 'GET' && sendStatic(response, pathname, sessionToken)) return;
      if (request.method === 'GET' && pathname === '/favicon.ico') {
        response.writeHead(204, securityHeaders('image/x-icon'));
        response.end();
        return;
      }
      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { ok: true, service: 'ash-ui' });
        return;
      }
      if (request.method === 'GET' && pathname === '/api/overview') {
        sendJson(response, 200, service.overview());
        return;
      }
      if (request.method === 'GET' && pathname.indexOf('/api/skills/') === 0) {
        const parts = pathname.slice('/api/skills/'.length).split('/').map(decodeURIComponent);
        if (parts.length === 1) sendJson(response, 200, service.skillDetail(parts[0]));
        else sendJson(response, 200, service.skillDetail(parts[1], parts[0]));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/libraries/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.previewLibraryChange(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/libraries/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applyLibraryChange(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/skills/create/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.previewCreateSkill(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/skills/create/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applyCreateSkill(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/skills/description/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.previewSkillDescription(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/skills/description/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applySkillDescription(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/check') {
        requireSession(request, sessionToken);
        const body = await readJsonBody(request);
        sendJson(response, 200, body && body.name ? await service.checkSkillUpdate(body.name) : await service.checkUpdates());
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/source/discover') {
        requireSession(request, sessionToken);
        sendJson(response, 200, await service.discoverSkillSource(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/source/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, await service.previewSkillSource(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/source/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, await service.applySkillSource(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, await service.previewSkillUpdate(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, await service.applySkillUpdate(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/rollback/preview') {
        requireSession(request, sessionToken);
        await readJsonBody(request);
        sendJson(response, 200, service.previewSkillUpdateRollback());
        return;
      }
      if (request.method === 'POST' && pathname === '/api/updates/rollback/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applySkillUpdateRollback(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/packages/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.previewPackage(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/packages/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applyPackage(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/snapshots/create/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.previewSnapshotCreate(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/snapshots/create/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applySnapshotCreate(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/snapshots/restore/preview') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.previewSnapshotRestore(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/snapshots/restore/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applySnapshotRestore(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/snapshots/verify') {
        requireSession(request, sessionToken);
        const body = await readJsonBody(request);
        sendJson(response, 200, service.verifyManagedSnapshot(body.snapshot));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/repair/preview') {
        requireSession(request, sessionToken);
        const body = await readJsonBody(request);
        sendJson(response, 200, service.previewRepair(body.scope));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/repair/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applyRepair(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/transactions/prune/preview') {
        requireSession(request, sessionToken);
        await readJsonBody(request);
        sendJson(response, 200, service.previewTransactionPrune());
        return;
      }
      if (request.method === 'POST' && pathname === '/api/transactions/prune/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applyTransactionPrune(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/rollback/preview') {
        requireSession(request, sessionToken);
        const body = await readJsonBody(request);
        sendJson(response, 200, service.previewRollback(body.selector));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/rollback/apply') {
        requireSession(request, sessionToken);
        sendJson(response, 200, service.applyRollback(await readJsonBody(request)));
        return;
      }
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'ASH UI route not found.' } });
    }).catch(function failed(error) {
      const statusCode = error.statusCode || (/unknown user Skill/.test(error.message) ? 404 : 500);
      sendJson(response, statusCode, {
        error: {
          code: error.code || (statusCode === 404 ? 'SKILL_NOT_FOUND' : 'INTERNAL_ERROR'),
          message: error.message,
        },
      });
    });
  });

  server.ashSessionToken = sessionToken;
  return server;
}

function openBrowser(url, options) {
  const opts = options || {};
  const platform = opts.platform || process.platform;
  let command;
  let args;
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = (opts.spawn || childProcess.spawn)(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function startUiServer(settings, options) {
  const opts = options || {};
  const host = opts.host || DEFAULT_HOST;
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    return Promise.reject(serviceError(400, 'LOOPBACK_REQUIRED', 'ASH UI only binds to a loopback host.'));
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(serviceError(400, 'INVALID_PORT', 'UI port must be an integer between 0 and 65535.'));
  }
  const server = createUiServer(settings, opts);
  return new Promise(function listen(resolve, reject) {
    function failed(error) {
      server.removeListener('listening', ready);
      reject(error);
    }
    function ready() {
      server.removeListener('error', failed);
      const address = server.address();
      const displayHost = host === '::1' ? '[::1]' : host;
      const url = 'http://' + displayHost + ':' + address.port + '/';
      if (opts.open !== false) {
        try { (opts.openBrowser || openBrowser)(url); } catch (error) { /* the printed URL remains usable */ }
      }
      resolve({
        server,
        url,
        close: function close() {
          return new Promise(function closing(done, closeFailed) {
            server.close(function closed(error) { if (error) closeFailed(error); else done(); });
          });
        },
      });
    }
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, host);
  });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  MAX_BODY_BYTES,
  createUiServer,
  openBrowser,
  readJsonBody,
  startUiServer,
};
