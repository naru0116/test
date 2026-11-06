// 盤面の描画部品。
// - 工作員の駒（世界地図・路線図で共通）
// - スマホ縦画面用の「路線図」盤面（12都市を1画面に収める）
//
// ctx = { s, v, sel, reachable:Set, cityPick:Set, agentCands:Set, hints, traps, fresh, memos, focusCity }

import * as G from './game.js';
import * as A from './art.js';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 工作員の駒 ----------

// 位置 (x, y) に、倍率 scale で駒を描く。潜伏中の自分の駒は半透明で「潜伏」と表示する。
export function agentTokenSVG(ctx, a, x, y, scale = 1.25) {
  const { s, v } = ctx;
  const pl = s.players[a.owner];
  const ident = G.knownIdentity(s, v, a.id);
  const memo = !ident && ctx.memos ? ctx.memos[a.id] : null;
  const k = scale / 1.25;
  const cls = ['agent'];
  if (ctx.sel === a.id) cls.push('sel');
  if (ctx.agentCands.has(a.id)) cls.push('cand');
  const L = s.last;
  if (ctx.fresh && L && L.agent === a.id && L.type === 'move') cls.push('moved');
  if (a.hidden) cls.push('veiled');
  const parts = [`<rect x="${-19 * k}" y="${-30 * k}" width="${38 * k}" height="${56 * k}" fill="#000" fill-opacity="0"/>`];
  if (ctx.sel === a.id || ctx.agentCands.has(a.id)) parts.push(`<ellipse cx="0" cy="${20 * k}" rx="${16 * k}" ry="${6 * k}" class="glow"/>`);
  parts.push(`<g class="fig" transform="scale(${scale})">${A.agentShape(pl.color, a.label)}</g>`);
  if (a.hidden) {
    parts.push(`<rect x="${-15 * k}" y="${-26 * k}" width="${30 * k}" height="${47 * k}" rx="2" fill="#0b1317" opacity=".5" stroke="#d0b17b" stroke-dasharray="3 2"/>`);
    parts.push(`<text y="${-4 * k}" text-anchor="middle" font-size="${Math.max(8, 10 * k)}" font-weight="900" fill="#f0d9a6">潜伏</text>`);
  }
  if (ident === 'ace') parts.push(A.aceBadge(13 * k, -24 * k, 6.2 * Math.max(k, 0.8)));
  else if (ident === 'decoy') parts.push(A.decoyBadge(13 * k, -24 * k, 6.2 * Math.max(k, 0.8)));
  else if (memo) parts.push(memoBadge(13 * k, -24 * k, memo, Math.max(k, 0.8)));
  a.files.forEach((f, j) => {
    const kf = G.knownFile(s, v, f);
    parts.push(`<g transform="translate(${(-26 + j * 4) * k} ${(2 - j * 3) * k})">${A.folderShape(kf === true ? 'real' : kf === false ? 'fake' : 'unknown', 18 * Math.max(k, 0.75))}</g>`);
  });
  const title = `${pl.name}の${a.label}${ident === 'ace' ? '（本物）' : ident === 'decoy' ? '（囮）' : ''}${memo ? `（メモ: ${memo === 'ace' ? '本物っぽい' : '囮っぽい'}）` : ''}${a.hidden ? '（潜伏中）' : ''}・ファイル${a.files.length}`;
  // 位置は外側の g の transform 属性、アニメーションは内側の g（CSS の transform が位置を上書きしないように）
  return `<g class="${cls.join(' ')}" data-agent="${a.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(title)}</title><g class="bob">${parts.join('')}</g></g>`;
}

// 推理メモの印（自分だけに見える）
function memoBadge(x, y, memo, k = 1) {
  const r = 7.5 * k;
  const label = memo === 'ace' ? '本?' : '囮?';
  const fill = memo === 'ace' ? '#e2a610' : '#6d6a75';
  return `<g class="memo"><circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.2" stroke-dasharray="2 1.5"/><text x="${x}" y="${y + 3.2 * k}" text-anchor="middle" font-size="${7.5 * k}" font-weight="900" fill="#fff">${label}</text></g>`;
}

// 潜伏中の相手の工作員の「影」（いる可能性のある都市すべてに表示）
// クリックは「その都市」をタップしたのと同じ扱い（data-ghost-city）。本当の居場所は使わない。
export function ghostTokenSVG(ctx, a, x, y, scale = 1.25, cityId = '') {
  const { s } = ctx;
  const pl = s.players[a.owner];
  const k = scale / 1.25;
  const n = a.hidden.possible.length;
  return `<g class="ghost" data-ghost-city="${cityId}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(pl.name)}の${a.label}（潜伏中・候補${n}都市のどこか）</title>
    <rect x="${-14 * k}" y="${-25 * k}" width="${28 * k}" height="${45 * k}" rx="3" fill="rgba(11,19,23,.55)" stroke="${pl.color}" stroke-width="2" stroke-dasharray="4 3"/>
    <text y="${2 * k}" text-anchor="middle" font-size="${20 * k}" font-weight="900" fill="${pl.color}">?</text>
    <text y="${16 * k}" text-anchor="middle" font-size="${9 * k}" font-weight="800" fill="#f0d9a6">${a.label}</text></g>`;
}

// 都市ごとに描く駒の一覧（見えている工作員 + 潜伏中の相手の影）
export function tokensByCity(ctx) {
  const { s, v } = ctx;
  const by = {};
  for (const a of s.agents) {
    if (!a.city) continue;
    if (G.agentVisible(s, v, a)) (by[a.city] ||= []).push({ a, ghost: false });
    else for (const c of a.hidden.possible) (by[c] ||= []).push({ a, ghost: true });
  }
  for (const list of Object.values(by)) {
    list.sort((x, y) => (x.a.owner === v ? -1 : 0) - (y.a.owner === v ? -1 : 0) || x.a.owner - y.a.owner || x.a.label.localeCompare(y.a.label) || (x.ghost - y.ghost));
  }
  return by;
}

// ---------- 路線図 ----------

const NORTH = ['ny', 'london', 'berlin', 'moscow', 'beijing', 'tokyo'];
const SOUTH = ['rio', 'casablanca', 'istanbul', 'dubai', 'singapore', 'sydney'];

export function routeLayout(W, H) {
  const padX = 24;
  const gap = Math.max(18, W * 0.07);
  const bw = (W - padX * 2 - gap) / 2;
  const top = 18;
  const bottom = 4;
  const rowH = (H - top - bottom) / 6;
  const bh = Math.max(38, rowH - 6);
  const pos = {};
  NORTH.forEach((id, i) => { pos[id] = { x: padX, y: top + i * rowH + (rowH - bh) / 2, w: bw, h: bh }; });
  SOUTH.forEach((id, i) => { pos[id] = { x: padX + bw + gap, y: top + i * rowH + (rowH - bh) / 2, w: bw, h: bh }; });
  for (const p of Object.values(pos)) { p.cx = p.x + p.w / 2; p.cy = p.y + p.h / 2; }
  return { pos, W, H, padX, gap, bw, top };
}

export function routeMapSVG(ctx, W, H) {
  const { s, v } = ctx;
  const lay = routeLayout(W, H);
  const P = lay.pos;
  const out = [];
  out.push(`<rect width="${W}" height="${H}" fill="#14262b"/>`);
  out.push(`<text x="${P.ny.cx}" y="13" text-anchor="middle" class="rm-col">北ルート</text><text x="${P.rio.cx}" y="13" text-anchor="middle" class="rm-col">南ルート</text>`);

  // 線路
  for (const [a, b, wrap] of G.EDGES) {
    const A1 = P[a];
    const B1 = P[b];
    if (wrap) {
      const left = NORTH.includes(a);
      const ex = left ? 8 : W - 8;
      const sx = left ? A1.x : A1.x + A1.w;
      const tx = left ? B1.x : B1.x + B1.w;
      const d = `M${sx} ${A1.cy} H${ex} V${B1.cy} H${tx}`;
      out.push(`<path d="${d}" class="rm-line wrap"/>`);
      const my = (A1.cy + B1.cy) / 2;
      out.push(`<text x="${ex + (left ? 4 : -4)}" y="${my}" class="rm-wrap" transform="rotate(${left ? -90 : 90} ${ex + (left ? 4 : -4)} ${my})" text-anchor="middle">太平洋航路</text>`);
    } else {
      out.push(`<line x1="${A1.cx}" y1="${A1.cy}" x2="${B1.cx}" y2="${B1.cy}" class="rm-line"/>`);
    }
  }

  // 直前の移動
  const L = s.last;
  if (L && L.type === 'move' && !L.extract && P[L.from] && P[L.to] && G.neighbors(L.from).includes(L.to)) {
    const isWrap = G.EDGES.some(([x, y, w]) => w && ((x === L.from && y === L.to) || (y === L.from && x === L.to)));
    if (!isWrap) {
      const ag = s.agents.find((x) => x.id === L.agent);
      const color = ag ? s.players[ag.owner].color : '#fff';
      const a1 = P[L.from];
      const b1 = P[L.to];
      out.push(`<line x1="${a1.cx}" y1="${a1.cy}" x2="${b1.cx}" y2="${b1.cy}" class="last-arrow" stroke="${color}"/>`);
    }
  }

  const tokens = tokensByCity(ctx);
  for (const c of G.CITIES) {
    const p = P[c.id];
    const owner = s.players.find((pl) => pl.base === c.id);
    const cls = ['rcity'];
    if (ctx.reachable.has(c.id)) cls.push('reach');
    if (ctx.cityPick.has(c.id)) cls.push('pick');
    if (ctx.focusCity === c.id) cls.push('focus');
    const g = [];
    g.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="5" class="rbox"/>`);
    if (owner) g.push(`<rect x="${p.x}" y="${p.y}" width="6" height="${p.h}" rx="2" fill="${owner.color}" opacity="${owner.out ? 0.4 : 1}"/>`);
    // 都市名
    g.push(`<text x="${p.x + (owner ? 12 : 8)}" y="${p.y + 15}" class="rm-name">${esc(c.name)}${owner ? `<tspan class="rm-hq" fill="${owner.color}" dx="4">拠点</tspan>` : ''}</text>`);
    // ファイル・罠・罠の気配（右上）
    let rx = p.x + p.w - 4;
    const files = s.cityFiles[c.id];
    if (files.length) {
      const f = files[0];
      const k = G.knownFile(s, v, f);
      rx -= 22;
      g.push(`<g transform="translate(${rx} ${p.y + 3})">${A.folderShape(k === true ? 'real' : k === false ? 'fake' : 'unknown', 20)}</g>`);
      if (files.length > 1) g.push(`<text x="${rx - 2}" y="${p.y + 15}" text-anchor="end" class="rm-count">×${files.length}</text>`);
      rx -= files.length > 1 ? 18 : 2;
    }
    for (const t of ctx.traps.filter((t) => t.city === c.id)) {
      rx -= 20;
      g.push(`<g transform="translate(${rx + 10} ${p.y + 12}) scale(.8)">${A.trapShape(s.players[t.owner].color)}</g>`);
    }
    for (const h of ctx.hints.filter((h) => h.cities.includes(c.id))) {
      rx -= 15;
      g.push(`<g class="hint-q"><circle cx="${rx + 7}" cy="${p.y + 11}" r="6.5" fill="${s.players[h.owner].color}" stroke="#fff" stroke-width=".8"/><text x="${rx + 7}" y="${p.y + 14.5}">?</text></g>`);
    }
    // 駒（下側に並べる）
    const list = tokens[c.id] || [];
    if (list.length) {
      const areaTop = p.y + 19;
      const areaH = p.y + p.h - areaTop - 2;
      const scale = Math.max(0.5, Math.min(0.95, (areaH - 2) / 40));
      const step = 26 * scale + 3;
      const maxN = Math.max(1, Math.floor((p.w - 10) / step));
      const shown = list.length > maxN ? list.slice(0, maxN - 1) : list;
      const cy = areaTop + areaH / 2 + 2 * scale;
      shown.forEach((e, i) => {
        const x = p.x + 8 + step / 2 + i * step;
        g.push(e.ghost ? ghostTokenSVG(ctx, e.a, x, cy, scale, c.id) : agentTokenSVG(ctx, e.a, x, cy, scale));
      });
      if (list.length > shown.length) {
        g.push(`<text x="${p.x + p.w - 8}" y="${cy + 4}" text-anchor="end" class="rm-more">+${list.length - shown.length}</text>`);
      }
    }
    out.push(`<g class="${cls.join(' ')}" data-city="${c.id}"><title>${esc(c.name)}${owner ? `（${esc(owner.name)}の拠点）` : ''}</title>${g.join('')}</g>`);
  }

  // 罠・拘束・奪取・検問の演出
  if (ctx.fresh && L && L.city && P[L.city] && (L.type === 'trap' || (L.type === 'card' && ['arrest', 'steal', 'checkpoint'].includes(L.card)))) {
    const p = P[L.city];
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = i % 2 ? 12 : 28;
      pts.push(`${(p.cx + r * Math.cos(a)).toFixed(1)},${(p.cy + r * Math.sin(a)).toFixed(1)}`);
    }
    out.push(`<polygon points="${pts.join(' ')}" fill="#ffd54f" stroke="#b3261e" stroke-width="2.5" class="burst" pointer-events="none"/>`);
  }
  return out.join('');
}

// 路線図上の都市の中心（ドラッグ移動などで使う）
export function routeCityCenter(W, H, cityId) {
  return routeLayout(W, H).pos[cityId];
}
