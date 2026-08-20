'use strict';

const https = require('https');

const { parseSkillsShUrl } = require('./update');

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_TIMEOUT_MS = 10000;
const MAX_SEARCH_RESPONSE_BYTES = 512 * 1024;
const SEARCH_ORIGIN = 'https://skills.sh';

function requestSkillsShJson(target, options) {
  const opts = options || {};
  const selected = new URL(target);
  if (selected.origin !== SEARCH_ORIGIN || selected.username || selected.password || selected.port ||
      selected.pathname !== '/api/search' || selected.hash) {
    return Promise.reject(new Error('skills.sh search target is not allowed'));
  }
  return new Promise(function request(resolve, reject) {
    let settled = false;
    let timer = null;
    let operation = null;
    function fail(error) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (operation && typeof operation.destroy === 'function') operation.destroy();
      reject(error);
    }
    function succeed(payload) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    }
    operation = (opts.get || https.get)(selected, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'awesome-skills-hub/2.0',
      },
    }, function response(incoming) {
      const chunks = [];
      let bytes = 0;
      incoming.on('data', function data(chunk) {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > (opts.maxBytes || MAX_SEARCH_RESPONSE_BYTES)) {
          fail(new Error('skills.sh search response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on('end', function end() {
        if (settled) return;
        if (incoming.statusCode !== 200) {
          fail(new Error('skills.sh search returned HTTP ' + incoming.statusCode));
          return;
        }
        const contentType = String(incoming.headers && incoming.headers['content-type'] || '');
        if (contentType && contentType.toLowerCase().indexOf('application/json') === -1) {
          fail(new Error('skills.sh search returned a non-JSON response'));
          return;
        }
        try { succeed(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) {
          fail(new Error('skills.sh search returned invalid JSON'));
        }
      });
      incoming.on('error', function responseError(error) {
        fail(error);
      });
    });
    operation.setTimeout(opts.timeoutMs || DEFAULT_SEARCH_TIMEOUT_MS, function timeout() {
      fail(new Error('skills.sh search timed out'));
    });
    operation.on('error', function requestError(error) {
      fail(error);
    });
    timer = setTimeout(function absoluteTimeout() {
      fail(new Error('skills.sh search timed out'));
    }, opts.timeoutMs || DEFAULT_SEARCH_TIMEOUT_MS);
  });
}

function searchLimit(value) {
  const selected = value === undefined ? DEFAULT_SEARCH_LIMIT : Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > 50) throw new Error('skills.sh search limit must be an integer between 1 and 50');
  return selected;
}

function searchQuery(value) {
  const selected = String(value || '').trim();
  if (selected.length < 2 || selected.length > 100 || /[\0\r\n]/.test(selected)) {
    throw new Error('skills.sh search query must contain 2-100 safe characters');
  }
  return selected;
}

function normalizeCandidate(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '');
  if (id.length < 5 || id.length > 300 || /[\0\r\n]/.test(id)) return null;
  const parts = id.split('/');
  if (parts.length !== 3) return null;
  let parsed;
  try { parsed = parseSkillsShUrl(SEARCH_ORIGIN + '/' + id); } catch (error) { return null; }
  const source = String(value.source || parsed.source);
  const slug = String(value.skillId || value.slug || parsed.slug);
  if (source !== parsed.source || slug !== parsed.slug) return null;
  const installs = Number.isSafeInteger(value.installs) && value.installs >= 0 ? value.installs : 0;
  return {
    id: parsed.source_id,
    name: parsed.slug,
    slug,
    source,
    installs,
    skills_url: parsed.skills_url,
    source_url: parsed.source_url,
  };
}

function createSkillsShSearchClient(options) {
  const opts = options || {};
  const requestJson = opts.requestJson || requestSkillsShJson;
  return {
    search: async function search(query, searchOptions) {
      const selected = searchQuery(query);
      const limit = searchLimit(searchOptions && searchOptions.limit);
      const url = SEARCH_ORIGIN + '/api/search?q=' + encodeURIComponent(selected) + '&limit=' + limit;
      const payload = await requestJson(url, opts);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.skills)) {
        throw new Error('skills.sh search response has an invalid shape');
      }
      const seen = new Set();
      const candidates = payload.skills.map(normalizeCandidate).filter(function valid(candidate) {
        const key = candidate && candidate.id.toLowerCase();
        if (!candidate || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, limit);
      return {
        provider: 'skills.sh',
        contract: 'undocumented-api-search',
        experimental: true,
        query: selected,
        search_type: payload && payload.searchType ? String(payload.searchType) : null,
        candidates,
      };
    },
  };
}

module.exports = {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_SEARCH_RESPONSE_BYTES,
  SEARCH_ORIGIN,
  createSkillsShSearchClient,
  normalizeCandidate,
  requestSkillsShJson,
  searchLimit,
  searchQuery,
};
