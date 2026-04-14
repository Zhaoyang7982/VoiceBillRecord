import { checkGate, getCorsHeaders, mergeHeaders, readJsonBody, sendJson } from '../lib/api-http.js';
import { consumeOpenAiChatSse } from '../lib/openai-sse-stream.js';

/** 与 Prompt、POST /api/expenses 校验一致（含「通讯」） */
const ALLOWED_CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '医疗', '住房', '通讯', '其他'];

function todayInShanghai() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function yesterdayInShanghai() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function deepSeekChatCompletionsUrl() {
  const raw = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(raw)) return raw;
  return `${raw}/chat/completions`;
}

function buildPrompt(userText) {
  return `请从用户的记账语音文本中提取以下字段，仅返回单JSON对象，不要任何其他文字：
- amount: 数字金额（没有则为null）
- shop: 商户/店铺名称
- category: 只能是：餐饮、交通、购物、娱乐、医疗、住房、通讯、其他
- time: 时间（今天/昨天/具体时间）
- note: 原始简短描述

用户记账语音文本：
${userText}`;
}

function extractJsonObject(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型未返回可解析的 JSON 对象');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeTime(rawTime) {
  if (rawTime === null || rawTime === undefined) return todayInShanghai();
  const s = typeof rawTime === 'string' ? rawTime.trim() : String(rawTime);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const isoDay = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay) return isoDay[1];
  if (s.includes('今天')) return todayInShanghai();
  if (s.includes('昨天')) return yesterdayInShanghai();
  return todayInShanghai();
}

function normalizeParsed(raw) {
  const category = ALLOWED_CATEGORIES.includes(raw.category) ? raw.category : '其他';
  let amount = raw.amount;
  if (amount !== null && amount !== undefined && typeof amount !== 'number') {
    const n = Number(amount);
    amount = Number.isFinite(n) ? n : null;
  }
  return {
    amount: amount === null || amount === undefined ? null : amount,
    shop: typeof raw.shop === 'string' ? raw.shop : '',
    category,
    time: normalizeTime(raw.time),
    note: typeof raw.note === 'string' ? raw.note : '',
  };
}

function writeNdjsonLine(res, obj) {
  res.write(`${JSON.stringify(obj)}\n`);
}

/**
 * 流式：DeepSeek SSE → 本接口以 NDJSON 增量下发 {type:'delta',c}，最后 {type:'done',parsed}
 */
async function handleStreamParse(res, cors, llmRes) {
  const streamHeaders = mergeHeaders(cors, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.writeHead(200, streamHeaders);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let flushed = 0;
  const flushChunk = () => {
    flushed += 1;
    if (flushed % 8 === 0 && typeof res.flush === 'function') res.flush();
  };

  try {
    const reader = llmRes.body.getReader();
    const full = await consumeOpenAiChatSse(reader, (piece) => {
      writeNdjsonLine(res, { type: 'delta', c: piece });
      flushChunk();
    });

    let parsed;
    try {
      parsed = extractJsonObject(full);
    } catch (e) {
      writeNdjsonLine(res, {
        type: 'error',
        error: 'parse_json_failed',
        message: e instanceof Error ? e.message : '无法解析模型输出为 JSON',
      });
      res.end();
      return;
    }

    writeNdjsonLine(res, { type: 'done', ok: true, parsed: normalizeParsed(parsed) });
    res.end();
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    try {
      writeNdjsonLine(res, {
        type: 'error',
        error: aborted ? 'deepseek_timeout' : 'stream_failed',
        message: aborted ? '解析超时' : e instanceof Error ? e.message : '流式读取失败',
      });
    } catch {
      /* 客户端已断开 */
    }
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
}

export default async function handler(req, res) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, cors, { error: 'method_not_allowed' });
    return;
  }
  if (!checkGate(req)) {
    sendJson(res, 401, cors, { error: 'unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, cors, { error: 'invalid_json' });
    return;
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    sendJson(res, 400, cors, { error: 'missing_text' });
    return;
  }

  /** 仅当 `stream: true` 时走 NDJSON 流式；否则返回整段 JSON（兼容 curl / 旧前端） */
  const wantStream = body.stream === true;

  const key = process.env.DEEPSEEK_API_KEY;
  const model = (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  if (!key) {
    sendJson(res, 503, cors, {
      error: 'deepseek_not_configured',
      message: '服务端未配置 DEEPSEEK_API_KEY',
    });
    return;
  }

  const prompt = buildPrompt(text);
  const url = deepSeekChatCompletionsUrl();
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 60_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let llmRes;
  try {
    llmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        max_tokens: 160,
        stream: wantStream,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const aborted = e && e.name === 'AbortError';
    sendJson(res, aborted ? 504 : 502, cors, {
      error: aborted ? 'deepseek_timeout' : 'deepseek_network_error',
      message: aborted ? '解析超时，请稍后重试' : '无法连接 DeepSeek 服务',
    });
    return;
  }

  if (!llmRes.ok) {
    clearTimeout(timeout);
    const data = await llmRes.json().catch(() => ({}));
    sendJson(res, 502, cors, {
      error: 'deepseek_upstream_error',
      message: data.error?.message || `DeepSeek 接口返回 ${llmRes.status}`,
    });
    return;
  }

  if (wantStream) {
    if (!llmRes.body) {
      clearTimeout(timeout);
      sendJson(res, 502, cors, { error: 'no_response_body', message: '上游未返回可读的流式正文' });
      return;
    }
    try {
      await handleStreamParse(res, cors, llmRes);
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  clearTimeout(timeout);

  const data = await llmRes.json().catch(() => ({}));
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    sendJson(res, 502, cors, { error: 'deepseek_empty_content', message: '模型未返回内容' });
    return;
  }

  let parsed;
  try {
    parsed = extractJsonObject(content);
  } catch (e) {
    sendJson(res, 422, cors, {
      error: 'parse_json_failed',
      message: e instanceof Error ? e.message : '无法解析模型输出为 JSON',
      raw: content.slice(0, 500),
    });
    return;
  }

  sendJson(res, 200, cors, { ok: true, parsed: normalizeParsed(parsed) });
}
