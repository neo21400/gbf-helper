// ── Картинка результатов баннера ─────────────────────────────────────────────
// Рисует итог периода одним PNG: шапка со счётчиком и три колонки — новые SSR,
// повторки и сумоны. Чистое рисование: что в какую колонку попало, решает
// gacha.js и передаёт сюда уже готовые ссылки на картинки.
//
// Картинки тянем через fetch, а не через <img>. CDN игры отдаёт
// Access-Control-Allow-Origin: https://game.granbluefantasy.jp — не '*', поэтому
// с crossOrigin="anonymous" картинка просто не загрузится, а без него холст
// становится «грязным» и toBlob() бросает SecurityError. Свой fetch с
// host_permissions обходит и то, и другое: байты приходят к нам, а на холст
// попадает уже наш ImageBitmap.

const SPARK_IMG = (() => {
  const SCALE = 2;              // рисуем в 2x, чтобы картинка не мылилась
  const PAD = 20;
  const COL_W = 150;
  const COL_GAP = 14;
  const THUMB_W = COL_W;
  const THUMB_H = Math.round(COL_W * 160 / 280); // все ассеты игры 280x160
  const NAME_H = 18;
  const ENTRY_H = THUMB_H + NAME_H + 8;
  const COL_HEAD_H = 22;

  const BG = '#121212';
  const CARD = '#1a1a1a';
  const BORDER = '#2a2a2a';
  const ACCENT = '#0288d1';
  const TEXT = '#e0e0e0';
  const DIM = '#777';
  const GOLD = '#ffd54f';
  const NEW_BG = 'rgba(2,136,209,0.85)';

  const FONT = '"Segoe UI", Roboto, -apple-system, sans-serif';

  async function loadBitmap(src) {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      return await createImageBitmap(await res.blob());
    } catch (e) {
      // Нет сети или CDN не отдал картинку — на её месте будет плашка с именем
      return null;
    }
  }

  // Собираем все картинки разом: они независимы, а последовательная загрузка
  // сотни ассетов заметно тормозит
  async function preload(spec) {
    const srcs = new Set();
    for (const col of spec.columns) for (const it of col.items) if (it.src) srcs.add(it.src);

    const list = [...srcs];
    const bitmaps = await Promise.all(list.map(loadBitmap));
    const map = new Map();
    list.forEach((src, i) => map.set(src, bitmaps[i]));
    return map;
  }

  function fit(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s + '…';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Плашка в углу картинки: NEW слева, SPARK справа
  function drawTag(ctx, text, x, y, bg, fg, alignRight) {
    ctx.font = `bold 9px ${FONT}`;
    const w = ctx.measureText(text).width + 10;
    const left = alignRight ? x - w : x;
    ctx.fillStyle = bg;
    roundRect(ctx, left, y, w, 14, 3);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, left + 5, y + 10);
  }

  // showNew приходит от колонки: в колонке новых значок на каждой карточке
  // только повторял бы её заголовок
  function drawThumb(ctx, bitmap, it, x, y, showNew) {
    const name = it.name;
    ctx.save();
    roundRect(ctx, x, y, THUMB_W, THUMB_H, 4);
    ctx.clip();
    if (bitmap) {
      ctx.drawImage(bitmap, x, y, THUMB_W, THUMB_H);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, THUMB_W, THUMB_H);
      ctx.fillStyle = DIM;
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(fit(ctx, name, THUMB_W - 12), x + THUMB_W / 2, y + THUMB_H / 2 + 4);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // Спаркнутое обводим золотом: в своей колонке оно иначе ничем не отличается
    // от того, что выпало само
    if (it.spark) {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      roundRect(ctx, x + 1, y + 1, THUMB_W - 2, THUMB_H - 2, 4);
      ctx.stroke();
    } else {
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, THUMB_W - 1, THUMB_H - 1, 4);
      ctx.stroke();
    }

    if (it.isNew && showNew) drawTag(ctx, 'NEW', x + 5, y + 5, NEW_BG, '#fff', false);
    if (it.spark) drawTag(ctx, 'SPARK', x + THUMB_W - 5, y + 5, GOLD, '#1a1a1a', true);

    ctx.fillStyle = it.spark ? GOLD : TEXT;
    ctx.font = `11.5px ${FONT}`;
    ctx.fillText(fit(ctx, name, THUMB_W), x, y + THUMB_H + 14);
  }

  // Возвращает PNG-блоб с итогом периода
  async function render(spec) {
    const images = await preload(spec);

    const cols = spec.columns;
    const rows = Math.max(1, ...cols.map((c) => c.items.length));
    const width = PAD * 2 + cols.length * COL_W + (cols.length - 1) * COL_GAP;

    const headH = spec.note ? 76 : 58;
    const height = PAD + headH + 12 + COL_HEAD_H + rows * ENTRY_H + PAD;

    const canvas = document.createElement('canvas');
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    // ── Шапка ──
    let y = PAD + 16;
    ctx.fillStyle = '#fff';
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillText(fit(ctx, spec.title, width - PAD * 2), PAD, y);

    y += 22;
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = ACCENT;
    const counter = `${spec.used} / ${spec.target}`;
    ctx.fillText(counter, PAD, y);
    ctx.fillStyle = DIM;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(spec.subtitle, PAD + ctx.measureText(counter).width + 24, y);

    if (spec.note) {
      y += 18;
      ctx.fillStyle = '#c9a84c';
      ctx.font = `11px ${FONT}`;
      ctx.fillText(fit(ctx, spec.note, width - PAD * 2), PAD, y);
    }

    // ── Колонки ──
    let cy = PAD + headH + 12;
    cols.forEach((col, i) => {
      const x = PAD + i * (COL_W + COL_GAP);

      ctx.fillStyle = ACCENT;
      ctx.font = `bold 10px ${FONT}`;
      // Заголовок режем по ширине колонки: длинный иначе залезет на соседнюю
      ctx.fillText(fit(ctx, `${col.title.toUpperCase()} (${col.items.length})`, COL_W), x, cy + 12);

      if (!col.items.length) {
        ctx.fillStyle = '#444';
        ctx.font = `11.5px ${FONT}`;
        ctx.fillText('—', x, cy + COL_HEAD_H + 14);
        return;
      }

      col.items.forEach((it, j) => {
        const y0 = cy + COL_HEAD_H + j * ENTRY_H;
        ctx.fillStyle = CARD;
        drawThumb(ctx, images.get(it.src), it, x, y0, !!col.showNew);
      });
    });

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
    });
  }

  return { render };
})();
