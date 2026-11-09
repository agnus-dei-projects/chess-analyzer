const { chromium } = require('playwright');
const art = (pad) => `<body style="margin:0;background:#3A2415"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" style="display:block">
<rect width="512" height="512" fill="#3A2415"/>
<g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
<rect x="0" y="0" width="256" height="256" fill="#EDD5AC"/><rect x="256" y="0" width="256" height="256" fill="#AC784D"/>
<rect x="0" y="256" width="256" height="256" fill="#AC784D"/><rect x="256" y="256" width="256" height="256" fill="#EDD5AC"/>
<polyline points="24,392 120,340 200,372 300,196 376,240 488,92" fill="none" stroke="#3A2415" stroke-width="44" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="300" cy="196" r="46" fill="#2F6B4F" stroke="#3A2415" stroke-width="16"/>
</g></svg></body>`;
(async () => {
  const b = await chromium.launch();
  for (const [name, size, pad] of [['icon-180.png', 180, 0], ['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 72]]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(art(pad));
    await p.screenshot({ path: 'pwa/' + name });
    await p.close();
  }
  await b.close();
})();
