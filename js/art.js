// イラスト集（すべて手描きのインライン SVG）
// 線は「インク色」、塗りは紙・マニラ封筒・朱色のスタンプを基調にしている。

const INK = '#2b2620';
const PAPER = '#fbf6e9';
const MANILA = '#e5c578';
const MANILA_D = '#c9a253';
const STAMP = '#b3261e';
const SKIN = '#f1d9b5';

const svg = (vb, body, cls = '', extra = '') => `<svg class="${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ${extra}>${body}</svg>`;

// ---------- 工作員（トレンチコートと中折れ帽） ----------
// 原点を中心に、足元が y=16、帽子のてっぺんが y=-20 くらい
export function agentShape(color, label = '', { shadow = true } = {}) {
  return `${shadow ? '<ellipse cx="0" cy="16" rx="11" ry="3" fill="#000" opacity=".22"/>' : ''}
  <path d="M-9.5 15.5 L-7.6 -1.5 Q0 -6.2 7.6 -1.5 L9.5 15.5 Z" fill="${color}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M0 -3.6 L-3.6 4.2 M0 -3.6 L3.6 4.2" stroke="${INK}" stroke-width="1" opacity=".45" fill="none"/>
  <path d="M-8.4 7 L8.4 7" stroke="${INK}" stroke-width="1.8" opacity=".5"/>
  <circle cx="0" cy="-8" r="5" fill="${SKIN}" stroke="${INK}" stroke-width="1.2"/>
  <rect x="-3.9" y="-8.9" width="7.8" height="2.1" rx="1" fill="${INK}"/>
  <path d="M-5.3 -11.4 L-4.6 -18.2 Q0 -20.4 4.6 -18.2 L5.3 -11.4 Z" fill="${INK}"/>
  <rect x="-5.1" y="-13.6" width="10.2" height="1.9" fill="${color}"/>
  <path d="M-9.4 -10.6 Q0 -14 9.4 -10.6 L9.4 -9.6 Q0 -12.2 -9.4 -9.6 Z" fill="${INK}"/>
  ${label ? `<text x="0" y="13.2" text-anchor="middle" font-size="8.5" font-weight="800" fill="#fff" font-family="'Zen Kaku Gothic New', sans-serif">${label}</text>` : ''}`;
}

export function agentSVG(color, label = '', cls = 'agent-ico') {
  return svg('-13 -22 26 41', agentShape(color, label), cls);
}

// 本物バッジ（金の星）と囮バッジ（仮面）
export function aceBadge(x = 0, y = 0, r = 6.5) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<circle cx="${x}" cy="${y}" r="${r + 1.6}" fill="${PAPER}" stroke="${INK}" stroke-width="1"/><polygon points="${pts.join(' ')}" fill="#e2a610" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>`;
}
export function decoyBadge(x = 0, y = 0, r = 6.5) {
  return `<circle cx="${x}" cy="${y}" r="${r + 1.6}" fill="${PAPER}" stroke="${INK}" stroke-width="1"/>
  <path d="M${x - r * 0.95} ${y - r * 0.35} Q${x} ${y - r * 0.75} ${x + r * 0.95} ${y - r * 0.35} Q${x + r * 0.85} ${y + r * 0.55} ${x + r * 0.2} ${y + r * 0.35} Q${x} ${y + r * 0.1} ${x - r * 0.2} ${y + r * 0.35} Q${x - r * 0.85} ${y + r * 0.55} ${x - r * 0.95} ${y - r * 0.35} Z" fill="#6d6a75" stroke="${INK}" stroke-width=".7"/>
  <ellipse cx="${x - r * 0.42}" cy="${y - r * 0.08}" rx="${r * 0.24}" ry="${r * 0.15}" fill="${PAPER}"/><ellipse cx="${x + r * 0.42}" cy="${y - r * 0.08}" rx="${r * 0.24}" ry="${r * 0.15}" fill="${PAPER}"/>`;
}
export const aceSVG = (cls = 'badge-ico') => svg('-9 -9 18 18', aceBadge(0, 0, 6.5), cls);
export const decoySVG = (cls = 'badge-ico') => svg('-9 -9 18 18', decoyBadge(0, 0, 6.5), cls);

// ---------- 機密ファイル（マニラフォルダー） ----------
// kind: 'unknown' | 'real' | 'fake'
export function folderShape(kind = 'unknown', w = 40) {
  const s = w / 40;
  const stamp = kind === 'real'
    ? `<g transform="rotate(-12 20 21)"><rect x="8" y="15" width="24" height="11" rx="2" fill="none" stroke="${STAMP}" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="8.5" font-weight="900" fill="${STAMP}" font-family="'Zen Kaku Gothic New', sans-serif">本物</text></g>`
    : kind === 'fake'
      ? `<g transform="rotate(-12 20 21)"><rect x="11" y="15" width="18" height="11" rx="2" fill="none" stroke="#5f5a52" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="8.5" font-weight="900" fill="#5f5a52" font-family="'Zen Kaku Gothic New', sans-serif">偽</text></g>`
      : `<g transform="rotate(-8 20 21)"><rect x="9" y="16" width="22" height="9" rx="1.5" fill="none" stroke="${STAMP}" stroke-width="1.3" opacity=".8"/><text x="20" y="23.2" text-anchor="middle" font-size="6.5" font-weight="900" fill="${STAMP}" opacity=".85" font-family="'Zen Kaku Gothic New', sans-serif">極秘</text></g>`;
  return `<g transform="scale(${s})"><path d="M2 5 H14 L17 8.5 H38 V30 H2 Z" fill="${MANILA_D}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>
  <rect x="2" y="10" width="36" height="20" rx="1.5" fill="${MANILA}" stroke="${INK}" stroke-width="1.3"/>${stamp}</g>`;
}
export const folderSVG = (kind = 'unknown', cls = 'folder-ico') => svg('0 3 40 28', folderShape(kind), cls);

// ---------- 拠点（隠れ家と旗） ----------
export function baseShape(color) {
  return `<ellipse cx="0" cy="13" rx="17" ry="3.5" fill="#000" opacity=".18"/>
  <path d="M-13 12 V-1 L0 -11 L13 -1 V12 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M-15.5 0 L0 -12.5 L15.5 0" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="-4" y="3" width="8" height="9" fill="${INK}"/>
  <path d="M9 -6 V-25" stroke="${INK}" stroke-width="1.6"/>
  <path d="M9 -25 L21 -21 L9 -17 Z" fill="${color}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`;
}

// ---------- 罠（トラバサミ） ----------
export function trapShape(color = INK) {
  const teeth = [];
  for (let i = 0; i < 7; i++) {
    const x = -9 + i * 3;
    teeth.push(`${x},0 ${x + 1.5},-3.5`);
  }
  return `<ellipse cx="0" cy="3" rx="11" ry="3" fill="#000" opacity=".2"/>
  <path d="M-11 1 Q0 9 11 1" fill="none" stroke="${INK}" stroke-width="2.2"/>
  <path d="M-11 0 Q0 -10 11 0" fill="none" stroke="${INK}" stroke-width="2.2"/>
  <polyline points="${teeth.join(' ')} 12,0" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
  <circle cx="0" cy="1" r="3" fill="${color}" stroke="${INK}" stroke-width="1"/>`;
}
export const trapSVG = (color, cls = 'trap-ico') => svg('-13 -11 26 17', trapShape(color), cls);

// ---------- カードのイラスト（64x64） ----------
const CARD_ART = {
  interrogate: `
    <path d="M32 2 V12" stroke="${INK}" stroke-width="2"/>
    <path d="M20 22 L25 12 H39 L44 22 Z" fill="#3f4a3c" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M21 22 L8 62 H56 L43 22 Z" fill="#f7e27c" opacity=".55"/>
    <ellipse cx="32" cy="22" rx="12" ry="2.5" fill="#fff6c4" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="32" cy="40" r="6.5" fill="${SKIN}" stroke="${INK}" stroke-width="1.6"/>
    <path d="M20 60 Q20 48 32 48 Q44 48 44 60" fill="#7b7466" stroke="${INK}" stroke-width="1.6"/>
    <path d="M29 39.5 h2 M33 39.5 h2" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M30 43.5 q2 -1.4 4 0" stroke="${INK}" stroke-width="1.2" fill="none"/>
    <text x="49" y="40" font-size="13" font-weight="900" fill="${STAMP}" font-family="'Dela Gothic One', sans-serif">?</text>`,
  arrest: `
    <circle cx="20" cy="38" r="12" fill="none" stroke="#8d939a" stroke-width="6"/>
    <circle cx="20" cy="38" r="12" fill="none" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="20" cy="38" r="6" fill="none" stroke="${INK}" stroke-width="1.2"/>
    <circle cx="44" cy="26" r="12" fill="none" stroke="#8d939a" stroke-width="6"/>
    <circle cx="44" cy="26" r="12" fill="none" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="44" cy="26" r="6" fill="none" stroke="${INK}" stroke-width="1.2"/>
    <path d="M29 31 l3 -1.5 l3 1.5 l3 -1.5" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="12" y="49" width="16" height="5" rx="1.5" fill="#8d939a" stroke="${INK}" stroke-width="1.2"/>
    <rect x="36" y="12" width="16" height="5" rx="1.5" fill="#8d939a" stroke="${INK}" stroke-width="1.2" transform="rotate(-10 44 14)"/>`,
  steal: `
    <g transform="rotate(-10 34 30)">${folderShape('unknown', 34).replace('<g transform="scale(0.85)">', '<g transform="translate(22 14) scale(0.85)">')}</g>
    <path d="M4 50 Q14 46 20 40 L28 33 Q31 31 32.5 33.5 Q33.5 35.5 31 37.5 L27 41 L37 37 Q40 36 41 38.5 Q41.5 41 38.5 42 L30 45 Q22 52 14 56 Z" fill="${SKIN}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M2 49 L14 56 L10 62 L0 56 Z" fill="${INK}"/>
    <path d="M44 10 l4 -4 M50 16 l6 -2 M47 12 l6 -6" stroke="${STAMP}" stroke-width="2" stroke-linecap="round"/>`,
  trap: `
    <ellipse cx="32" cy="48" rx="26" ry="7" fill="#000" opacity=".15"/>
    <path d="M8 44 Q32 62 56 44" fill="#9aa0a6" stroke="${INK}" stroke-width="2"/>
    <path d="M8 42 Q32 18 56 42" fill="none" stroke="${INK}" stroke-width="3"/>
    <polyline points="10,42 13,34 16,42 19,31 22,42 25,29 28,42 31,28 34,42 37,29 40,42 43,31 46,42 49,34 52,42 55,38" fill="#e4e7ea" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="32" cy="46" r="5" fill="${STAMP}" stroke="${INK}" stroke-width="1.4"/>
    <path d="M56 46 q6 2 6 8" fill="none" stroke="${INK}" stroke-width="1.6" stroke-dasharray="2 2"/>`,
  wiretap: `
    <path d="M14 38 Q14 12 32 12 Q50 12 50 38" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M14 38 Q14 12 32 12 Q50 12 50 38" fill="none" stroke="#5a6b7a" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="8" y="34" width="11" height="17" rx="4" fill="#5a6b7a" stroke="${INK}" stroke-width="1.6"/>
    <rect x="45" y="34" width="11" height="17" rx="4" fill="#5a6b7a" stroke="${INK}" stroke-width="1.6"/>
    <path d="M24 46 q4 -6 0 -12 M29 49 q7 -9 0 -18 M34 52 q10 -12 0 -24" fill="none" stroke="${STAMP}" stroke-width="1.8" stroke-linecap="round"/>`,
  disguise: `
    <circle cx="20" cy="26" r="9" fill="#cfe3e8" stroke="${INK}" stroke-width="2.4"/>
    <circle cx="44" cy="26" r="9" fill="#cfe3e8" stroke="${INK}" stroke-width="2.4"/>
    <path d="M29 25 Q32 22 35 25" fill="none" stroke="${INK}" stroke-width="2.4"/>
    <path d="M11 24 L4 21 M53 24 L60 21" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M32 28 Q36 38 33 42 Q30 43 29 40" fill="${SKIN}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M16 48 Q24 41 32 46 Q40 41 48 48 Q40 51 32 48 Q24 51 16 48 Z" fill="${INK}"/>
    <path d="M15 14 Q20 10 26 13 M38 13 Q44 10 49 14" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  extract: `
    <path d="M6 13 H58" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M32 13 V19" stroke="${INK}" stroke-width="2"/>
    <path d="M14 34 Q14 20 30 19 H38 Q46 20 48 30 L48 36 Q46 40 40 40 H22 Q14 40 14 34 Z" fill="#46705a" stroke="${INK}" stroke-width="1.8"/>
    <path d="M38 22 Q45 23 46 31 H36 Z" fill="#cfe3e8" stroke="${INK}" stroke-width="1.2"/>
    <path d="M14 30 H2 L0 24" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M20 40 V46 M40 40 V46 M14 46 H48" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M30 46 V54" stroke="${INK}" stroke-width="1.2" stroke-dasharray="2 2"/>
    <g transform="translate(30 58) scale(.42)">${agentShape('#555', '', { shadow: false })}</g>`,
};

export function cardArtSVG(type, cls = 'card-art') {
  return svg('0 0 64 64', CARD_ART[type] || '', cls);
}

// カードの裏（山札）
export function cardBackSVG(cls = 'card-back') {
  return svg('0 0 64 88', `
    <rect x="2" y="2" width="60" height="84" rx="6" fill="#2f3b33" stroke="${INK}" stroke-width="2"/>
    <rect x="7" y="7" width="50" height="74" rx="4" fill="none" stroke="${MANILA}" stroke-width="1.2" stroke-dasharray="3 2"/>
    <g transform="translate(32 40) scale(1.25)">${agentShape('#8b1f1a', '', { shadow: false })}</g>
    <text x="32" y="74" text-anchor="middle" font-size="9" fill="${MANILA}" font-family="'Special Elite', monospace" letter-spacing="1">CLASSIFIED</text>`, cls);
}

// ---------- アイコン（24x24、線画） ----------
const ICONS = {
  move: `<path d="M5 16 q-1 -4 2 -5 q3 -1 3 3 q0 3 -2 4 q-2 1 -3 -2 Z M7 20 h2" fill="${INK}"/><path d="M14 9 q-1 -4 2 -5 q3 -1 3 3 q0 3 -2 4 q-2 1 -3 -2 Z M16 13 h2" fill="${INK}"/>`,
  scout: `<circle cx="10" cy="10" r="6" fill="#cfe3e8" stroke="${INK}" stroke-width="2"/><path d="M14.5 14.5 L21 21" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  infiltrate: `<path d="M3 8 H9 L11 10 H21 V20 H3 Z" fill="${MANILA}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 2 V12 M8.5 8.5 L12 12 L15.5 8.5" stroke="${STAMP}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  drop: `<path d="M3 12 H9 L11 14 H21 V22 H3 Z" fill="${MANILA}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10 V2 M8.5 5.5 L12 2 L15.5 5.5" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  transfer: `<path d="M3 8 H18 M14 4 L18 8 L14 12 M21 16 H6 M10 12 L6 16 L10 20" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  end: `<path d="M6 21 V3" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><path d="M6 4 H19 L16 8 L19 12 H6 Z" fill="${STAMP}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`,
  deck: `<rect x="7" y="3" width="12" height="17" rx="2" fill="#2f3b33" stroke="${INK}" stroke-width="1.4"/><rect x="4" y="5" width="12" height="17" rx="2" fill="#3e5045" stroke="${INK}" stroke-width="1.4"/>`,
  market: `<rect x="2" y="6" width="9" height="13" rx="1.5" fill="${PAPER}" stroke="${INK}" stroke-width="1.3" transform="rotate(-12 6 12)"/><rect x="8" y="4" width="9" height="13" rx="1.5" fill="${PAPER}" stroke="${INK}" stroke-width="1.3"/><rect x="13" y="6" width="9" height="13" rx="1.5" fill="${PAPER}" stroke="${INK}" stroke-width="1.3" transform="rotate(12 18 12)"/>`,
  eye: `<path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.8"/><circle cx="12" cy="12" r="3.5" fill="${INK}"/>`,
  lock: `<rect x="5" y="10" width="14" height="11" rx="2" fill="${STAMP}" stroke="${INK}" stroke-width="1.4"/><path d="M8 10 V7 Q8 3 12 3 Q16 3 16 7 V10" fill="none" stroke="${INK}" stroke-width="2"/>`,
  cards: `<rect x="3" y="5" width="11" height="15" rx="2" fill="${PAPER}" stroke="${INK}" stroke-width="1.4" transform="rotate(-10 8 12)"/><rect x="10" y="4" width="11" height="15" rx="2" fill="${PAPER}" stroke="${INK}" stroke-width="1.4"/>`,
  cpu: `<rect x="5" y="6" width="14" height="12" rx="3" fill="#cfd6dc" stroke="${INK}" stroke-width="1.5"/><circle cx="9.5" cy="12" r="1.6" fill="${INK}"/><circle cx="14.5" cy="12" r="1.6" fill="${INK}"/><path d="M12 6 V3 M9 21 h6" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  person: `<circle cx="12" cy="8" r="4" fill="${SKIN}" stroke="${INK}" stroke-width="1.5"/><path d="M4 21 Q4 13 12 13 Q20 13 20 21 Z" fill="#7b7466" stroke="${INK}" stroke-width="1.5"/>`,
  globe: `<circle cx="12" cy="12" r="9" fill="#cfe3df" stroke="${INK}" stroke-width="1.6"/><path d="M3 12 H21 M12 3 Q7 12 12 21 Q17 12 12 3" fill="none" stroke="${INK}" stroke-width="1.2"/>`,
  door: `<rect x="5" y="3" width="14" height="18" rx="1" fill="${MANILA}" stroke="${INK}" stroke-width="1.6"/><circle cx="15" cy="12" r="1.3" fill="${INK}"/>`,
  book: `<path d="M3 5 Q8 3 12 6 Q16 3 21 5 V19 Q16 17 12 20 Q8 17 3 19 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 6 V20" stroke="${INK}" stroke-width="1.2"/>`,
  flag: `<path d="M6 21 V3" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><path d="M6 4 H19 L16 8 L19 12 H6 Z" fill="${STAMP}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`,
  question: `<circle cx="12" cy="12" r="9" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="900" fill="${INK}" font-family="sans-serif">?</text>`,
};
export function icon(name, cls = 'ico') { return svg('0 0 24 24', ICONS[name] || '', cls); }

// ---------- 地図の装飾 ----------
// 大陸（ざっくりとした古地図風の形）
export const CONTINENTS = [
  // 北アメリカ
  'M55 70 Q120 40 210 42 Q300 38 345 70 Q360 100 318 128 Q300 150 290 190 Q262 230 228 262 Q205 285 190 300 Q170 286 160 255 Q120 215 92 185 Q60 150 50 110 Z',
  // グリーンランド
  'M330 30 Q370 22 395 34 Q392 58 362 66 Q338 58 330 30 Z',
  // 南アメリカ
  'M255 300 Q300 296 330 318 Q370 340 372 372 Q360 410 330 440 Q308 470 292 470 Q282 440 272 405 Q250 360 255 300 Z',
  // ヨーロッパ
  'M418 92 Q430 70 470 62 Q520 50 570 58 Q610 52 640 70 Q600 110 600 150 Q585 172 560 176 Q530 170 506 168 Q478 160 458 150 Q430 140 418 120 Z',
  // イギリス
  'M432 84 Q446 74 452 90 Q450 112 438 114 Q428 102 432 84 Z',
  // アフリカ
  'M410 200 Q450 190 500 200 Q545 196 580 230 Q615 262 610 300 Q600 340 575 380 Q556 430 532 448 Q510 440 498 400 Q478 352 452 316 Q420 280 405 245 Z',
  // アジア
  'M600 60 Q680 34 780 36 Q880 40 950 70 Q985 110 950 150 Q930 180 900 210 Q872 238 850 262 Q832 300 808 320 Q785 300 770 280 Q740 290 712 296 Q690 262 650 250 Q615 236 598 210 Q588 180 606 150 Q640 110 600 60 Z',
  // アラビア
  'M630 238 Q668 248 700 270 Q712 300 690 322 Q660 330 640 300 Q628 270 630 238 Z',
  // インド
  'M712 262 Q750 266 770 286 Q760 320 742 340 Q722 318 712 290 Z',
  // 東南アジアの島々
  'M776 336 Q800 330 822 342 Q842 356 830 366 Q804 366 782 356 Z',
  'M840 352 Q870 344 892 358 Q880 372 852 370 Z',
  // 日本
  'M902 150 Q918 154 920 170 Q916 190 904 204 Q896 196 898 178 Z',
  // オーストラリア
  'M842 392 Q880 372 930 380 Q968 392 972 428 Q960 462 916 466 Q872 462 850 440 Q834 418 842 392 Z',
];

export function compassSVG(x, y, r = 26) {
  return `<g transform="translate(${x} ${y})" opacity=".85">
    <circle r="${r}" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/>
    <circle r="${r - 5}" fill="none" stroke="${INK}" stroke-width=".6" stroke-dasharray="2 2"/>
    <path d="M0 ${-r + 3} L5 0 L0 ${r - 3} L-5 0 Z" fill="${INK}"/>
    <path d="M0 ${-r + 3} L5 0 L-5 0 Z" fill="${STAMP}"/>
    <path d="M${-r + 3} 0 L0 4 L${r - 3} 0 L0 -4 Z" fill="${INK}" opacity=".55"/>
    <text y="${-r - 4}" text-anchor="middle" font-size="10" font-family="'Special Elite', monospace" fill="${INK}">N</text>
  </g>`;
}

// ---------- タイトルのイラスト ----------
export function heroSVG() {
  const routes = 'M10 120 Q90 60 170 100 T330 70';
  return svg('0 0 360 210', `
    <defs>
      <pattern id="hgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 H0 V20" fill="none" stroke="#b9a77f" stroke-width=".5" opacity=".6"/></pattern>
    </defs>
    <rect x="0" y="0" width="360" height="210" fill="url(#hgrid)"/>
    <path d="${routes}" fill="none" stroke="${STAMP}" stroke-width="1.6" stroke-dasharray="5 4" opacity=".6"/>
    <circle cx="170" cy="100" r="4" fill="${STAMP}" opacity=".7"/><circle cx="330" cy="70" r="4" fill="${STAMP}" opacity=".7"/>
    <g transform="translate(30 70) rotate(-8)">
      <rect x="6" y="10" width="190" height="124" rx="4" fill="#000" opacity=".15"/>
      <path d="M0 6 H64 L76 18 H190 V130 H0 Z" fill="${MANILA_D}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <rect x="0" y="22" width="190" height="108" rx="3" fill="${MANILA}" stroke="${INK}" stroke-width="2"/>
      <rect x="14" y="36" width="96" height="8" rx="2" fill="${INK}" opacity=".25"/>
      <rect x="14" y="52" width="70" height="6" rx="2" fill="${INK}" opacity=".18"/>
      <rect x="14" y="64" width="84" height="6" rx="2" fill="${INK}" opacity=".18"/>
      <g transform="rotate(-14 120 96)"><rect x="70" y="80" width="104" height="34" rx="4" fill="none" stroke="${STAMP}" stroke-width="3.5"/>
      <text x="122" y="105" text-anchor="middle" font-size="22" fill="${STAMP}" font-family="'Dela Gothic One', sans-serif">極秘</text></g>
      <rect x="128" y="30" width="44" height="54" fill="${PAPER}" stroke="${INK}" stroke-width="1.4" transform="rotate(6 150 57)"/>
      <g transform="translate(150 62) rotate(6) scale(1.3)">${agentShape('#555', '', { shadow: false })}</g>
      <path d="M126 28 l6 -8 l8 6" fill="none" stroke="#8d939a" stroke-width="3"/>
    </g>
    <g transform="translate(286 150) scale(3)">${agentShape('#c62828', '')}</g>
    <g transform="translate(258 158)"><circle r="16" fill="#cfe3e8" opacity=".55" stroke="${INK}" stroke-width="3"/><path d="M11 11 L26 26" stroke="${INK}" stroke-width="6" stroke-linecap="round"/></g>`, 'hero-art');
}

// ---------- 遊び方のイラスト ----------
export function tutorialArt(page) {
  const A = (x, y, c, l, s = 1.6) => `<g transform="translate(${x} ${y}) scale(${s})">${agentShape(c, l)}</g>`;
  const F = (x, y, k, w = 34) => `<g transform="translate(${x} ${y})">${folderShape(k, w)}</g>`;
  switch (page) {
    case 'goal':
      return svg('0 0 320 150', `
        ${A(70, 82, '#c62828', 'A', 2.2)}<g transform="translate(88 30)">${aceBadge(0, 0, 9)}</g>
        ${F(30, 98, 'real')}${F(80, 98, 'real')}
        <path d="M140 80 H200" stroke="${INK}" stroke-width="3" stroke-dasharray="6 5"/><path d="M196 72 L210 80 L196 88 Z" fill="${INK}"/>
        <g transform="translate(260 86) scale(2.2)">${baseShape('#c62828')}</g>
        <text x="260" y="140" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}">自分の拠点</text>`, 'tut-art');
    case 'identity':
      return svg('0 0 320 150', `
        ${A(70, 80, '#1565c0', 'A', 2.2)}${A(160, 80, '#1565c0', 'B', 2.2)}${A(250, 80, '#1565c0', 'C', 2.2)}
        <g transform="translate(90 30)">${decoyBadge(0, 0, 9)}</g>
        <g transform="translate(180 30)">${aceBadge(0, 0, 9)}</g>
        <g transform="translate(270 30)">${decoyBadge(0, 0, 9)}</g>
        <text x="70" y="140" text-anchor="middle" font-size="13" fill="${INK}">囮</text>
        <text x="160" y="140" text-anchor="middle" font-size="13" font-weight="800" fill="${STAMP}">本物</text>
        <text x="250" y="140" text-anchor="middle" font-size="13" fill="${INK}">囮</text>`, 'tut-art');
    case 'files':
      return svg('0 0 320 150', `
        ${F(30, 28, 'unknown', 70)}
        <text x="65" y="118" text-anchor="middle" font-size="12" fill="${INK}">中身は不明</text>
        <path d="M118 62 H146" stroke="${INK}" stroke-width="2.5"/><path d="M143 56 L152 62 L143 68 Z" fill="${INK}"/>
        ${F(160, 18, 'real', 60)}${F(232, 48, 'fake', 60)}
        <text x="190" y="118" text-anchor="middle" font-size="12" font-weight="800" fill="${STAMP}">本物</text>
        <text x="262" y="134" text-anchor="middle" font-size="12" fill="#5f5a52">偽情報</text>`, 'tut-art');
    case 'turn':
      return svg('0 0 320 150', `
        <g transform="translate(10 18)">${cardMini('arrest', 0)}${cardMini('trap', 22)}</g>
        <text x="50" y="140" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">① カードを引く</text>
        <g transform="translate(118 46) scale(2.4)">${ICONS.move}</g><g transform="translate(160 46) scale(2.4)">${ICONS.scout}</g>
        <text x="168" y="140" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">② 行動を2回</text>
        <g transform="translate(240 46) scale(2.4)">${ICONS.end}</g>
        <text x="272" y="140" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">③ 次の人へ</text>`, 'tut-art');
    case 'trap':
      return svg('0 0 320 150', `
        <rect x="0" y="0" width="320" height="150" fill="#d5e6e2"/>
        <path d="M60 75 H160 M160 75 L250 40 M160 75 L250 115" stroke="#8a6b45" stroke-width="3"/>
        <circle cx="60" cy="75" r="12" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>
        ${[[160, 75], [250, 40], [250, 115]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="${PAPER}" stroke="${INK}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="22" fill="none" stroke="#6a1b9a" stroke-width="2.5" stroke-dasharray="4 4"/><g transform="translate(${x + 16} ${y - 18})"><circle r="9" fill="#6a1b9a"/><text y="5" text-anchor="middle" font-size="13" font-weight="900" fill="#fff">?</text></g>`).join('')}
        ${A(160, 60, '#6a1b9a', 'B', 1.4)}
        ${A(60, 60, '#c62828', 'A', 1.4)}
        <text x="60" y="112" text-anchor="middle" font-size="12" fill="${INK}">ここに入る？</text>`, 'tut-art');
    default:
      return '';
  }
}

function cardMini(type, dx) {
  return `<g transform="translate(${dx} ${dx / 3}) rotate(${dx ? 8 : -6} 30 45)"><rect x="0" y="0" width="60" height="86" rx="5" fill="${PAPER}" stroke="${INK}" stroke-width="1.6"/><g transform="translate(6 6) scale(.75)">${CARD_ART[type]}</g></g>`;
}

// ---------- 演出用の大きなスタンプ ----------
export function stampSVG(text, color = STAMP) {
  return svg('-6 -16 312 152', `<g transform="rotate(-8 150 60)"><rect x="12" y="14" width="276" height="92" rx="10" fill="none" stroke="${color}" stroke-width="8"/>
    <rect x="24" y="26" width="252" height="68" rx="6" fill="none" stroke="${color}" stroke-width="2"/>
    <text x="150" y="80" text-anchor="middle" font-size="44" fill="${color}" font-family="'Dela Gothic One', sans-serif">${text}</text></g>`, 'stamp-art');
}

// 凡例などに使う小さな SVG
export const svgTiny = (body, vb) => svg(vb, body, 'tiny-ico');
