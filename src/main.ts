import './style.css';
import { setV0Table } from './ai/v0';
import { App } from './ui/app';

// AIが使う勝率表を、ページを開いた時点で別スレッドで作っておく（間に合わなければAIがその場で作る）
try {
  const worker = new Worker(new URL('./ai/v0.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Float32Array>) => {
    setV0Table(e.data);
    worker.terminate();
  };
} catch {
  /* Worker が使えない環境では、最初の手のときに作る */
}

const app = new App(document.getElementById('app') as HTMLElement);
app.start();
// 確認用: ?debug のときだけ、自動テストから局面を直接作れるようにする
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __app: App }).__app = app;
