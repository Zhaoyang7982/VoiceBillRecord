(function () {
  const GATE_KEY = 'vbr_gate_token';
  const API_BASE_STORAGE_KEY = 'vbr_api_base';

  const $ = (id) => document.getElementById(id);

  /**
   * API 根地址（无密钥）：localStorage 优先，其次 index.html 内 window.VBR_API_BASE_URL，留空则同域。
   * 只使用 URL 的 origin，忽略路径，避免误配成带 secret 的完整 URL。
   */
  function getApiBase() {
    const fromLs = localStorage.getItem(API_BASE_STORAGE_KEY);
    const raw =
      (fromLs && fromLs.trim()) ||
      (typeof window !== 'undefined' && window.VBR_API_BASE_URL && String(window.VBR_API_BASE_URL).trim()) ||
      '';
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      if (raw.toLowerCase().includes('postgresql:') || raw.includes('@')) return '';
      return u.origin;
    } catch {
      return '';
    }
  }

  function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    const base = getApiBase();
    return base ? `${base}${p}` : p;
  }

  const views = {
    home: $('view-home'),
    list: $('view-list'),
    stats: $('view-stats'),
  };

  let lastParsed = null;
  let chart = null;

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

  function authHeaders() {
    const token = localStorage.getItem(GATE_KEY);
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function apiFetch(path, opts) {
    const res = await fetch(apiUrl(path), {
      ...opts,
      headers: { ...authHeaders(), ...(opts && opts.headers ? opts.headers : {}) },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: 'invalid_response', raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      const err = new Error(data && data.message ? data.message : `请求失败 ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  function showNav(name) {
    document.querySelectorAll('nav.tabs button').forEach((btn) => {
      btn.setAttribute('aria-current', btn.dataset.nav === name ? 'true' : 'false');
    });
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      el.hidden = k !== name;
    });
  }

  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.nav;
      showNav(name);
      if (name === 'list') loadList();
      if (name === 'stats') loadStats();
    });
  });

  function fillApiBaseInput() {
    const el = $('api-base-url');
    if (!el) return;
    el.value = localStorage.getItem(API_BASE_STORAGE_KEY) || getApiBase() || '';
  }

  $('save-api-base').addEventListener('click', () => {
    const raw = $('api-base-url').value.trim();
    if (!raw) {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
      $('parse-status').textContent = '已清除 API 根地址，将使用与当前页同域的 /api/*。';
      fillApiBaseInput();
      return;
    }
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https');
      if (raw.toLowerCase().includes('postgresql:') || raw.includes('@')) {
        throw new Error('请勿粘贴数据库连接串');
      }
      const origin = u.origin;
      localStorage.setItem(API_BASE_STORAGE_KEY, origin);
      $('api-base-url').value = origin;
      $('parse-status').textContent = `API 根地址已保存：${origin}`;
    } catch (e) {
      $('parse-status').textContent = e instanceof Error ? e.message : 'API 地址无效';
    }
  });
  $('clear-api-base').addEventListener('click', () => {
    localStorage.removeItem(API_BASE_STORAGE_KEY);
    fillApiBaseInput();
    $('parse-status').textContent = '已清除 API 根地址。';
  });
  fillApiBaseInput();

  $('save-gate').addEventListener('click', () => {
    const v = $('gate-token').value.trim();
    if (v) localStorage.setItem(GATE_KEY, v);
    else localStorage.removeItem(GATE_KEY);
    $('parse-status').textContent = '门令已保存到本机（若留空则清除）。';
  });
  $('clear-gate').addEventListener('click', () => {
    localStorage.removeItem(GATE_KEY);
    $('gate-token').value = '';
    $('parse-status').textContent = '已清除门令。';
  });
  $('gate-token').value = localStorage.getItem(GATE_KEY) || '';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechMsg = $('speech-support-msg');
  const micHold = $('mic-hold');
  const micToggle = $('mic-toggle');
  const recState = $('rec-state');
  const transcript = $('transcript');
  const btnParse = $('btn-parse');
  const btnSave = $('btn-save');
  const parseStatus = $('parse-status');
  const parseError = $('parse-error');
  const parsePreview = $('parse-preview');

  let recognition = null;
  let recModeToggle = false;
  let pointerHeld = false;

  function setRecUi(active) {
    micHold.classList.toggle('recording', active);
    recState.textContent = active ? '录音中…' : '未录音';
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
      '使用浏览器语音识别（Web Speech），需麦克风权限；按住主按钮说话，或点击「点击开始识别」切换。';
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

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
        parseStatus.textContent = `识别中：${interim}`;
      }
      if (finalText) {
        appendTranscript(finalText.trim());
        parseStatus.textContent = '已写入一条最终识别结果。';
      }
    };

    recognition.onerror = (e) => {
      parseError.hidden = false;
      parseError.textContent = `语音识别错误：${e.error}`;
      setRecUi(false);
    };

    recognition.onend = () => {
      if (pointerHeld || recModeToggle) {
        /* toggle mode: user stops explicitly */
      }
      setRecUi(false);
      if (recModeToggle) {
        recModeToggle = false;
        micToggle.textContent = '点击开始识别';
      }
    };

    function safeStart() {
      parseError.hidden = true;
      try {
        recognition.start();
        setRecUi(true);
      } catch {
        parseStatus.textContent = '识别已在运行；请先停止再试。';
      }
    }

    function safeStop() {
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      setRecUi(false);
    }

    micHold.disabled = false;
    micToggle.disabled = false;
    btnParse.disabled = false;

    micHold.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pointerHeld = true;
      safeStart();
    });
    micHold.addEventListener('pointerup', () => {
      if (!pointerHeld) return;
      pointerHeld = false;
      safeStop();
    });
    micHold.addEventListener('pointercancel', () => {
      pointerHeld = false;
      safeStop();
    });

    micToggle.addEventListener('click', () => {
      if (!recModeToggle) {
        recModeToggle = true;
        micToggle.textContent = '点击停止识别';
        safeStart();
      } else {
        recModeToggle = false;
        micToggle.textContent = '点击开始识别';
        safeStop();
      }
    });
  }

  function showParsed(p) {
    lastParsed = p;
    parsePreview.style.display = 'block';
    parsePreview.textContent = JSON.stringify(p, null, 2);
    btnSave.disabled = !(p && p.amount !== null && p.amount !== undefined);
  }

  $('btn-parse').addEventListener('click', async () => {
    const text = transcript.value.trim();
    parseError.hidden = true;
    parsePreview.style.display = 'none';
    lastParsed = null;
    btnSave.disabled = true;
    if (!text) {
      parseError.hidden = false;
      parseError.textContent = '请先说话或输入要解析的文字。';
      return;
    }
    parseStatus.textContent = '解析中…';
    try {
      const data = await apiFetch('/api/parse', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      showParsed(data.parsed);
      parseStatus.textContent = '解析完成。';
      if (data.parsed.amount === null || data.parsed.amount === undefined) {
        parseError.hidden = false;
        parseError.textContent = '未识别到金额：请补充口述或手动改文案后再解析；无法保存无金额账单。';
      }
    } catch (e) {
      parseError.hidden = false;
      parseError.textContent = e.message || '解析失败';
      parseStatus.textContent = '';
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
      parseError.textContent = e.message || '保存失败';
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
        const li = document.createElement('li');
        const left = document.createElement('div');
        left.innerHTML = `<strong>${money(it.amount)}</strong> · ${escapeHtml(it.category)}<div class="muted">${escapeHtml(
          it.shop || it.note || '',
        )}</div>`;
        const right = document.createElement('div');
        right.className = 'muted';
        right.style.whiteSpace = 'nowrap';
        right.textContent = formatTime(it.occurred_at);
        li.appendChild(left);
        li.appendChild(right);
        listEl.appendChild(li);
      });
      if (!items.length) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="muted">今日暂无记录</span>';
        listEl.appendChild(li);
      }
    } catch (e) {
      totalEl.textContent = '—';
      const li = document.createElement('li');
      li.className = 'error';
      li.textContent = e.message || '加载失败（请确认已用 vercel dev 或已部署 API）';
      listEl.appendChild(li);
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
        mount.innerHTML = '<p class="muted">暂无记录</p>';
        return;
      }
      days.forEach((day) => {
        const wrap = document.createElement('div');
        wrap.className = 'day-group';
        const h = document.createElement('h3');
        h.textContent = day;
        const ul = document.createElement('ul');
        ul.className = 'expense-list';
        groups.get(day).forEach((it) => {
          const li = document.createElement('li');
          const left = document.createElement('div');
          left.innerHTML = `<strong>${money(it.amount)}</strong> · ${escapeHtml(it.category)}<div class="muted">${escapeHtml(
            it.shop || '',
          )}</div>`;
          const right = document.createElement('div');
          right.className = 'muted';
          right.textContent = formatTime(it.occurred_at);
          li.appendChild(left);
          li.appendChild(right);
          ul.appendChild(li);
        });
        wrap.appendChild(h);
        wrap.appendChild(ul);
        mount.appendChild(wrap);
      });
    } catch (e) {
      mount.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    }
  }

  const palette = ['#3d9cf5', '#7fd99a', '#f5c15c', '#c79cff', '#f07178', '#5fd4d4', '#ffb86b', '#8b99a8'];

  async function loadStats() {
    const now = new Date();
    const from = firstDayOfMonth(now);
    const to = lastDayOfMonth(now);
    $('stats-range').textContent = `${from} ~ ${to}`;
    const legend = $('stats-legend');
    legend.innerHTML = '';
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

      labels.forEach((lab, i) => {
        const li = document.createElement('li');
        const amt = sums.get(lab);
        const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : '0.0';
        li.innerHTML = `<div><span class="badge ok">${escapeHtml(lab)}</span></div><div class="muted">${money(
          amt,
        )} · ${pct}%</div>`;
        legend.appendChild(li);
      });

      const ctx = $('stats-chart').getContext('2d');
      if (chart) chart.destroy();
      if (!window.Chart) {
        legend.innerHTML = '<li class="error">Chart.js 未能加载</li>';
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
              borderWidth: 1,
              borderColor: '#111820',
            },
          ],
        },
        options: {
          plugins: {
            legend: { labels: { color: '#e7ecf3' } },
          },
        },
      });
      if (!labels.length) {
        legend.innerHTML = '<li class="muted">本月暂无数据</li>';
      }
    } catch (e) {
      legend.innerHTML = `<li class="error">${escapeHtml(e.message)}</li>`;
    }
  }

  $('refresh-home').addEventListener('click', loadHome);
  $('refresh-list').addEventListener('click', loadList);
  $('refresh-stats').addEventListener('click', loadStats);

  loadHome();
})();
