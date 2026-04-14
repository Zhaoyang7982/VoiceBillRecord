import { neon } from '@neondatabase/serverless';
import { checkGate, getCorsHeaders, readJsonBody, sendJson } from '../lib/api-http.js';

const CATEGORIES = new Set(['餐饮', '交通', '购物', '娱乐', '医疗', '住房', '通讯', '其他']);

function getSearchParams(req) {
  const host = req.headers.host || 'localhost';
  const u = new URL(req.url || '/', `http://${host}`);
  return u.searchParams;
}

function toDateStart(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export default async function handler(req, res) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (!checkGate(req)) {
    sendJson(res, 401, cors, { error: 'unauthorized' });
    return;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    sendJson(res, 503, cors, { error: 'database_not_configured', message: '服务端未配置 DATABASE_URL' });
    return;
  }

  const sql = neon(dbUrl);

  if (req.method === 'GET') {
    const sp = getSearchParams(req);
    const from = toDateStart(sp.get('from'));
    const to = toDateStart(sp.get('to'));
    try {
      let rows;
      if (from && to) {
        rows = await sql`
          SELECT id, amount::float8 AS amount, shop, category,
                 occurred_at AS occurred_at,
                 created_at AS created_at,
                 note
          FROM expenses
          WHERE occurred_at::date >= ${from}::date
            AND occurred_at::date <= ${to}::date
          ORDER BY occurred_at DESC, created_at DESC
        `;
      } else {
        rows = await sql`
          SELECT id, amount::float8 AS amount, shop, category,
                 occurred_at AS occurred_at,
                 created_at AS created_at,
                 note
          FROM expenses
          ORDER BY occurred_at DESC, created_at DESC
          LIMIT 500
        `;
      }
      sendJson(res, 200, cors, { ok: true, items: rows });
    } catch (e) {
      sendJson(res, 500, cors, {
        error: 'query_failed',
        message: e instanceof Error ? e.message : '查询失败',
      });
    }
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, cors, { error: 'invalid_json' });
      return;
    }

    const amount = body.amount;
    if (amount === null || amount === undefined) {
      sendJson(res, 400, cors, { error: 'amount_required', message: '缺少有效金额，无法保存' });
      return;
    }
    const num = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(num) || num < 0) {
      sendJson(res, 400, cors, { error: 'amount_invalid', message: '金额无效' });
      return;
    }

    const category = typeof body.category === 'string' ? body.category : '';
    if (!CATEGORIES.has(category)) {
      sendJson(res, 400, cors, { error: 'category_invalid', message: '分类不在允许列表内' });
      return;
    }

    const shop = typeof body.shop === 'string' ? body.shop : '';
    const note = typeof body.note === 'string' ? body.note : '';
    const time = typeof body.time === 'string' ? body.time : null;
    const occurredRaw =
      typeof body.occurred_at === 'string' && body.occurred_at ? body.occurred_at : null;

    let occurredAt;
    if (occurredRaw) {
      occurredAt = occurredRaw;
    } else if (time && /^\d{4}-\d{2}-\d{2}$/.test(time)) {
      occurredAt = `${time}T12:00:00.000Z`;
    } else {
      sendJson(res, 400, cors, { error: 'time_invalid', message: '需要有效的 time (YYYY-MM-DD) 或 occurred_at' });
      return;
    }

    try {
      const inserted = await sql`
        INSERT INTO expenses (amount, shop, category, occurred_at, note)
        VALUES (${num}, ${shop || null}, ${category}, ${occurredAt}::timestamptz, ${note || null})
        RETURNING id, amount::float8 AS amount, shop, category,
                  occurred_at AS occurred_at,
                  created_at AS created_at,
                  note
      `;
      sendJson(res, 201, cors, { ok: true, item: inserted[0] });
    } catch (e) {
      sendJson(res, 500, cors, {
        error: 'insert_failed',
        message: e instanceof Error ? e.message : '写入失败',
      });
    }
    return;
  }

  sendJson(res, 405, cors, { error: 'method_not_allowed' });
}
