// ── Gacha Tracker ────────────────────────────────────────────────────────────
// Периоды берутся из объекта ceiling в ответах игры: там и границы окна спарка,
// и use_count — счётчик круток, который ведёт сама игра. Он главнее суммы наших
// записей, потому что учитывает крутки с телефона и до установки расширения.

const DATA_KEY = 'gachaTracker';
const LOG_KEY = 'gachaCaptureLog';
const ENABLED_KEY = 'gachaCaptureEnabled';
const WIKI_CACHE_KEY = 'gachaWikiCache';

// ── Оружие -> персонаж ───────────────────────────────────────────────────────
// Игра в ответе гачи не сообщает, кого открывает выпавшее оружие: там только
// сам предмет. Связь берём из gbf.wiki — в таблице weapons есть поле
// character_unlock, а join с characters сразу даёт id персонажа для картинки.
const WIKI_API = 'https://gbf.wiki/api.php';
const WIKI_BATCH = 50;

// Версия кэша: до v2 join шёл по characters.name и промахивался на половине
// персонажей, так что старые (ошибочно отрицательные) записи надо выбросить.
const WIKI_CACHE_VERSION = 2;

// Все три картинки на CDN игры одного размера — 280x160, сетка не разъезжается
const CDN = 'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img/sp/assets';
const IMG = {
  npc: (id) => `${CDN}/npc/m/${id}_01.jpg`,
  weapon: (id) => `${CDN}/weapon/m/${id}.jpg`,
  summon: (id) => `${CDN}/summon/m/${id}.jpg`,
};

// id уходит в SQL-условие Cargo, поэтому пропускаем только цифры
const SAFE_ID = /^\d{1,16}$/;

let wikiCache = {};

async function fetchWikiChunk(ids) {
  const params = new URLSearchParams({
    action: 'cargoquery',
    format: 'json',
    origin: '*',
    tables: 'weapons,characters',
    // Джойним на _pageName, а не на name: character_unlock хранит имя страницы
    // с уточнением ("Raziel (Summer)", "Lucius (SSR)"), которого в name нет.
    // На name промахивалось 328 SSR-оружий из 628, на _pageName — 2.
    join_on: 'weapons.character_unlock=characters._pageName',
    // character_unlock тащим отдельным полем: по нему видно оружие, у которого
    // персонаж указан, но join не сошёлся — это кандидаты на редирект
    fields: 'weapons.id=wid,weapons.character_unlock=cu,characters.id=cid,characters._pageName=cpage,characters.rarity=crar,characters.element=celem',
    where: `weapons.id IN (${ids.map((i) => `'${i}'`).join(',')})`,
    limit: '200',
  });
  const res = await fetch(`${WIKI_API}?${params}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (j.error) throw new Error(j.error.info || 'ошибка Cargo');
  return j.cargoquery || [];
}

// Апостроф в имени страницы ("Jeanne d'Arc") ломает условие Cargo — удваиваем
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Часть оружия ссылается на страницу-редирект ("Feena (SSR)" -> "Feena"), а в
// Cargo лежит каноническое имя, поэтому join таких не находит. Догоняем их
// через redirects=1 и повторный запрос по канoническим именам. Вызывается
// только для промахов, так что в обычном случае лишних запросов нет.
async function resolveViaRedirects(pending) {
  const titles = [...new Set(pending.map((p) => p.page))];

  const rp = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', redirects: '1',
    titles: titles.join('|'),
  });
  const rres = await fetch(`${WIKI_API}?${rp}`);
  if (!rres.ok) throw new Error('HTTP ' + rres.status);
  const rj = await rres.json();

  const moved = new Map();
  for (const r of (rj.query && rj.query.redirects) || []) moved.set(r.from, r.to);
  const targets = pending.filter((p) => moved.has(p.page))
    .map((p) => ({ wid: p.wid, page: moved.get(p.page) }));
  if (!targets.length) return false;

  const cp = new URLSearchParams({
    action: 'cargoquery', format: 'json', origin: '*', tables: 'characters',
    fields: '_pageName=cpage,id=cid,rarity=crar,element=celem',
    where: `_pageName IN (${[...new Set(targets.map((t) => t.page))].map(sqlStr).join(',')})`,
    limit: '200',
  });
  const cres = await fetch(`${WIKI_API}?${cp}`);
  if (!cres.ok) throw new Error('HTTP ' + cres.status);
  const cj = await cres.json();

  const byPage = new Map();
  for (const row of cj.cargoquery || []) {
    const t = row.title || {};
    if (t.cpage && t.cid) byPage.set(t.cpage, t);
  }

  let filled = false;
  for (const t of targets) {
    const c = byPage.get(t.page);
    if (!c) continue;
    wikiCache[t.wid] = { id: c.cid, name: c.cpage, rarity: c.crar, element: c.celem };
    filled = true;
  }
  return filled;
}

// Возвращает true, если кэш пополнился и нужна перерисовка
async function resolveCharacters(rawIds) {
  const todo = [...new Set(rawIds)].filter((id) => SAFE_ID.test(id) && !(id in wikiCache));
  if (!todo.length) return false;

  let changed = false;
  for (let i = 0; i < todo.length; i += WIKI_BATCH) {
    const chunk = todo.slice(i, i + WIKI_BATCH);
    try {
      const rows = await fetchWikiChunk(chunk);
      // Помечаем всё запрошенное как известное, включая промахи — иначе
      // на каждой перерисовке будем заново долбить вики теми же id
      for (const id of chunk) wikiCache[id] = null;
      const pending = [];
      for (const row of rows) {
        const t = row.title || {};
        if (!t.wid) continue;
        // Показываем имя страницы целиком: "Raziel" без "(Summer)" неоднозначно
        if (t.cid) {
          wikiCache[t.wid] = { id: t.cid, name: t.cpage, rarity: t.crar, element: t.celem };
        } else if (t.cu) {
          // персонаж указан, но страница не нашлась — возможно редирект
          pending.push({ wid: t.wid, page: t.cu });
        }
      }
      if (pending.length) {
        try { await resolveViaRedirects(pending); }
        catch (e) { console.warn('[GBF Gacha] Не удалось разрешить редиректы вики:', e.message); }
      }
      changed = true;
    } catch (e) {
      // Вики недоступна — оставляем id неизвестными и пробуем в следующий раз
      console.warn('[GBF Gacha] Не удалось получить данные с вики:', e.message);
      break;
    }
  }

  if (changed) {
    chrome.storage.local.set({ [WIKI_CACHE_KEY]: wikiCache, [WIKI_CACHE_KEY + 'V']: WIKI_CACHE_VERSION });
  }
  return changed;
}

const periodsEl = document.getElementById('periods');
const chk = document.getElementById('chk-capture');
const dbgBody = document.getElementById('debug-body');
const dbgToggle = document.getElementById('debug-toggle');
const statsEl = document.getElementById('stats');
const btnExport = document.getElementById('btn-export');
const btnClear = document.getElementById('btn-clear');
const btnHistoryDownload = document.getElementById('btn-history-download');
const btnHistoryUpload = document.getElementById('btn-history-upload');
const historyFile = document.getElementById('history-file');
const historyStatus = document.getElementById('history-status');

let currentLog = [];
let currentData = null;

// ── Форматирование ───────────────────────────────────────────────────────────
const pad = (v) => String(v).padStart(2, '0');

function fmtLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRange(startUtc, endUtc) {
  const a = new Date(startUtc), b = new Date(endUtc);
  const sameDay = a.toDateString() === b.toDateString();
  return sameDay
    ? `${fmtLocal(startUtc)} — ${pad(b.getHours())}:${pad(b.getMinutes())}`
    : `${fmtLocal(startUtc)} — ${fmtLocal(endUtc)}`;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

// SSR в игре зовётся "SS Rare" — выделяем его и NPC-персонажей
const isSSR = (r) => /^SS/i.test(r || '');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Карточка выпавшего: портрет персонажа, картинка сумона или оружия
function buildCard(src, title, sub, isNew) {
  const c = el('div', 'char');

  const img = document.createElement('img');
  img.src = src;
  img.alt = title;
  img.loading = 'lazy';
  // Картинки лежат на CDN игры: если он не ответил, показываем плашку
  img.addEventListener('error', () => img.replaceWith(el('div', 'char-noimg', title)));
  c.appendChild(img);

  const meta = el('div', 'char-meta');
  meta.appendChild(el('span', 'char-name', title));
  if (sub) meta.appendChild(el('span', 'char-sub', sub));
  if (isNew) meta.appendChild(el('span', 'tag-new', 'NEW'));
  c.appendChild(meta);

  return c;
}

// ── Отрисовка периода ────────────────────────────────────────────────────────
function buildPeriod(p) {
  const card = el('div', 'period');

  // Названия баннера в ответах игры нет: ceiling.name — это валюта спарка
  // ("Cerulean Sparks"), а legend.lineup даёт только тип крутки, одинаковый
  // для всех баннеров. Поэтому заголовок периода — его даты.
  const head = el('div', 'period-head');
  head.appendChild(el('div', 'period-title', fmtRange(p.startUtc, p.endUtc)));

  const now = Date.now();
  const state = now < p.startUtc ? 'upcoming' : (now > p.endUtc ? 'ended' : 'active');
  head.appendChild(el('span', 'badge badge-' + (state === 'active' ? 'live' : 'past'), state));
  card.appendChild(head);

  // Порядок в хранилище — это порядок прихода ответов, а он может сбиться
  // (например при импорте старого лога). Для показа сортируем по времени.
  const draws = (Array.isArray(p.draws) ? [...p.draws] : []).sort((a, b) => a.ts - b.ts);
  const used = Number(p.useCount) || 0;
  const target = Number(p.ceilingTarget) || 300;

  // Прогресс к спарку
  const prog = el('div', 'progress');
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  fill.style.width = Math.min(100, (used / target) * 100) + '%';
  if (used >= target) fill.classList.add('full');
  bar.appendChild(fill);
  prog.appendChild(bar);
  prog.appendChild(el('span', 'progress-num', `${used} / ${target}`));
  card.appendChild(prog);

  if (used === 0) {
    card.appendChild(el('div', 'nothing', 'No draws'));
    return card;
  }

  // Разбивка по источнику
  const byTicket = draws.filter((d) => d.source === 'ticket').reduce((s, d) => s + (d.count || 0), 0);
  const byCrystal = draws.filter((d) => d.source === 'crystal').reduce((s, d) => s + (d.count || 0), 0);
  const recorded = byTicket + byCrystal;
  const crystalsSpent = draws.filter((d) => d.source === 'crystal')
    .reduce((s, d) => s + (Number(d.unitPrice) || 0), 0);

  const sum = el('div', 'summary');
  if (byTicket) sum.appendChild(el('span', 'chip', `tickets: ${byTicket}`));
  if (byCrystal) sum.appendChild(el('span', 'chip', `crystals: ${byCrystal}`));
  if (crystalsSpent) sum.appendChild(el('span', 'chip dim', `${crystalsSpent.toLocaleString('en-US')} crystals spent`));
  card.appendChild(sum);

  // Игра насчитала больше, чем мы записали — значит часть круток прошла мимо
  if (used > recorded) {
    card.appendChild(el('div', 'gap',
      `The game counts ${used} draws, ${recorded} recorded. The missing ${used - recorded} happened before the extension was installed or on another device — their contents are unknown.`));
  }

  // Выпавшее делим на три группы: персонажи (оружие, которое их открывает),
  // прочие SSR и всё остальное счётчиками
  const chars = [];
  const ssr = [];
  let sr = 0, r = 0;
  for (const d of draws) {
    for (const it of (d.items || [])) {
      // Персонажей показываем только для SSR: SR-персонажи в трекере не нужны
      const ch = isSSR(it.rarity) ? wikiCache[it.id] : null;
      if (ch) { chars.push({ ...it, ts: d.ts, ch }); continue; }
      if (isSSR(it.rarity)) ssr.push({ ...it, ts: d.ts });
      else if (/^S Rare/i.test(it.rarity)) sr++;
      else r++;
    }
  }

  if (chars.length) {
    card.appendChild(el('div', 'section-label', `Characters (${chars.length})`));
    const grid = el('div', 'char-grid');
    // Стихию в подписи не дублируем — её иконка уже вшита в портрет
    for (const it of chars) grid.appendChild(buildCard(IMG.npc(it.ch.id), it.ch.name, it.name, it.isNew));
    card.appendChild(grid);
  }

  if (ssr.length) {
    card.appendChild(el('div', 'section-label', `Other SSR (${ssr.length})`));
    const grid = el('div', 'char-grid');
    for (const it of ssr) {
      // reward_id совпадает с id ассета, так что вики для сумонов и обычного
      // оружия не нужна — картинка строится прямо из него
      const src = it.type === 'summon' ? IMG.summon(it.id) : IMG.weapon(it.id);
      grid.appendChild(buildCard(src, it.name, it.type, it.isNew));
    }
    card.appendChild(grid);
  } else if (recorded && !chars.length) {
    card.appendChild(el('div', 'section-label dim', 'No SSR'));
  }

  if (sr || r) {
    card.appendChild(el('div', 'minor', `Other: SR ${sr}, R ${r}`));
  }

  // Спарк — только руками: обмен на потолке в ответах гачи не виден
  const sparkWrap = el('div', 'spark');
  sparkWrap.appendChild(el('label', null, 'Spark:'));
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = used >= target ? 'who you picked at 300' : `available at ${target}`;
  input.value = p.spark?.name || '';
  input.addEventListener('change', () => saveSpark(p.key, input.value.trim()));
  sparkWrap.appendChild(input);
  card.appendChild(sparkWrap);

  return card;
}

function saveSpark(key, name) {
  chrome.storage.local.get([DATA_KEY], (res) => {
    const data = res[DATA_KEY];
    if (!data || !data.periods || !data.periods[key]) return;
    // Очистка поля тоже пишется со временем, а не как null: иначе при
    // синхронизации значение с другого устройства «воскресило» бы стёртое имя,
    // потому что у пустого поля не было бы времени для сравнения.
    data.periods[key].spark = { name: name.slice(0, 80), ts: Date.now() };
    chrome.storage.local.set({ [DATA_KEY]: data });
  });
}

function renderPeriods(data) {
  currentData = data || null;
  const periods = Object.values((data && data.periods) || {});
  btnHistoryDownload.disabled = periods.length === 0;
  periodsEl.innerHTML = '';

  if (!periods.length) {
    periodsEl.appendChild(el('div', 'empty',
      'Nothing yet. Open the gacha screen in game — the period will be picked up automatically.'));
    return;
  }

  periods.sort((a, b) => b.startUtc - a.startUtc);
  for (const p of periods) periodsEl.appendChild(buildPeriod(p));

  // Спрашиваем вики только про SSR-оружие: остальное в трекере всё равно
  // показывается счётчиками, а лишние сотни id по чужой вики гонять незачем.
  const ids = [];
  for (const p of periods) {
    for (const d of (p.draws || [])) {
      for (const it of (d.items || [])) {
        if (it.type === 'weapon' && isSSR(it.rarity)) ids.push(it.id);
      }
    }
  }
  if (ids.length) {
    resolveCharacters(ids).then((changed) => {
      // Перерисовываем только если появились новые связки
      if (changed) renderPeriods(data);
    });
  }
}

// ── История: скачать и загрузить ─────────────────────────────────────────────
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function saveJson(name, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let historyStatusTimer;
function setHistoryStatus(text, failed) {
  clearTimeout(historyStatusTimer);
  historyStatus.textContent = text;
  historyStatus.className = failed ? 'failed' : '';
  if (text) historyStatusTimer = setTimeout(() => setHistoryStatus(''), 8000);
}

btnHistoryDownload.addEventListener('click', () => {
  const periods = (currentData && currentData.periods) || {};
  saveJson(`gbf-gacha-history_${today()}.json`, {
    exportedAt: new Date().toISOString(),
    periodCount: Object.keys(periods).length,
    periods,
  });
});

btnHistoryUpload.addEventListener('click', () => historyFile.click());

historyFile.addEventListener('change', () => {
  const file = historyFile.files[0];
  // Сбрасываем сразу: иначе повторный выбор того же файла не вызовет change
  historyFile.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onerror = () => setHistoryStatus('Could not read the file', true);
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); } catch (e) {
      return setHistoryStatus('Not a JSON file', true);
    }
    // Годится и наш экспорт ({ periods }), и сам трекер целиком из бэкапа
    const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed.periods || parsed) : null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return setHistoryStatus('No gacha periods in this file', true);
    }
    // Без этой проверки за карту периодов сходил бы любой JSON-объект: ключи в
    // ней произвольные, так что отличить её можно только по виду значений
    const periods = {};
    for (const [key, p] of Object.entries(raw)) {
      const ok = p && typeof p === 'object' && !Array.isArray(p)
        && (Array.isArray(p.draws) || (Number.isFinite(Number(p.startUtc)) && Number.isFinite(Number(p.endUtc))));
      if (ok) periods[key] = p;
    }
    if (!Object.keys(periods).length) {
      return setHistoryStatus('No gacha periods in this file', true);
    }

    setHistoryStatus('Importing...');
    // Слияние делает фон: там же живёт код, которым сливаются данные с сервера,
    // и только он знает, чей use_count и спарк свежее
    chrome.runtime.sendMessage({ type: 'GACHA_IMPORT', data: { periods } }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        const why = chrome.runtime.lastError ? 'no response' : (res && res.error) || 'unknown';
        return setHistoryStatus(`Import failed: ${why}`, true);
      }
      setHistoryStatus(res.added
        ? `Imported: ${res.added} new period(s), ${res.total} total`
        : `Imported: nothing new, ${res.total} total`);
    });
  };
  reader.readAsText(file);
});

// ── Отладочный лог ───────────────────────────────────────────────────────────
function renderLog(log) {
  currentLog = Array.isArray(log) ? log : [];
  const bytes = currentLog.length ? JSON.stringify(currentLog).length : 0;
  statsEl.textContent = `${currentLog.length} entries · ${fmtBytes(bytes)}`;
  btnExport.disabled = currentLog.length === 0;
  btnClear.disabled = currentLog.length === 0;
}

btnExport.addEventListener('click', () => {
  saveJson(`gbf-gacha-capture_${today()}.json`, {
    exportedAt: new Date().toISOString(),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    entryCount: currentLog.length,
    entries: currentLog,
  });
});

btnClear.addEventListener('click', () => chrome.storage.local.set({ [LOG_KEY]: [] }));

chk.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'GACHA_SET_CAPTURE', enabled: chk.checked }, () => {
    if (chrome.runtime.lastError) return;
  });
});

dbgToggle.addEventListener('click', () => {
  const open = dbgBody.hasAttribute('hidden');
  if (open) dbgBody.removeAttribute('hidden'); else dbgBody.setAttribute('hidden', '');
  dbgToggle.textContent = open ? 'Debug ▾' : 'Debug ▸';
});

// ── Загрузка и живое обновление ──────────────────────────────────────────────
function load() {
  chrome.storage.local.get([DATA_KEY, LOG_KEY, ENABLED_KEY, WIKI_CACHE_KEY, WIKI_CACHE_KEY + 'V'], (res) => {
    // Кэш старой версии содержит ошибочные промахи — начинаем с нуля
    wikiCache = res[WIKI_CACHE_KEY + 'V'] === WIKI_CACHE_VERSION ? (res[WIKI_CACHE_KEY] || {}) : {};
    renderPeriods(res[DATA_KEY]);
    renderLog(res[LOG_KEY]);
    chk.checked = !!res[ENABLED_KEY];
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[DATA_KEY]) renderPeriods(changes[DATA_KEY].newValue);
  if (changes[LOG_KEY]) renderLog(changes[LOG_KEY].newValue);
  if (changes[ENABLED_KEY]) chk.checked = !!changes[ENABLED_KEY].newValue;
});

load();
