// ── Gacha Tracker ────────────────────────────────────────────────────────────
// Периоды берутся из объекта ceiling в ответах игры: там и границы окна спарка,
// и use_count — счётчик круток, который ведёт сама игра. Он главнее суммы наших
// записей, потому что учитывает крутки с телефона и до установки расширения.

const DATA_KEY = 'gachaTracker';
const LOG_KEY = 'gachaCaptureLog';
const ENABLED_KEY = 'gachaCaptureEnabled';
const WIKI_CACHE_KEY = 'gachaWikiCache';
const VIEW_KEY = 'gachaView';

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
const viewSort = document.getElementById('view-sort');
const viewLayout = document.getElementById('view-layout');

let currentLog = [];
let currentData = null;

// Категории раскладываются по колонкам жадно — каждая уходит в самую короткую на
// этот момент. Числа держим здесь же, потому что высоту категории приходится
// оценивать до вставки в DOM: сколько карточек встанет в ряд, зависит от ширины
// колонки, а она — от того, сколько колонок мы решили сделать.
const COLUMN_GAP = 16;
const COLUMN_MIN_WIDTH = 320;
const CARD_WIDTH = 150;
const CARD_GAP = 8;
// Картинка 150x86 (280x160 по ширине карточки) плюс подписи и отступы
const CARD_HEIGHT = 150;
const LABEL_HEIGHT = 26;
const columnHosts = [];

// Вид списка выпавшего. sort='drawn' показывает всё одной лентой в порядке
// выпадения — так между карточками нет дыр от категорий с одним предметом;
// sort='type' раскладывает по категориям, и тогда layout выбирает, идут они
// друг под другом на всю ширину ('rows') или разъезжаются вбок ('columns').
const view = { sort: 'type', layout: 'columns' };

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

// reward_type в ответе гачи бывает только weapon или summon
const isSummon = (it) => /summon/i.test(it.type);

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

// reward_id совпадает с id ассета, так что вики для сумонов и обычного оружия
// не нужна — картинка строится прямо из него
function cardSrc(it) {
  if (it.ch) return IMG.npc(it.ch.id);
  return isSummon(it) ? IMG.summon(it.id) : IMG.weapon(it.id);
}

const cardName = (it) => (it.ch ? it.ch.name : it.name);

function cardFor(it) {
  // Стихию в подписи не дублируем — её иконка уже вшита в портрет
  return buildCard(cardSrc(it), cardName(it), it.ch ? it.name : null, it.isNew);
}

// Категория целиком: заголовок и сетка карточек фиксированной ширины
function buildSection(label, items, makeCard) {
  const wrap = el('div', 'gacha-section');
  wrap.appendChild(el('div', 'section-label', label));
  const grid = el('div', 'char-grid');
  for (const it of items) grid.appendChild(makeCard(it));
  wrap.appendChild(grid);
  return { el: wrap, count: items.length };
}

// Раскладка категорий по колонкам: на узком окне колонка одна и всё идёт вниз,
// на широком категории разъезжаются вбок вместо пустоты справа
function layoutSections(host, sections) {
  host._sections = sections;
  if (!columnHosts.includes(host)) columnHosts.push(host);

  const width = host.clientWidth || (host.parentElement ? host.parentElement.clientWidth : 0);
  const fit = Math.floor((width + COLUMN_GAP) / (COLUMN_MIN_WIDTH + COLUMN_GAP));
  const count = Math.max(1, Math.min(sections.length || 1, fit || 1));
  const colWidth = (width - COLUMN_GAP * (count - 1)) / count;
  const perRow = Math.max(1, Math.floor((colWidth + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));

  host.innerHTML = '';
  const cols = [];
  const heights = [];
  for (let i = 0; i < count; i++) {
    const col = el('div', 'gacha-col');
    host.appendChild(col);
    cols.push(col);
    heights.push(0);
  }
  for (const s of sections) {
    let shortest = 0;
    for (let i = 1; i < count; i++) {
      if (heights[i] < heights[shortest]) shortest = i;
    }
    cols[shortest].appendChild(s.el);
    heights[shortest] += LABEL_HEIGHT + Math.ceil(s.count / perRow) * (CARD_HEIGHT + CARD_GAP) + COLUMN_GAP;
  }
}

function relayoutAll() {
  for (let i = columnHosts.length - 1; i >= 0; i--) {
    const host = columnHosts[i];
    // Перерисовка периодов выбрасывает старые контейнеры из документа
    if (!host.isConnected) { columnHosts.splice(i, 1); continue; }
    layoutSections(host, host._sections);
  }
}

let lastWidth = 0;
new ResizeObserver(() => {
  const width = periodsEl.clientWidth;
  if (width === lastWidth) return;
  lastWidth = width;
  relayoutAll();
}).observe(document.body);

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

  const headRight = el('div', 'head-right');
  // Показывать нечего, пока не разобрали выпавшее — включим ниже
  const btnImg = el('button', 'btn btn-img', '🖼 Image');
  btnImg.title = 'Save this banner as a picture';
  btnImg.hidden = true;
  headRight.appendChild(btnImg);
  headRight.appendChild(el('span', 'badge badge-' + (state === 'active' ? 'live' : 'past'), state));
  head.appendChild(headRight);
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

  // SSR собираем одной лентой в порядке выпадения — категории из неё уже
  // выбираются фильтрами, а SR и R идут счётчиками
  const all = [];
  let sr = 0, r = 0;
  for (const d of draws) {
    for (const it of (d.items || [])) {
      if (!isSSR(it.rarity)) {
        if (/^S Rare/i.test(it.rarity)) sr++; else r++;
        continue;
      }
      // Персонажей показываем только для SSR: SR-персонажи в трекере не нужны
      all.push({ ...it, ts: d.ts, ch: wikiCache[it.id] || null });
    }
  }

  if (all.length) {
    btnImg.hidden = false;
    btnImg.addEventListener('click', () => saveSparkImage(btnImg, p, all, used, target, recorded));
  }

  if (!all.length) {
    if (recorded) card.appendChild(el('div', 'section-label dim', 'No SSR'));
  } else if (view.sort === 'drawn') {
    card.appendChild(buildSection(`SSR (${all.length})`, all, cardFor).el);
  } else {
    const chars = all.filter((it) => it.ch);
    const summons = all.filter((it) => !it.ch && isSummon(it));
    const others = all.filter((it) => !it.ch && !isSummon(it));

    const sections = [];
    if (chars.length) sections.push(buildSection(`Characters (${chars.length})`, chars, cardFor));
    if (summons.length) sections.push(buildSection(`Summons (${summons.length})`, summons, cardFor));
    if (others.length) sections.push(buildSection(`Other SSR (${others.length})`, others, cardFor));

    if (view.layout === 'columns') {
      const host = el('div', 'gacha-columns');
      card.appendChild(host);
      // Ширину узнаём только после вставки периода в документ, поэтому здесь
      // раскладка предварительная — renderPeriods повторит её на месте
      layoutSections(host, sections);
    } else {
      for (const s of sections) card.appendChild(s.el);
    }
  }

  if (sr || r) {
    card.appendChild(el('div', 'minor', `Other: SR ${sr}, R ${r}`));
  }

  // Спарк — только руками: обмен на потолке в ответах гачи не виден
  card.appendChild(buildSparkRow(p, used, target));

  return card;
}

function buildSparkRow(p, used, target) {
  const wrap = el('div', 'spark');
  wrap.appendChild(el('label', null, 'Spark:'));

  const field = el('div', 'spark-field');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = used >= target ? 'who you picked at 300' : `available at ${target}`;
  input.value = p.spark?.name || '';
  field.appendChild(input);
  wrap.appendChild(field);

  // Спарк не выпадал сам, поэтому is_new у игры на него нет — отмечается руками
  const newLabel = el('label', 'spark-new');
  const chkNew = document.createElement('input');
  chkNew.type = 'checkbox';
  chkNew.checked = !!p.spark?.isNew;
  newLabel.append(chkNew, el('span', null, 'New'));
  newLabel.title = 'Mark the sparked one as new — it decides which column it lands in';
  wrap.appendChild(newLabel);

  const commit = () => {
    const name = input.value.trim();
    saveSpark(p.key, name, suggest.resolve(name), chkNew.checked);
  };
  // Подсказки с вики: имя нужно ровно то же, что на странице персонажа, иначе
  // по нему не найти id — а без id спарк не нарисовать на картинке
  const suggest = createSuggest(input, field, commit);
  if (p.spark?.name && p.spark.id) suggest.remember(p.spark);

  input.addEventListener('change', commit);
  chkNew.addEventListener('change', commit);

  return wrap;
}

// Ищем по SSR-персонажам и сумонам: спаркают обычно их
async function searchWiki(term) {
  const like = sqlStr('%' + term.replace(/[%_\\]/g, '') + '%');
  const ask = async (tables, kind) => {
    const params = new URLSearchParams({
      action: 'cargoquery', format: 'json', origin: '*',
      tables, fields: '_pageName=cpage,id=cid',
      where: `rarity='SSR' AND _pageName LIKE ${like}`,
      limit: '12',
    });
    const res = await fetch(`${WIKI_API}?${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return (j.cargoquery || [])
      .map((row) => row.title || {})
      .filter((t) => t.cpage && t.cid)
      .map((t) => ({ name: t.cpage, id: t.cid, kind }));
  };
  const [chars, summons] = await Promise.all([ask('characters', 'character'), ask('summons', 'summon')]);
  return [...chars, ...summons];
}

// Свой список подсказок вместо <datalist>: нативный рисуется браузером и в
// тёмном окне выглядит чужеродно, а стилизовать его нечем
function createSuggest(input, host, onPick) {
  const box = el('div', 'suggest');
  box.hidden = true;
  host.appendChild(box);

  // Что вики уже подсказала: по имени отсюда достаём id при сохранении
  const found = new Map();
  const remember = (row) => found.set(row.name.toLowerCase(), { id: row.id, kind: row.kind });

  let rows = [];
  let active = -1;
  let timer = 0;

  const close = () => { box.hidden = true; active = -1; };

  const paint = () => {
    box.innerHTML = '';
    rows.forEach((row, i) => {
      const item = el('div', 'suggest-item' + (i === active ? ' active' : ''));
      item.append(el('span', 'suggest-name', row.name), el('span', 'suggest-kind', row.kind));
      // mousedown, а не click: click приходит уже после blur, а blur закрывает
      // список, и клик попадал бы в пустоту
      item.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      box.appendChild(item);
    });
    box.hidden = !rows.length;
  };

  const pick = (i) => {
    if (!rows[i]) return;
    input.value = rows[i].name;
    close();
    onPick();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) return close();
    // Ждём паузу в наборе: иначе на каждую букву уходит запрос в чужую вики
    timer = setTimeout(async () => {
      let found_;
      try { found_ = await searchWiki(term); } catch (e) {
        // Вики недоступна — подсказок не будет, имя всё равно можно вписать
        return console.warn('[GBF Gacha] Поиск по вики не удался:', e.message);
      }
      // Пока ходили в вики, поле могли дочистить
      if (input.value.trim().length < 2) return;
      rows = found_;
      rows.forEach(remember);
      active = -1;
      paint();
    }, 300);
  });

  input.addEventListener('keydown', (e) => {
    if (box.hidden || !rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      paint();
      box.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', close);

  return { remember, resolve: (name) => found.get(name.toLowerCase()) || null };
}

function saveSpark(key, name, hit, isNew) {
  chrome.storage.local.get([DATA_KEY], (res) => {
    const data = res[DATA_KEY];
    if (!data || !data.periods || !data.periods[key]) return;
    // Очистка поля тоже пишется со временем, а не как null: иначе при
    // синхронизации значение с другого устройства «воскресило» бы стёртое имя,
    // потому что у пустого поля не было бы времени для сравнения.
    data.periods[key].spark = {
      name: name.slice(0, 80),
      // id есть только у имени, выбранного из подсказки: вписанное руками
      // рисуется на картинке плашкой с текстом
      id: hit && SAFE_ID.test(hit.id) ? hit.id : null,
      kind: hit ? hit.kind : null,
      isNew: !!isNew,
      ts: Date.now(),
    };
    chrome.storage.local.set({ [DATA_KEY]: data });
  });
}

// ── Картинка баннера ─────────────────────────────────────────────────────────
function sparkEntry(spark) {
  if (!spark || !spark.name) return null;
  // Без id рисуем плашку с именем: имя, вписанное руками, на вики не нашлось
  const src = spark.id
    ? (spark.kind === 'summon' ? IMG.summon(spark.id) : IMG.npc(spark.id))
    : null;
  return { src, name: spark.name, isNew: !!spark.isNew, spark: true };
}

// Спарк не выпадал, а взят на потолке — ставим его в ту колонку, где он был бы,
// выпади он сам; какой он там единственный помеченный, видно по обводке
const sparkColumn = (spark) => (spark.kind === 'summon' ? 2 : (spark.isNew ? 0 : 1));

async function saveSparkImage(btn, p, all, used, target, recorded) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Drawing…';
  try {
    const entry = (it) => ({ src: cardSrc(it), name: cardName(it), isNew: it.isNew });
    // Сумоны идут своей колонкой целиком, новые они или нет
    const rest = all.filter((it) => !isSummon(it));
    const pct = recorded ? (all.length / recorded * 100).toFixed(1) : '0.0';

    // showNew только у сумонов: две первые колонки сами делятся по новизне, и
    // значок на каждой карточке лишь повторял бы их заголовок
    const columns = [
      { title: 'New', items: rest.filter((it) => it.isNew).map(entry) },
      { title: 'Already owned', items: rest.filter((it) => !it.isNew).map(entry) },
      { title: 'Summons', items: all.filter(isSummon).map(entry), showNew: true },
    ];
    const sp = sparkEntry(p.spark);
    if (sp) columns[sparkColumn(p.spark)].items.push(sp);

    const blob = await SPARK_IMG.render({
      title: fmtRange(p.startUtc, p.endUtc),
      used, target,
      subtitle: `${all.length} SSR in ${recorded} recorded draws · ${pct}%`,
      // Про незаписанные крутки пишем прямо на картинке: иначе процент SSR
      // читался бы как процент за весь баннер, а он только по записанному
      note: used > recorded
        ? `${used - recorded} of ${used} draws weren't recorded — their contents are unknown`
        : null,
      columns,
    });
    saveBlob(`gbf-spark_${fileDate(p.startUtc)}.png`, blob);
  } catch (e) {
    setHistoryStatus('Could not build the image: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
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
  // Категории раскладывались, когда период ещё не был в документе и его ширина
  // была неизвестна — теперь она известна
  relayoutAll();

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
const fileDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = () => fileDate(Date.now());

function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function saveJson(name, payload) {
  saveBlob(name, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
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

// ── Вид списка ───────────────────────────────────────────────────────────────
function applyViewControls() {
  viewSort.value = view.sort;
  viewLayout.value = view.layout;
  // В ленте по порядку выпадения категорий нет — и раскладывать нечего
  viewLayout.hidden = view.sort !== 'type';
}

function onViewChange() {
  view.sort = viewSort.value;
  view.layout = viewLayout.value;
  applyViewControls();
  chrome.storage.local.set({ [VIEW_KEY]: { ...view } });
  renderPeriods(currentData);
}

viewSort.addEventListener('change', onViewChange);
viewLayout.addEventListener('change', onViewChange);

dbgToggle.addEventListener('click', () => {
  const open = dbgBody.hasAttribute('hidden');
  if (open) dbgBody.removeAttribute('hidden'); else dbgBody.setAttribute('hidden', '');
  dbgToggle.textContent = open ? 'Debug ▾' : 'Debug ▸';
});

// ── Загрузка и живое обновление ──────────────────────────────────────────────
function load() {
  chrome.storage.local.get([DATA_KEY, LOG_KEY, ENABLED_KEY, WIKI_CACHE_KEY, WIKI_CACHE_KEY + 'V', VIEW_KEY], (res) => {
    // Кэш старой версии содержит ошибочные промахи — начинаем с нуля
    wikiCache = res[WIKI_CACHE_KEY + 'V'] === WIKI_CACHE_VERSION ? (res[WIKI_CACHE_KEY] || {}) : {};
    const saved = res[VIEW_KEY];
    if (saved && typeof saved === 'object') {
      if (saved.sort === 'drawn' || saved.sort === 'type') view.sort = saved.sort;
      if (saved.layout === 'rows' || saved.layout === 'columns') view.layout = saved.layout;
    }
    applyViewControls();
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
