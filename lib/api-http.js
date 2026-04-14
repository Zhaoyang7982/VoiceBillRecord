/**
 * Serverless 共用：CORS、JSON body、可选 Bearer 门禁。
 * 仅被 api/* 引用；勿在前端打包。
 */

/** 用于白名单比对：去尾斜杠、转小写、尽量用 URL 规范化 host */
function originMatchKey(origin) {
  if (!origin || typeof origin !== 'string') return '';
  const t = origin.trim().replace(/\/+$/, '');
  try {
    return new URL(t).origin.toLowerCase();
  } catch {
    return t.toLowerCase();
  }
}

/** 白名单项是否为「任意 github.io 子域」（个人项目常用，避免 Pages 路径与边界差异） */
function isGithubPagesWildcardEntry(entry) {
  const e = entry.trim().toLowerCase();
  return e === 'https://*.github.io' || e === '*.github.io' || e === 'http://*.github.io';
}

function githubIoRequestHost(requestOrigin) {
  if (!requestOrigin) return '';
  try {
    return new URL(requestOrigin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function originAllowedByList(list, requestOrigin) {
  if (!requestOrigin) return false;
  const reqKey = originMatchKey(requestOrigin);
  const host = githubIoRequestHost(requestOrigin);
  const ghOk = host === 'github.io' || host.endsWith('.github.io');
  for (const item of list) {
    if (!item) continue;
    if (isGithubPagesWildcardEntry(item)) {
      if (ghOk) return true;
      continue;
    }
    if (originMatchKey(item) === reqKey) return true;
  }
  return false;
}

export function getCorsHeaders(req) {
  const requestOrigin = req.headers.origin;
  const raw = process.env.CORS_ORIGIN || '';
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    Vary: 'Origin',
  };

  let allowOrigin = '*';
  if (list.length > 0) {
    const allowed = originAllowedByList(list, requestOrigin);
    if (allowed) {
      allowOrigin = requestOrigin;
    } else if (!requestOrigin) {
      allowOrigin = list[0];
    } else {
      allowOrigin = null;
    }
  } else if (requestOrigin) {
    allowOrigin = requestOrigin;
  }

  if (allowOrigin != null) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }
  return headers;
}

export function mergeHeaders(base, extra) {
  return { ...base, ...extra };
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function checkGate(req) {
  const token = process.env.API_GATE_TOKEN;
  if (!token) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${token}`;
}

export function sendJson(res, status, headers, body) {
  res.writeHead(status, mergeHeaders(headers, { 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(body));
}
