// Screenshots each <section class="s"> of a hand-made slides.html as slide-N.jpg (1080x1080) in the same folder.
// Usage: node marketing/instagram/shoot.js marketing/instagram/posts/<date>/<name>/slides.html
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const html = path.resolve(process.argv[2]);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1100, height: 1100 } });
  await p.goto('file://' + html);
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => document.fonts.ready);
  const ss = await p.$$('section.s');
  for (let i = 0; i < ss.length; i++) await ss[i].screenshot({ path: path.join(path.dirname(html), `slide-${i + 1}.jpg`), type: 'jpeg', quality: 95 });
  const broken = await p.$$eval('img', (els) => els.filter((e) => !e.naturalWidth).map((e) => e.src));
  await b.close();
  console.log(`${ss.length} slides${broken.length ? ' BROKEN IMG ' + broken : ''}`);
})();
