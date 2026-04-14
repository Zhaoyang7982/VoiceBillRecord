(function () {
  /** 默认 API 根；可在 index.html 里先于本脚本设置 window.__VBR_API_BASE_ORIGIN__ 覆盖（勿写密钥） */
  const DEFAULT_API_BASE_ORIGIN = 'https://voice-bill-record.vercel.app';

  function resolveApiBaseOrigin() {
    try {
      const w = typeof window !== 'undefined' ? window.__VBR_API_BASE_ORIGIN__ : '';
      if (typeof w === 'string' && w.trim()) {
        const u = new URL(w.trim());
        if (u.protocol === 'https:' || u.hostname === 'localhost') {
          return `${u.protocol}//${u.host}`;
        }
      }
    } catch (_) {
      /* 非法覆盖则忽略 */
    }
    return DEFAULT_API_BASE_ORIGIN.replace(/\/+$/, '');
  }

  const API_BASE_ORIGIN = resolveApiBaseOrigin();

  const $ = (id) => document.getElementById(id);

  function getApiBase() {
    return API_BASE_ORIGIN.replace(/\/+$/, '');
  }

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${getApiBase()}${p}`;
  }

  function friendlyFetchError(e, status) {
    const raw = (e && e.message) || '';
    if (status === 401) {
      return '未授权（401）：请在 Vercel 关闭 API_GATE_TOKEN，或为客户端恢复门令配置方式。';
    }
    if (
      /^load failed$/i.test(raw) ||
      /^failed to fetch$/i.test(raw) ||
      /networkerror|network request failed|load failed/i.test(raw)
    ) {
      const base = getApiBase();
      const origin =
        typeof location !== 'undefined' && location.origin ? location.origin : '你的 Pages 源';
      return [
        '连不上记账接口（浏览器在收到响应前就失败了）。',
        `1）先试：换流量 / VPN，或新标签打开 ${base}/api/expenses 能否打开。`,
        '2）仍不行：多为内地访问 *.vercel.app 不稳定；可在 Vercel 绑自定义域名，再在 index.html 里设置 window.__VBR_API_BASE_ORIGIN__ 指向该域名。',
        `3）仅当开发者工具 Network 里出现 (blocked:cors) 时，才要改 Vercel 的 CORS_ORIGIN（须含 ${origin}）并 Redeploy。`,
      ].join('\n');
    }
    return raw || '请求失败';
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json' };
  }

  const views = {
    home: $('view-home'),
    list: $('view-list'),
    stats: $('view-stats'),
    year: $('view-year'),
  };

  let lastParsed = null;
  let chart = null;
  /** 语音识别尚未标为 final 的临时文本，松手时写入文本框，避免点解析时仍为空 */
  let speechInterimBuffer = '';

  function localYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function firstDayOfMonth(d) {
    return localYMD(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function lastDayOfMonth(d) {
    return localYMD(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  /**
   * 解析：默认流式（NDJSON），增量写入 #parse-stream；服务端显式 stream:false 时回退整段 JSON。
   */
  async function parseBillWithStream(text) {
    const streamEl = $('parse-stream');
    let res;
    try {
      res = await fetch(apiUrl('/api/parse'), {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: authHeaders(),
        body: JSON.stringify({ text, stream: true }),
      });
    } catch (e) {
      throw new Error(friendlyFetchError(e));
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      const raw = await res.text();
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = {};
      }
      const err = new Error((data && data.message) || (data && data.error) || `请求失败 ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (ct.includes('ndjson') && res.body) {
      streamEl.hidden = false;
      streamEl.textContent = '';
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let acc = '';
      let doneParsed = null;
      let sawDelta = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.type === 'delta' && obj.c) {
            acc += obj.c;
            streamEl.textContent = acc;
            streamEl.scrollTop = streamEl.scrollHeight;
            if (!sawDelta) {
              sawDelta = true;
              const ps = $('parse-status');
              if (ps) ps.textContent = '模型输出中…';
            }
          }
          if (obj.type === 'done' && obj.parsed) {
            doneParsed = obj.parsed;
          }
          if (obj.type === 'error') {
            throw new Error(obj.message || obj.error || '解析失败');
          }
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim());
          if (obj.type === 'done' && obj.parsed) doneParsed = obj.parsed;
          if (obj.type === 'error') throw new Error(obj.message || obj.error || '解析失败');
        } catch (e) {
          if (e instanceof SyntaxError) {
            /* 末行可能不完整，忽略 */
          } else {
            throw e;
          }
        }
      }
      streamEl.hidden = true;
      if (!doneParsed) {
        throw new Error('流式解析未返回有效结果');
      }
      return doneParsed;
    }
    const data = await res.json();
    if (!data || typeof data.parsed !== 'object') {
      throw new Error((data && data.message) || '解析接口返回数据异常');
    }
    return data.parsed;
  }

  async function apiFetch(path, opts) {
    let res;
    try {
      res = await fetch(apiUrl(path), {
        mode: 'cors',
        credentials: 'omit',
        ...opts,
        headers: { ...authHeaders(), ...(opts && opts.headers ? opts.headers : {}) },
      });
    } catch (e) {
      const err = new Error(friendlyFetchError(e));
      err.cause = e;
      throw err;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: 'invalid_response', raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      let msg = data && data.message ? data.message : `请求失败 ${res.status}`;
      if (res.status === 404) {
        msg = '接口返回 404：请确认 Vercel 项目已部署且路径为 /api/parse、/api/expenses。';
      }
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  function showNav(name) {
    document.querySelectorAll('.sidebar [data-nav]').forEach((btn) => {
      btn.setAttribute('aria-current', btn.dataset.nav === name ? 'true' : 'false');
    });
    document.body.classList.toggle('show-fab', name === 'home');
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.hidden = k !== name;
    });
  }

  document.querySelectorAll('.sidebar [data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.nav;
      showNav(name);
      if (name === 'list') loadList();
      if (name === 'stats') loadStats();
      if (name === 'year') loadYear();
    });
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechMsg = $('speech-support-msg');
  const micHold = $('mic-hold');
  const fabShell = $('fab-shell');
  const recState = $('rec-state');
  const transcript = $('transcript');
  const btnParse = $('btn-parse');
  const btnSave = $('btn-save');
  const parseStatus = $('parse-status');
  const parseError = $('parse-error');
  const parseCards = $('parse-cards');

  let recognition = null;
  /** 用户是否已点麦克风开始识别（与 recognition 是否在跑略不同步，以点击为准） */
  let micListening = false;

  function setRecUi(active) {
    micHold.classList.toggle('recording', active);
    micHold.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (fabShell) fabShell.classList.toggle('is-active', active);
    recState.textContent = active ? '识别中…' : '未录音';
    recState.className = 'badge' + (active ? ' warn' : '');
  }

  function appendTranscript(text) {
    const t = transcript.value.trim();
    transcript.value = t ? `${t} ${text}` : text;
  }

  if (!SR) {
    speechMsg.textContent = '当前浏览器不支持 Web Speech API（可尝试桌面 Chrome / Edge）。';
  } else {
    speechMsg.textContent =
      '使用浏览器语音识别（需麦克风权限）：点底部粉色麦克风开始，再点一次结束；识别中会有声波纹动画。';
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        const piece = r[0].transcript;
        if (r.isFinal) finalText += piece;
        else interim += piece;
      }
      if (interim) {
        speechInterimBuffer = interim;
        parseStatus.textContent = `识别中：${interim}`;
      }
      if (finalText) {
        appendTranscript(finalText.trim());
        speechInterimBuffer = '';
        parseStatus.textContent = '已写入一条最终识别结果。';
      }
    };

    recognition.onerror = (e) => {
      micListening = false;
      setRecUi(false);
      parseError.hidden = false;
      const code = e && e.error ? String(e.error) : 'unknown';
      if (code === 'network') {
        parseError.textContent =
          '语音识别「网络」错误：多为浏览器连不上语音服务（移动网络/地区限制较常见）。可换 Wi‑Fi、开 VPN 或换桌面 Chrome；也可直接在上方输入文字后点「开始解析」。';
      } else {
        parseError.textContent = `语音识别错误：${code}`;
      }
    };

    recognition.onend = () => {
      if (speechInterimBuffer.trim()) {
        appendTranscript(speechInterimBuffer.trim());
        speechInterimBuffer = '';
        parseStatus.textContent = '已把最后一次识别内容写入文本框（可点「开始解析」）。';
      }
      micListening = false;
      setRecUi(false);
    };

    micHold.disabled = false;
    btnParse.disabled = false;

    micHold.addEventListener('click', () => {
      if (micListening) {
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
        micListening = false;
        setRecUi(false);
        return;
      }
      parseError.hidden = true;
      try {
        recognition.start();
        micListening = true;
        setRecUi(true);
      } catch {
        micListening = false;
        setRecUi(false);
        parseStatus.textContent = '识别已在运行或启动失败，请稍后再点麦克风重试。';
      }
    });
  }

  function showParsed(p) {
    lastParsed = p;
    parseCards.innerHTML = '';
    parseCards.hidden = false;
    const card = document.createElement('div');
    card.className = 'card';
    const amt =
      p.amount !== null && p.amount !== undefined && Number.isFinite(Number(p.amount))
        ? money(Number(p.amount))
        : '—';
    card.innerHTML = `<h4>${escapeHtml(p.shop || '未命名')}</h4>
<p>金额：${escapeHtml(amt)}</p>
<p>分类：${escapeHtml(p.category || '')}</p>
<p class="muted">日期：${escapeHtml(p.time || '')}</p>
${p.note ? `<p class="muted">${escapeHtml(p.note)}</p>` : ''}`;
    parseCards.appendChild(card);
    btnSave.disabled = !(p && p.amount !== null && p.amount !== undefined);
  }

  $('btn-parse').addEventListener('click', async () => {
    let text = transcript.value.trim();
    if (!text && speechInterimBuffer.trim()) {
      text = speechInterimBuffer.trim();
      appendTranscript(text);
      speechInterimBuffer = '';
    }
    parseError.hidden = true;
    parseCards.innerHTML = '';
    parseCards.hidden = true;
    lastParsed = null;
    btnSave.disabled = true;
    if (!text) {
      parseError.hidden = false;
      parseError.textContent = '请先在上方输入文字，或点底部麦克风识别后再点「开始解析」。';
      return;
    }
    btnParse.disabled = true;
    btnParse.classList.add('is-loading');
    parseStatus.textContent = '正在连接模型…';
    try {
      const parsed = await parseBillWithStream(text);
      showParsed(parsed);
      parseStatus.textContent = '解析完成。';
      if (parsed.amount === null || parsed.amount === undefined) {
        parseError.hidden = false;
        parseError.textContent = '未识别到金额：请补充口述或手动改文案后再解析；无法保存无金额账单。';
      }
    } catch (e) {
      parseError.hidden = false;
      parseError.textContent = friendlyFetchError(e, e.status) || e.message || '解析失败';
      parseStatus.textContent = '';
    } finally {
      btnParse.classList.remove('is-loading');
      btnParse.disabled = false;
      $('parse-stream').hidden = true;
    }
  });

  $('btn-save').addEventListener('click', async () => {
    if (!lastParsed) return;
    parseError.hidden = true;
    parseStatus.textContent = '保存中…';
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          amount: lastParsed.amount,
          shop: lastParsed.shop,
          category: lastParsed.category,
          time: lastParsed.time,
          note: lastParsed.note,
        }),
      });
      parseStatus.textContent = '已保存。';
      await loadHome();
    } catch (e) {
      parseError.hidden = false;
      parseError.textContent = friendlyFetchError(e, e.status) || e.message || '保存失败';
      parseStatus.textContent = '';
    }
  });

  function money(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return `¥${x.toFixed(2)}`;
  }

  async function loadHome() {
    const today = localYMD(new Date());
    const listEl = $('recent-list');
    const totalEl = $('today-total');
    listEl.innerHTML = '';
    totalEl.textContent = '…';
    try {
      const data = await apiFetch(`/api/expenses?from=${encodeURIComponent(today)}&to=${encodeURIComponent(today)}`);
      const items = data.items || [];
      const sum = items.reduce((s, it) => s + Number(it.amount), 0);
      totalEl.textContent = money(sum);
      items.slice(0, 8).forEach((it) => {
        const row = document.createElement('div');
        row.className = 'bill-card';
        const left = document.createElement('div');
        left.className = 'bill-left';
        left.innerHTML = `<div class="name">${escapeHtml(it.shop || it.note || '账单')}</div><div class="cate">${escapeHtml(
          it.category || '',
        )}</div>`;
        const right = document.createElement('div');
        right.className = 'bill-right';
        right.textContent = money(it.amount);
        row.appendChild(left);
        row.appendChild(right);
        listEl.appendChild(row);
      });
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'list-empty';
        empty.textContent = '还没有今天的账单，去记一笔吧～';
        listEl.appendChild(empty);
      }
    } catch (e) {
      totalEl.textContent = '—';
      const err = document.createElement('div');
      err.className = 'error';
      err.style.textAlign = 'start';
      err.textContent = friendlyFetchError(e, e.status) || e.message || '加载失败';
      listEl.appendChild(err);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function ymdFromIso(iso) {
    const d = new Date(iso);
    return localYMD(d);
  }

  async function loadList() {
    const mount = $('list-mount');
    mount.textContent = '加载中…';
    const end = localYMD(new Date());
    const start = localYMD(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
    try {
      const data = await apiFetch(`/api/expenses?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`);
      const items = data.items || [];
      const groups = new Map();
      items.forEach((it) => {
        const day = ymdFromIso(it.occurred_at);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(it);
      });
      mount.innerHTML = '';
      const days = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      if (!days.length) {
        mount.innerHTML = '<p class="list-empty">还没有账单，去首页记一笔吧～</p>';
        return;
      }
      days.forEach((day) => {
        const dayItems = groups.get(day);
        const daySum = dayItems.reduce((s, it) => s + Number(it.amount), 0);
        const head = document.createElement('div');
        head.className = 'date-group';
        head.textContent = `📅 ${day}`;
        mount.appendChild(head);
        const summary = document.createElement('div');
        summary.className = 'day-summary';
        summary.innerHTML = `<span>当日总支出</span><span class="cost">${money(daySum)}</span>`;
        mount.appendChild(summary);
        const cards = document.createElement('div');
        cards.className = 'bill-cards';
        dayItems.forEach((it) => {
          const row = document.createElement('div');
          row.className = 'bill-card';
          const left = document.createElement('div');
          left.className = 'bill-left';
          left.innerHTML = `<div class="name">${escapeHtml(it.shop || it.note || '账单')}</div><div class="cate">${escapeHtml(
            it.category || '',
          )}</div>`;
          const right = document.createElement('div');
          right.className = 'bill-right';
          right.textContent = money(it.amount);
          row.appendChild(left);
          row.appendChild(right);
          cards.appendChild(row);
        });
        mount.appendChild(cards);
      });
    } catch (e) {
      mount.innerHTML = `<p class="error">${escapeHtml(friendlyFetchError(e, e.status) || e.message)}</p>`;
    }
  }

  const palette = ['#ff8fab', '#ff6b9e', '#ff497c', '#ffadce', '#ffb7d5', '#ffa0c3', '#ff7eb3', '#e8a0c4'];

  async function loadStats() {
    const now = new Date();
    const from = firstDayOfMonth(now);
    const to = lastDayOfMonth(now);
    $('stats-range').textContent = `${from} ~ ${to}`;
    const legend = $('stats-legend');
    const monthTotalEl = $('stats-month-total');
    legend.innerHTML = '';
    monthTotalEl.textContent = '…';
    try {
      const data = await apiFetch(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const items = data.items || [];
      const sums = new Map();
      items.forEach((it) => {
        const c = it.category || '其他';
        sums.set(c, (sums.get(c) || 0) + Number(it.amount));
      });
      const labels = Array.from(sums.keys());
      const values = labels.map((k) => sums.get(k));
      const total = values.reduce((a, b) => a + b, 0);
      monthTotalEl.textContent = money(total);

      labels.forEach((lab) => {
        const li = document.createElement('li');
        li.className = 'cat-item';
        const amt = sums.get(lab);
        const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : '0.0';
        li.innerHTML = `<div class="cat-name">${escapeHtml(lab)}</div><div class="cat-amount">${escapeHtml(
          money(amt),
        )} · ${pct}%</div>`;
        legend.appendChild(li);
      });

      const ctx = $('stats-chart').getContext('2d');
      if (chart) chart.destroy();
      if (!window.Chart) {
        legend.innerHTML = '<li class="cat-item error">Chart.js 未能加载</li>';
        return;
      }
      chart = new window.Chart(ctx, {
        type: 'pie',
        data: {
          labels,
          datasets: [
            {
              data: values,
              backgroundColor: labels.map((_, i) => palette[i % palette.length]),
              borderWidth: 2,
              borderColor: '#ffffff',
            },
          ],
        },
        options: {
          plugins: {
            legend: { display: false },
          },
        },
      });
      if (!labels.length) {
        monthTotalEl.textContent = money(0);
        legend.innerHTML = '<li class="cat-item muted" style="justify-content:center">本月还没有账单</li>';
      }
    } catch (e) {
      monthTotalEl.textContent = '—';
      legend.innerHTML = `<li class="cat-item error">${escapeHtml(friendlyFetchError(e, e.status) || e.message)}</li>`;
    }
  }

  async function loadYear() {
    const now = new Date();
    const y = now.getFullYear();
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    const labelEl = $('year-label');
    const totalEl = $('year-total');
    const trendEl = $('year-trend');
    const mount = $('year-months');
    labelEl.textContent = String(y);
    totalEl.textContent = '…';
    trendEl.textContent = '加载中…';
    mount.innerHTML = '';
    try {
      const data = await apiFetch(`/api/expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const items = data.items || [];
      const monthly = new Map();
      items.forEach((it) => {
        const d = new Date(it.occurred_at);
        if (Number.isNaN(d.getTime())) return;
        if (d.getFullYear() !== y) return;
        const m = d.getMonth() + 1;
        monthly.set(m, (monthly.get(m) || 0) + Number(it.amount));
      });
      const yearSum = items.reduce((s, it) => s + Number(it.amount), 0);
      totalEl.textContent = money(yearSum);

      const curM = now.getMonth() + 1;
      const curVal = monthly.get(curM) || 0;
      const prevVal = curM > 1 ? monthly.get(curM - 1) || 0 : 0;
      if (prevVal > 0) {
        const chg = (((curVal - prevVal) / prevVal) * 100).toFixed(0);
        if (Number(chg) <= 0) {
          trendEl.textContent = `本月较上月支出减少 ${Math.abs(Number(chg))}% ✨ 继续保持！`;
        } else {
          trendEl.textContent = `本月较上月支出上升 ${chg}% ，注意理性消费～`;
        }
      } else if (curVal > 0) {
        trendEl.textContent = '本月已有记录，坚持记账更容易省钱 ✨';
      } else {
        trendEl.textContent = '多记账，更容易发现省钱空间 ✨';
      }

      const monthNames = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
      for (let m = 1; m <= 12; m += 1) {
        const row = document.createElement('div');
        row.className = 'month-item';
        const isFuture = y === now.getFullYear() && m > curM;
        if (isFuture) row.classList.add('future');
        const name = document.createElement('div');
        name.className = 'month-name';
        name.textContent = monthNames[m - 1];
        const amt = document.createElement('div');
        amt.className = 'month-amount';
        if (isFuture) {
          amt.textContent = '—';
        } else {
          amt.textContent = money(monthly.get(m) || 0);
        }
        row.appendChild(name);
        row.appendChild(amt);
        mount.appendChild(row);
      }
    } catch (e) {
      totalEl.textContent = '—';
      trendEl.textContent = friendlyFetchError(e, e.status) || e.message || '加载失败';
    }
  }

  $('refresh-home').addEventListener('click', loadHome);
  $('refresh-list').addEventListener('click', loadList);
  $('refresh-stats').addEventListener('click', loadStats);
  $('refresh-year').addEventListener('click', loadYear);

  loadHome();
})();
