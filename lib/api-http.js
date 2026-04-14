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

export function getCorsHeaders(req) {
  const requestOrigin = req.headers.origin;
  const raw = process.env.CORS_ORIGIN || '';
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };

  let allowOrigin = '*';
  if (list.length > 0) {
    const reqKey = originMatchKey(requestOrigin);
    const allowed = requestOrigin && list.some((item) => originMatchKey(item) === reqKey);
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
