// Player avatars, drawn as SVG from four numbers: skin, hair style, hair/fabric tone, gear.
export const COUNTS = { skin: 6, hair: 10, tone: 6, gear: 6 };
export const HAIR_NAMES = ['Buzz', 'Crop', 'Sweep', 'Curls', 'Afro', 'Long', 'Locs', 'Bun', 'Hijab', 'Beanie'];
export const GEAR_NAMES = ['Hoodie', 'Jacket', 'Tech vest', 'Tee', 'Visor', 'Headphones'];

const SKIN = ['#F6D7C3', '#EEBF9F', '#D9A076', '#B97A50', '#8A5A3A', '#5C3A26'];
const TONE = ['#16131C', '#3A2A22', '#6E4A2E', '#D6B06A', '#A8452C', null];
const FABRIC = ['#1C2440', '#5A2A52', '#0F4A4A', '#D8D2C4', '#7A2330', null];
const CLOTH = '#1A2444', CLOTH2 = '#263363';

export const PRESETS = [
  { skin: 4, hair: 4, tone: 0, gear: 0 }, { skin: 1, hair: 5, tone: 2, gear: 1 }, { skin: 2, hair: 2, tone: 0, gear: 4 },
  { skin: 5, hair: 6, tone: 0, gear: 5 }, { skin: 0, hair: 1, tone: 3, gear: 2 }, { skin: 3, hair: 8, tone: 0, gear: 3 },
  { skin: 2, hair: 3, tone: 1, gear: 5 }, { skin: 5, hair: 0, tone: 0, gear: 1 }, { skin: 1, hair: 7, tone: 4, gear: 0 },
  { skin: 3, hair: 9, tone: 2, gear: 2 }, { skin: 0, hair: 5, tone: 5, gear: 4 }, { skin: 4, hair: 2, tone: 5, gear: 3 },
];

function hair(style, c) {
  switch (style) {
    case 0: return { front: `<path d="M38.5 50C38 28 82 28 81.5 50 76 39 44 39 38.5 50Z" fill="${c}" opacity=".85"/>` };
    case 1: return { front: `<path d="M37 55C33 22 87 22 83 55 80 44 74 37 60 37 46 37 40 44 37 55Z" fill="${c}"/>` };
    case 2: return { front: `<path d="M37 53C35 30 50 22 66 23 80 24 87 36 83 55 79 42 72 38 62 40 52 42 44 40 37 53Z" fill="${c}"/><path d="M42 31C52 14 78 16 84 35 72 25 56 25 42 31Z" fill="${c}"/>` };
    case 3: return { front: [[42, 41, 8], [50, 32, 9], [60, 29, 9.5], [70, 32, 9], [78, 41, 8], [38, 51, 6], [82, 51, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('') };
    case 4: return { back: `<circle cx="60" cy="44" r="33" fill="${c}"/>`, front: `<path d="M39 50C40 33 80 33 81 50 74 41 46 41 39 50Z" fill="${c}"/>` };
    case 5: return { back: `<path d="M34 56C29 18 91 18 86 56L89 100H31Z" fill="${c}"/>`, front: `<path d="M38 53C37 29 83 29 82 53 77 40 62 36 54 44 48 40 42 44 38 53Z" fill="${c}"/>` };
    case 6: return {
      back: [28, 35, 78, 85].map((x, i) => `<rect x="${x}" y="${40 + (i % 2) * 3}" width="7" height="${54 - (i % 2) * 6}" rx="3.5" fill="${c}"/>`).join(''),
      front: `<path d="M37 53C34 24 86 24 83 53 78 40 42 40 37 53Z" fill="${c}"/>` + [46, 53, 60, 67, 74].map((x) => `<path d="M${x} 27v12" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>`).join(''),
    };
    case 7: return { front: `<circle cx="60" cy="21" r="10" fill="${c}"/><path d="M37 55C33 24 87 24 83 55 80 44 74 38 60 38 46 38 40 44 37 55Z" fill="${c}"/>` };
    case 8: return { wrap: `<path d="M32 58C28 16 92 16 88 58 91 86 78 100 60 102 42 100 29 86 32 58Z" fill="${c}"/><path d="M40 34C50 26 70 26 80 34" stroke="rgba(255,255,255,.16)" stroke-width="2" fill="none"/>` };
    default: return { front: `<path d="M35 47C35 18 85 18 85 47Z" fill="${c}"/><rect x="34" y="42" width="52" height="10" rx="3" fill="ACCENT"/><circle cx="60" cy="19" r="5" fill="ACCENT"/>` };
  }
}

function gear(style, accent) {
  const body = `<path d="M12 130C12 104 34 92 60 92 86 92 108 104 108 130Z" fill="${CLOTH}"/>`;
  switch (style) {
    case 0: return { back: `<path d="M30 100C32 74 88 74 90 100Z" fill="${CLOTH2}"/>`, body: body + `<path d="M44 94C50 104 70 104 76 94" stroke="${accent}" stroke-width="3" fill="none"/><path d="M53 101v14M67 101v14" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>` };
    case 1: return { body: body + `<path d="M46 93L60 110 74 93 82 97 62 122H58L38 97Z" fill="${CLOTH2}"/><path d="M60 110V130" stroke="${accent}" stroke-width="3"/>` };
    case 2: return { body: body + `<path d="M38 96L46 130M82 96L74 130" stroke="${accent}" stroke-width="5"/><rect x="50" y="110" width="20" height="9" rx="2" fill="${accent}" opacity=".9"/><path d="M48 93C54 100 66 100 72 93" stroke="${CLOTH2}" stroke-width="4" fill="none"/>` };
    case 3: return { body: body + `<path d="M46 93C52 102 68 102 74 93" stroke="${accent}" stroke-width="3.5" fill="none"/>` };
    case 4: return { body: body + `<path d="M46 93C52 102 68 102 74 93" stroke="${CLOTH2}" stroke-width="4" fill="none"/>`, face: `<rect x="38" y="47" width="44" height="13" rx="6" fill="${accent}"/><rect x="42" y="50" width="20" height="3" rx="1.5" fill="rgba(255,255,255,.55)"/>` };
    default: return { body: body + `<path d="M46 93C52 102 68 102 74 93" stroke="${accent}" stroke-width="3.5" fill="none"/>`, top: `<path d="M36 56C32 14 88 14 84 56" stroke="#0B1228" stroke-width="6" fill="none"/><rect x="29" y="48" width="11" height="19" rx="5" fill="${accent}"/><rect x="80" y="48" width="11" height="19" rx="5" fill="${accent}"/>` };
  }
}

export function avatarSVG(a = {}, accent = '#2EE6F5', cls = '') {
  const skin = SKIN[a.skin % SKIN.length] || SKIN[2];
  const isCloth = a.hair === 8 || a.hair === 9;
  const tone = (isCloth ? FABRIC : TONE)[a.tone % 6] || accent;
  const h = hair(a.hair ?? 1, tone);
  const g = gear(a.gear ?? 0, accent);
  const eyes = g.face || `<rect x="49.5" y="52" width="5" height="7.5" rx="2.5" fill="#1A1420"/><rect x="65.5" y="52" width="5" height="7.5" rx="2.5" fill="#1A1420"/>`;
  const head = `<rect x="51" y="70" width="18" height="24" rx="6" fill="${skin}"/><rect x="51" y="70" width="18" height="24" rx="6" fill="rgba(0,0,0,.16)"/>
    <circle cx="38.5" cy="57" r="4.5" fill="${skin}"/><circle cx="81.5" cy="57" r="4.5" fill="${skin}"/>
    <ellipse cx="60" cy="54" rx="22" ry="26" fill="${skin}"/>`;
  const face = `${eyes}<path d="M54.5 68Q60 71 65.5 68" stroke="rgba(0,0,0,.34)" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  const wrap = h.wrap ? `${h.wrap}<ellipse cx="60" cy="56" rx="17.5" ry="21.5" fill="${skin}"/>` : '';
  return `<svg class="avatar ${cls}" viewBox="0 0 120 130" aria-hidden="true">${h.back || ''}${g.back || ''}${g.body}${head}${wrap}${face}${(h.front || '').replace(/ACCENT/g, accent)}${g.top || ''}</svg>`;
}
