/**
 * 画面の通し確認（ヘッドレスChrome）。
 *   npm run build && npm run e2e
 * Chrome の場所は環境変数 CHROME_PATH で指定できる（未指定なら一般的な場所を探す）。
 * 1局を最後まで操作し、メモ・宣言・置き直しも通して、エラーが出ないことを確かめる。
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Chrome が見つかりません。CHROME_PATH にブラウザの実行ファイルを指定してください。');
  process.exit(2);
}

const server = await preview({ preview: { port: 4179, strictPort: false, open: false } });
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:4173/';
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
const errors = [];
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) failed = true;
};

try {
  for (const level of ['weak', 'medium', 'strong']) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${url}?fast=1`, { waitUntil: 'networkidle0' });
    await page.click(`[data-level="${level}"]`);
    await page.click('#start');

    // 地雷を置く（重なったら置き直し）
    for (let tries = 0; ; tries++) {
      for (const s of [10, 20, 30]) await page.click(`.cell[data-stage="${s}"]`);
      await page.click('#confirm');
      await new Promise((r) => setTimeout(r, 50));
      if (await page.$('#controls')) break;
      if (tries > 30) throw new Error('配置が決まらない');
    }
    check((await page.$eval('#hud', (e) => e.textContent)).includes('地雷 残り3'), `${level}: 残りの地雷の数が見える`);
    check((await page.$eval('#gap', (e) => e.textContent)) === '並んでいる', `${level}: 2人の差が見える`);

    // メモと宣言
    await page.click('.cell[data-stage="12"]');
    check((await page.$eval('.cell[data-stage="12"] .memo', (e) => e.title)) === '怪しい（メモ）', `${level}: メモを付けられる`);
    check((await page.$$('.board .cell')).length === 47, `${level}: 盤に47マス（0〜46段）がある`);
    // カード: 1回目は持ち上げるだけ、2回目で勝負
    await page.click('.card[data-hand="G"]');
    check(!!(await page.$('.card.up[data-hand="G"]')), `${level}: 1回目のタップでカードが持ち上がる`);
    check(!(await page.$('.stamp.win, .stamp.lose, .stamp.tie')), `${level}: 持ち上げただけでは勝負しない`);
    await page.click('.cell[data-stage="12"]'); // もう一度押してもメモが変わるだけ
    await page.click('#declare');
    await page.click('[data-decl-hand="C"]');
    check(!(await page.$('.overlay')), `${level}: 宣言のダイアログが閉じる`);

    // 決着まで
    let clicks = 0;
    while (clicks < 1500 && !(await page.$('#result-title'))) {
      if (await page.$('.card[data-steps="6"]')) await page.click('.card[data-steps="6"]'); // あいこ5回で勝ったら6段を選ぶ
      else {
        const hd = ['G', 'C', 'P'][clicks % 3];
        await page.click(`.card[data-hand="${hd}"]`).catch(() => {});
        await page.click(`.card[data-hand="${hd}"]`).catch(() => {});
      }
      clicks++;
      await new Promise((r) => setTimeout(r, 5));
    }
    await page.waitForSelector('#result-title', { timeout: 5000 });
    check(true, `${level}: ${clicks}回の操作で決着（${await page.$eval('#result-title', (e) => e.textContent)}）`);
    check((await page.$eval('#layouts', (e) => e.textContent)).includes('あなたの地雷: 10・20・30段目'), `${level}: 結果に両者の配置が出る`);
    await page.close();
  }

  // 通常モード（待ち・音・振動あり）: 数ターン進め、動きの途中でも壊れないことを確かめる
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.click('[data-level="medium"]');
    await page.click('#start');
    for (let tries = 0; ; tries++) {
      for (const s of [11, 22, 33]) await page.click(`.cell[data-stage="${s}"]`);
      await page.click('#confirm');
      await new Promise((r) => setTimeout(r, 50));
      if (await page.$('#controls')) break;
      if (tries > 30) throw new Error('配置が決まらない');
    }
    await page.click('#settings');
    check(!!(await page.$('#set-reduce')), '通常: 設定ダイアログが開く');
    await page.click('#set-close');
    let moved = false;
    let sawVerdict = false;
    for (let i = 0; i < 40 && !moved; i++) {
      await page.click('.card[data-hand="C"]');
      await page.click('.card[data-hand="C"]');
      const sawShake = await page.waitForSelector('.mini.shake', { timeout: 2000 }).then(() => true, () => false);
      if (i === 0) check(sawShake, '通常: 「じゃん・けん」で伏せたカードが揺れる');
      // 演出中にカチカチ: 予約される
      if (i === 0) {
        await page.click('.card[data-hand="G"]');
        await page.click('.card[data-hand="G"]');
        check(!!(await page.$('.card.queued')), '通常: 演出中の2回タップは次の勝負に予約される');
      }
      sawVerdict ||= await page.waitForSelector('.stamp.win, .stamp.lose', { timeout: 4000 }).then(() => true, () => false);
      await page.waitForFunction(() => !document.querySelector('#controls.busy') && !document.querySelector('.card.queued'), { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('#controls.busy'), { timeout: 20000 });
      await page.click('#logbtn');
      moved = (await page.$$eval('.log li', (els) => els.map((e) => e.textContent))).some((l) => l.includes('進んで'));
      await page.click('.overlay .close');
    }
    check(sawVerdict, '通常: 勝ち負けのはんこが出る');
    check(moved, '通常: 勝ち負けがついてコマが動く');
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
check(errors.length === 0, `ブラウザのエラーなし${errors.length ? ': ' + errors.join(' / ') : ''}`);
process.exit(failed ? 1 : 0);
