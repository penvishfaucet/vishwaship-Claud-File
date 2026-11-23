// Builds Instagram carousel slides (1080x1350 PNG) from a JSON post spec.
// Usage: node marketing/instagram/build.js marketing/instagram/posts/2026-11-24/a.json
// Output: PNGs + slides.html next to the JSON, in a folder named after it.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// *word* in text becomes orange highlight
const hl = (s) => esc(s).replace(/\*(.+?)\*/g, '<em>$1</em>');

function slideHtml(s, i, n) {
  const num = i > 0 ? `<div class="num">${i + 1}/${n}</div>` : '';
  const next = i < n - 1 ? '<div class="next">»</div>' : '';
  const logos = s.couriers
    ? `<div class="strip">${s.couriers.map((c) => `<img src="${ROOT}/../../public/couriers/${c}.webp">`).join('')}</div>`
    : '';
  const chips = s.chips ? `<div class="chips">${s.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : '';
  const box = s.box ? `<div class="box"><p>${s.box.map(hl).join('<br>')}</p></div>` : '';
  const rule = s.rule ? '<div class="rule"></div>' : '';
  const foot = s.foot ? `<p class="foot">${s.foot.map(hl).join('<br>')}</p>` : '';
  const sub = s.sub ? `<p class="sub">${hl(s.sub)}</p>` : '';
  const cta = s.cta ? `<div class="cta">${esc(s.cta)}</div><p class="url">${esc(s.url || 'vishwaship.in')}</p>` : '';
  return `<section class="s">${num}<img class="logo" src="${ROOT}/logo.png" alt="">${logos}${s.kicker ? `<p class="kicker">${esc(s.kicker)}</p>` : ''}<h1>${hl(s.title)}</h1>${rule}${sub}${chips}${box}${foot}${cta}${next}</section>`;
}

const CSS = `
:root{--navy:#051C46;--orange:#FE6519;--btn:#C94A0A;--muted:#4a5a78;--line:#dbe3ee}
*{box-sizing:border-box;margin:0}
body{font-family:Archivo,sans-serif}
.s{width:1080px;height:1350px;position:relative;overflow:hidden;color:var(--navy);
  background:linear-gradient(rgba(5,28,70,.05) 1px,transparent 1px) 0 0/54px 54px,
   linear-gradient(90deg,rgba(5,28,70,.05) 1px,transparent 1px) 0 0/54px 54px,
   linear-gradient(180deg,#fffaf6 0%,#fff1e8 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding:250px 90px 140px;text-align:center}
.logo{height:150px;position:absolute;top:70px;left:50%;transform:translateX(-50%)}
.strip{margin-top:-20px}
.num{position:absolute;top:56px;right:56px;background:var(--navy);color:#fff;font-weight:600;font-size:28px;padding:10px 22px;border-radius:30px}
.kicker{font-size:34px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--btn);margin-bottom:26px}
h1{font-size:88px;line-height:1.1;font-weight:800;letter-spacing:-.02em}
h1 em,.foot em,.sub em,.box em{font-style:normal;color:var(--orange)}
.box{margin-top:64px;width:100%;background:#fff;border:3px solid var(--navy);border-radius:44px;padding:50px 30px;box-shadow:0 14px 0 var(--navy)}
.box p{font-size:62px;line-height:1.5;font-weight:500;color:var(--btn)}
.foot{margin-top:70px;font-size:56px;line-height:1.3;font-weight:700}
.rule{width:620px;height:5px;background:var(--orange);margin:50px auto;border-radius:3px}
.sub{font-size:52px;line-height:1.3;font-weight:500;color:var(--muted)}
.next{position:absolute;right:70px;bottom:70px;font-size:80px;font-weight:800;color:var(--orange)}
.strip{display:flex;gap:30px;padding:26px 40px;border:3px solid var(--navy);border-radius:120px;background:#fff;margin-bottom:80px}
.strip img{width:130px;height:130px;object-fit:contain;border-radius:50%;border:2px solid var(--line);padding:14px;background:#fff}
.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:22px;margin-top:60px}
.chips span{background:var(--navy);color:#fff;font-size:40px;font-weight:600;padding:20px 34px;border-radius:60px}
.cta{margin-top:70px;background:var(--btn);color:#fff;font-size:52px;font-weight:700;padding:34px 70px;border-radius:24px}
.url{margin-top:40px;font-size:44px;font-weight:600}`;

(async () => {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const out = process.argv[2].replace(/\.json$/, '');
  fs.mkdirSync(out, { recursive: true });
  const n = spec.slides.length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>${spec.slides.map((s, i) => slideHtml(s, i, n)).join('')}</body></html>`;
  fs.writeFileSync(path.join(out, 'slides.html'), html);
  fs.writeFileSync(path.join(out, 'caption.txt'), spec.caption.trim() + '\n');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
  await p.goto('file://' + path.resolve(out, 'slides.html'));
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => document.fonts.ready);
  const ok = await p.evaluate(() => document.fonts.check('800 40px Archivo'));
  const ss = await p.$$('section.s');
  for (let i = 0; i < ss.length; i++) await ss[i].screenshot({ path: path.join(out, `slide-${i + 1}.png`) });
  // flag text that overflows the slide
  const over = await p.$$eval('section.s', (els) => els.map((e, i) => (e.scrollHeight > 1350 ? i + 1 : 0)).filter(Boolean));
  await b.close();
  console.log(`${out}: ${n} slides, archivo=${ok}${over.length ? ', OVERFLOW on slides ' + over : ''}`);
})();
