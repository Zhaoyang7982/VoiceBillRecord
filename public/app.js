(function () {
  /** 固定 API 根（Vercel Production，无尾斜杠、无密钥；与 CORS 白名单中的 Pages 源配对） */
  const API_BASE_ORIGIN = 'https://voice-bill-record.vercel.app';

  const $ = (id) => document.getElementById(id);

  function getApiBase() {
    return API_BASE_ORIGIN.replace(/\/$/, '');
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
      const originHint =
        typeof location !== 'undefined' && location.origin
          ? ` CORS：在 Vercel 的 CORS_ORIGIN 中加入与 Network 里 Request Headers → Origin 一致的值（一般为 ${location.origin}），保存后务必 Redeploy；也可加一项 https://*.github.io。`
          : ' 请在 Vercel 的 CORS_ORIGIN 中加入当前页的 Origin。';
      const netHint = ` 先打开 Network 看失败原因：有 (blocked:cors) 再查 CORS；若是 failed / ERR_* / 长时间无响应，多为本机访问 ${base} 的网络问题，或 API_BASE_ORIGIN 与 Vercel Production 域名不一致。`;
      return `无法连接记账服务（请求在收到响应前就失败了）。${netHint}${originHint}`;
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
      parseError.hidden = false;
      parseError.textContent = `语音识别错误：${e.error}`;
      setRecUi(false);
    };

    recognition.onend = () => {
      if (speechInterimBuffer.trim()) {
        appendTranscript(speechInterimBuffer.trim());
        speechInterimBuffer = '';
        parseStatus.textContent = '已把最后一次识别内容写入文本框（可点「解析」）。';
      }
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
    let text = transcript.value.trim();
    if (!text && speechInterimBuffer.trim()) {
      text = speechInterimBuffer.trim();
      appendTranscript(text);
      speechInterimBuffer = '';
    }
    parseError.hidden = true;
    parsePreview.style.display = 'none';
    lastParsed = null;
    btnSave.disabled = true;
    if (!text) {
      parseError.hidden = false;
      parseError.textContent =
        '请先在文本框里输入或说话（说完请松手/点停止，临时识别会自动写入文本框）。';
      return;
    }
    parseStatus.textContent = '解析中…';
    try {
      const data = await apiFetch('/api/parse', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      if (!data || typeof data.parsed !== 'object') {
        throw new Error((data && data.message) || '解析接口返回数据异常');
      }
      showParsed(data.parsed);
      parseStatus.textContent = '解析完成。';
      if (data.parsed.amount === null || data.parsed.amount === undefined) {
        parseError.hidden = false;
        parseError.textContent = '未识别到金额：请补充口述或手动改文案后再解析；无法保存无金额账单。';
      }
    } catch (e) {
      parseError.hidden = false;
      parseError.textContent = friendlyFetchError(e, e.status) || e.message || '解析失败';
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
        li.innerHTML = '<span class="muted">请语音输入账单，当前还没有账单</span>';
        listEl.appendChild(li);
      }
    } catch (e) {
      totalEl.textContent = '—';
      const li = document.createElement('li');
      li.className = 'error';
      li.textContent = friendlyFetchError(e, e.status) || e.message || '加载失败';
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
        mount.innerHTML = '<p class="muted">请语音输入账单，当前还没有账单</p>';
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
      mount.innerHTML = `<p class="error">${escapeHtml(friendlyFetchError(e, e.status) || e.message)}</p>`;
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
              borderWidth: 2,
              borderColor: '#ffffff',
            },
          ],
        },
        options: {
          plugins: {
            legend: { labels: { color: '#3d5349', font: { size: 12 } } },
          },
        },
      });
      if (!labels.length) {
        legend.innerHTML = '<li class="muted">请语音输入账单，当前还没有账单</li>';
      }
    } catch (e) {
      legend.innerHTML = `<li class="error">${escapeHtml(friendlyFetchError(e, e.status) || e.message)}</li>`;
    }
  }

  $('refresh-home').addEventListener('click', loadHome);
  $('refresh-list').addEventListener('click', loadList);
  $('refresh-stats').addEventListener('click', loadStats);

  loadHome();
})();
