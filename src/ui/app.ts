/**
 * 画面の制御。タイトル → 地雷の設置 → 対戦 → 結果。
 * ルールは core、AI は ai に任せ、ここは「表示」と「操作の受け付け」だけを持つ。
 */
import { createAI, LEVELS, type AI, type Declaration, type Level } from '../ai/ai';
import { makeRng, sampleDistinct, type Rng } from '../ai/rng';
import { knowledgeOf } from '../core/knowledge';
import {
  GOAL, HANDS, STEP_OF_HAND, TIE_LIMIT, applyMove, createGame, placementOverlap, resolveJanken, tieFavored,
  type GameState, type Hand, type MoveResult, type Player,
} from '../core/rules';
import { Sfx } from '../fx/audio';
import { flash, pulse, shake, vibrate } from '../fx/motion';
import { banner, centerIn, chainBurst, confetti, explosion, tint } from '../fx/particles';
import { loadSettings, saveSettings, type Settings } from '../fx/settings';
import { buildBoard, buildTrack, gapText, type Board } from './board';
import { clear, h, sleep } from './dom';
import {
  CALL, DESPAIR, FAN_NOTE, HAND_ICON, HAND_NAME, LEAD, LEVEL_DESC, LEVEL_NAME, PRAISE, RULES,
  handLabel, moveLines, pickLine, reactionLine, whoName,
} from './text';

type Memo = 'sus' | 'ok' | 'said';
const MEMO_CYCLE: Array<Memo | null> = [null, 'sus', 'ok', 'said'];
const MEMO_TEXT: Record<Memo, [string, string]> = {
  sus: ['？', '怪しい（メモ）'],
  ok: ['○', 'たぶん安全（メモ）'],
  said: ['！', '宣言された（メモ）'],
};

const STORAGE_KEY = 'jirai-kaidan:level';
function loadLevel(): Level {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LEVELS as readonly string[]).includes(v)) return v as Level;
  } catch {
    /* 保存できない環境でも動く */
  }
  return 'medium';
}
function saveLevel(l: Level): void {
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* 保存できない環境でも動く */
  }
}

/** 画面が切り替わったあとも続いていた非同期の動きを止めるための印 */
class Cancelled extends Error {}

interface Timing {
  jan: number; // 「じゃん」「けん」の間
  reveal: number; // 手を公開したあと
  verdict: number; // 勝ち負けを見せる時間
  step: number; // 1段進むごと
  hit: number; // 爆発の溜め（ヒットストップ）
  fall: number; // 落下の1段ごと
  chain: number; // 連鎖の間
  end: number; // 動きの最後
  walk: boolean;
}

type Verdict = 'win' | 'lose' | 'tie';

/** 盤のマスに付ける小さな印 */
const badge = (cls: string, text: string, title: string) => h('i', { class: `bd ${cls}`, title, 'aria-label': title }, text);

export class App {
  private level: Level = loadLevel();
  private ai: AI | null = null;
  private state: GameState | null = null;
  private picks: number[] = [];
  private note = '';
  private memos = new Map<number, Memo>();
  private aiSaid = new Set<number>();
  private logLines: string[] = [];
  private bubble = '';
  private turnDeclared = false;
  /** 同じ手のあいこ5回で勝ち、3段か6段を選んでいるところ */
  private tiebreak = false;
  private busy = false;
  private epoch = 0;
  private settings: Settings = loadSettings();
  private readonly fast = new URLSearchParams(location.search).has('fast'); // 自動テスト用: 待ちなし・無音
  private sfx = new Sfx(() => this.settings, this.fast);
  private rng: Rng = makeRng((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);

  /** 持ち上げているカード */
  private selected: Hand | null = null;
  /** 演出中に予約された次の手 */
  private pending: Hand | null = null;
  /** 予約が入ったら、残りの演出を早送りする */
  private hurry = false;

  // 対戦画面の要素
  private board: Board | null = null;
  private track: ReturnType<typeof buildTrack> | null = null;
  private pieceMe: HTMLElement | null = null;
  private pieceAi: HTMLElement | null = null;
  private el: Record<'battle' | 'hud' | 'duel' | 'ticker' | 'cards', HTMLElement> | null = null;

  constructor(private root: HTMLElement) {}

  start(): void {
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { once: true });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.applySettings();
    this.showTitle();
  }

  private mount(...nodes: Node[]): void {
    this.epoch++; // 進行中のアニメーションはここで止まる
    this.busy = false;
    this.pending = null;
    this.hurry = false;
    clear(this.root);
    this.root.append(...nodes);
  }

  private applySettings(): void {
    document.body.classList.toggle('reduce-motion', this.settings.reduceMotion);
  }

  private timing(): Timing {
    if (this.fast) return { jan: 0, reveal: 0, verdict: 0, step: 0, hit: 0, fall: 0, chain: 0, end: 0, walk: false };
    if (this.settings.reduceMotion) return { jan: 140, reveal: 160, verdict: 420, step: 0, hit: 700, fall: 0, chain: 150, end: 160, walk: false };
    return { jan: 260, reveal: 380, verdict: 700, step: 150, hit: 620, fall: 22, chain: 260, end: 320, walk: true };
  }

  /** 待つ。予約が入っていれば早送り。待つあいだに画面が切り替わっていたら Cancelled で抜ける */
  private async wait(token: number, ms: number): Promise<void> {
    const t = this.hurry ? Math.round(ms / 4) : ms;
    if (t > 0) await sleep(t);
    if (token !== this.epoch) throw new Cancelled();
  }

  private get calm(): boolean {
    return this.settings.reduceMotion || this.fast;
  }

  private topbar(title: string): HTMLElement {
    return h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'link', onclick: () => this.showTitle() }, '← もどる'),
      h('span', { class: 'lv' }, title),
      h('button', { class: 'link', id: 'settings', 'aria-label': '設定', onclick: () => this.openSettings() }, '⚙ 設定'),
    );
  }

  // ================================================================ タイトル
  private showTitle(): void {
    this.el = null;
    this.board = null;
    const levels = LEVELS.map((l) =>
      h(
        'button',
        {
          class: `level${l === this.level ? ' on' : ''}`,
          dataset: { level: l },
          'aria-pressed': l === this.level ? 'true' : 'false',
          onclick: () => {
            this.level = l;
            saveLevel(l);
            this.showTitle();
          },
        },
        h('b', {}, LEVEL_NAME[l]),
        h('span', {}, LEVEL_DESC[l]),
      ),
    );
    this.mount(
      h(
        'main',
        { class: 'screen title' },
        h('div', { class: 'toprow' }, h('button', { class: 'link', id: 'settings', onclick: () => this.openSettings() }, '⚙ 設定')),
        h('h1', {}, h('span', { class: 'ttl-a' }, '地雷'), h('span', { class: 'ttl-b' }, 'かいだん')),
        h('p', { class: 'lead' }, LEAD),
        h('h2', {}, '相手の強さ'),
        h('div', { class: 'levels' }, ...levels),
        h('button', { class: 'primary big', id: 'start', onclick: () => this.startPlacement() }, 'はじめる'),
        h('details', { class: 'rules' }, h('summary', {}, '遊び方'), h('ol', {}, ...RULES.map((r) => h('li', {}, r)))),
        h('p', { class: 'fan' }, FAN_NOTE),
      ),
    );
  }

  // ================================================================ 地雷の設置
  private startPlacement(): void {
    this.ai = createAI(this.level, 1, this.rng);
    this.picks = [];
    this.note = '';
    this.showPlacement();
  }

  private showPlacement(): void {
    const board = buildBoard(
      (n) => {
        if (this.picks.includes(n)) this.picks = this.picks.filter((x) => x !== n);
        else if (this.picks.length < 3) this.picks = [...this.picks, n];
        else return;
        this.sfx.click();
        this.showPlacement();
      },
      (n) => n >= 1 && n <= 45,
    );
    for (const n of this.picks) {
      board.cell(n).classList.add('picked');
      board.marks(n).append(badge('mine me', '雷', 'あなたの地雷'));
    }
    board.pieces(0).append(this.makePiece(0), this.makePiece(1));
    const sorted = [...this.picks].sort((a, b) => a - b);
    this.mount(
      h(
        'div',
        { class: 'screen-wide placement' },
        this.topbar('地雷を置く'),
        h(
          'main',
          { class: 'place-main' },
          h('p', { class: 'hint' }, '1〜45段から3か所。相手には見えません。最初に被弾するまで、誰もが3の倍数の段（朱の数字）にしか止まれません。'),
          this.note ? h('p', { class: 'note', role: 'status' }, this.note) : null,
          board.el,
          h('p', { class: 'picked-text', id: 'picked' }, sorted.length ? `置く段: ${sorted.join('・')}段目（${sorted.length}/3）` : '置く段: まだ選んでいません（0/3）'),
          h(
            'div',
            { class: 'row' },
            h('button', { onclick: () => { this.picks = sampleDistinct(this.rng, 1, 45, 3); this.showPlacement(); } }, 'おまかせ'),
            h('button', { onclick: () => { this.picks = []; this.showPlacement(); } }, 'やり直す'),
            h('button', { class: 'primary', id: 'confirm', disabled: this.picks.length !== 3, onclick: () => this.confirmPlacement() }, 'これで決める'),
          ),
        ),
      ),
    );
  }

  private confirmPlacement(): void {
    const ai = this.ai;
    if (!ai || this.picks.length !== 3) return;
    const aiPick = ai.choosePlacement();
    const overlap = placementOverlap(this.picks, aiPick);
    if (overlap.length > 0) {
      // 重なった段の番号だけを告げて、両者置き直し
      this.note = `${overlap.join('・')}段目が重なりました。両者とも置き直しです。`;
      this.picks = [];
      this.showPlacement();
      return;
    }
    this.state = createGame(this.picks, aiPick);
    this.memos = new Map();
    this.aiSaid = new Set();
    this.logLines = [];
    this.bubble = '';
    this.turnDeclared = false;
    this.tiebreak = false;
    this.selected = null;
    this.showBattle();
    this.pushLog('対戦開始！ カードを選んで勝負しよう');
    this.startTurn();
    this.refresh();
  }

  // ================================================================ 対戦
  private makePiece(p: Player): HTMLElement {
    return h('span', { class: `piece ${p === 0 ? 'me' : 'ai'}`, role: 'img', 'aria-label': p === 0 ? 'あなたのコマ' : 'AIのコマ' });
  }

  private showBattle(): void {
    this.board = buildBoard((n) => this.cycleMemo(n), (n) => n >= 1 && n <= 45);
    this.track = buildTrack();
    this.pieceMe = this.makePiece(0);
    this.pieceAi = this.makePiece(1);
    this.el = {
      battle: h('div', { class: 'screen-wide battle' }),
      hud: h('div', { class: 'hud', id: 'hud' }),
      duel: h('section', { class: 'duel', id: 'duel', 'aria-live': 'polite' }),
      ticker: h('p', { class: 'ticker', id: 'ticker' }),
      cards: h('footer', { class: 'cards', id: 'controls' }),
    };
    const e = this.el;
    e.battle.append(
      this.topbar(`AI：${LEVEL_NAME[this.level]}`),
      h(
        'div',
        { class: 'play' },
        h('div', { class: 'left' }, e.hud, this.track.el, this.board.el),
        h(
          'div',
          { class: 'right' },
          e.duel,
          e.ticker,
          e.cards,
          h(
            'div',
            { class: 'row sub-actions' },
            h('button', { class: 'declare', id: 'declare', onclick: () => this.openDeclare() }, '宣言する（嘘もOK）'),
            h('button', { class: 'ghost', id: 'logbtn', onclick: () => this.openLog() }, '記録'),
          ),
          this.legend(),
        ),
      ),
    );
    this.mount(e.battle);
  }

  private legend(): HTMLElement {
    return h(
      'details',
      { class: 'legend' },
      h('summary', {}, '記号の見方'),
      h(
        'ul',
        {},
        h('li', {}, this.makePiece(0), ' あなたのコマ（丸）　', this.makePiece(1), ' AIのコマ（ひし形）'),
        h('li', {}, badge('mine me', '雷', ''), ' あなたの地雷　', badge('mine me exposed', '雷', ''), ' 相手に知られた地雷'),
        h('li', {}, badge('mine ai', '雷', ''), ' 位置が分かったAIの地雷　', badge('boom', '爆', ''), ' 爆発して消えた地雷'),
        h('li', {}, badge('safe', '済', ''), ' 無事に止まれた段（相手の地雷はない）　', badge('said', '言', ''), ' AIが宣言した段'),
        h('li', {}, 'マスをタップすると、？（怪しい）→ ○（たぶん安全）→ ！（宣言された）→ なし、の順にメモが変わります。'),
      ),
    );
  }

  private pushLog(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 200) this.logLines.shift();
    if (this.el) this.el.ticker.textContent = line;
  }

  /** ターンの最初に、AIがときどき宣言する */
  private startTurn(): void {
    const s = this.state;
    const ai = this.ai;
    if (!s || !ai || s.winner !== null || this.turnDeclared) return;
    this.turnDeclared = true;
    const d = ai.maybeDeclare(s);
    if (!d) {
      this.bubble = '';
      return;
    }
    if (d.kind === 'mine') {
      d.stages.forEach((x) => this.aiSaid.add(x));
      this.bubble = `「${d.stages.join('段目と')}段目に仕掛けたよ」`;
    } else {
      this.bubble = `「次は${HAND_NAME[d.hand]}を出すよ」`;
    }
    this.pushLog(`AI ${this.bubble}`);
  }

  private refresh(): void {
    this.renderHud();
    this.renderMarks();
    this.placePieces();
    this.renderDuel(null);
    this.renderCards();
  }

  private renderHud(): void {
    const s = this.state;
    const e = this.el;
    if (!s || !e) return;
    const side = (p: Player) =>
      h(
        'div',
        { class: `side ${p === 0 ? 'me' : 'ai'}` },
        h('div', { class: 'who' }, this.makePiece(p), p === 0 ? 'あなた' : 'AI'),
        h('div', { class: 'pos' }, h('b', {}, String(s.pos[p])), '段'),
        h('div', { class: 'left-mines' }, `地雷 残り${s.mines[p].size}`),
      );
    clear(e.hud);
    e.hud.append(side(0), h('div', { class: 'gap', id: 'gap' }, gapText(s.pos[0], s.pos[1])), side(1));
    this.track?.set(s.pos[0], s.pos[1]);
  }

  /** マスの印（公開情報と自分のメモだけ） */
  private renderMarks(revealAll = false): void {
    const s = this.state;
    const b = this.board;
    if (!s || !b) return;
    const k = knowledgeOf(s, 0);
    const myAll = new Set([...s.mines[0], ...s.exploded[1]]);
    const aiAll = new Set([...s.mines[1], ...s.exploded[0]]);
    for (let n = 1; n <= 45; n++) {
      const m = b.marks(n);
      clear(m);
      if (revealAll) {
        if (myAll.has(n)) m.append(badge(`mine me${s.exploded[1].has(n) ? ' gone' : ''}`, '雷', 'あなたの地雷'));
        if (aiAll.has(n)) m.append(badge(`mine ai${s.exploded[0].has(n) ? ' gone' : ''}`, '雷', 'AIの地雷'));
        if (s.exploded[0].has(n) || s.exploded[1].has(n)) m.append(badge('boom', '爆', '爆発した'));
        continue;
      }
      if (k.ownMines.has(n)) m.append(badge(`mine me${k.ownExposed.has(n) ? ' exposed' : ''}`, '雷', k.ownExposed.has(n) ? '相手に知られたあなたの地雷' : 'あなたの地雷'));
      if (k.oppBlasted.has(n)) m.append(badge('boom', '爆', 'AIの地雷だった（爆発して消えた）'));
      else if (k.oppRevealed.has(n)) m.append(badge('mine ai', '雷', '位置が分かったAIの地雷'));
      else if (k.safeLanded.has(n)) m.append(badge('safe', '済', '相手の地雷はない段'));
      if (this.aiSaid.has(n)) m.append(badge('said', '言', 'AIが宣言した段'));
      const memo = this.memos.get(n);
      if (memo) m.append(h('i', { class: `memo ${memo}`, title: MEMO_TEXT[memo][1], 'aria-label': MEMO_TEXT[memo][1] }, MEMO_TEXT[memo][0]));
    }
  }

  private placePieces(): void {
    const s = this.state;
    if (!s) return;
    this.movePiece(0, s.pos[0], false);
    this.movePiece(1, s.pos[1], false);
  }

  /** コマを動かす（表示だけ）。hop=true なら跳ねる */
  private movePiece(p: Player, n: number, hop: boolean): void {
    const b = this.board;
    const piece = p === 0 ? this.pieceMe : this.pieceAi;
    if (!b || !piece) return;
    const dest = b.pieces(Math.min(n, GOAL));
    if (piece.parentElement !== dest) dest.append(piece);
    if (hop && !this.calm && typeof piece.animate === 'function') {
      piece.animate(
        [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-10px) scale(1.12)' }, { transform: 'translateY(0) scale(1)' }],
        { duration: 140, easing: 'ease-out' },
      );
    }
  }

  // ---------------------------------------------------------------- 手札
  private renderCards(): void {
    const s = this.state;
    const e = this.el;
    if (!s || !e) return;
    clear(e.cards);
    e.cards.classList.toggle('busy', this.busy);
    if (s.winner !== null) return;

    if (this.tiebreak) {
      // 原作どおり、勝ったプレイヤーは三段か六段、好きなほうを選んで上れる
      e.cards.append(
        h('p', { class: 'cards-title' }, 'あいこ5回であなたの勝ち！ 3段か6段、好きなほうを選ぼう'),
        h('div', { class: 'hand-row two' }, ...([3, 6] as const).map((n) =>
          h('button', { class: 'card face', dataset: { steps: String(n) }, 'aria-label': `${n}段進む`, onclick: () => void this.chooseTiebreak(n) },
            h('span', { class: 'big' }, `+${n}`), h('span', { class: 'nm' }, '段進む')),
        )),
      );
      return;
    }

    const row = h('div', { class: 'hand-row' }, ...HANDS.map((hd, i) =>
      h(
        'button',
        {
          class: `card face${this.selected === hd ? ' up' : ''}${this.pending === hd ? ' queued' : ''}`,
          dataset: { hand: hd },
          'aria-pressed': this.selected === hd ? 'true' : 'false',
          'aria-label': `${HAND_NAME[hd]}、勝てば${STEP_OF_HAND[hd]}段（キー${i + 1}）`,
          onclick: () => this.onCard(hd),
        },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, HAND_ICON[hd]),
        h('span', { class: 'nm' }, HAND_NAME[hd]),
        h('span', { class: 'st' }, `+${STEP_OF_HAND[hd]}`),
      ),
    ));
    const hint = this.pending
      ? `次は${HAND_NAME[this.pending]}を出す（予約）`
      : this.selected
        ? 'もう一度タップで勝負！'
        : 'カードを選ぶ';
    e.cards.append(row, h('p', { class: 'cards-hint', id: 'cards-hint' }, hint));
  }

  /** カードのタップ。1回目で持ち上げ、同じカードをもう1回で勝負。演出中のタップは次の勝負に予約する */
  private onCard(hd: Hand): void {
    const s = this.state;
    if (!s || s.winner !== null || this.tiebreak) return;
    if (this.selected !== hd) {
      this.selected = hd;
      if (this.pending && this.pending !== hd) this.pending = null;
      this.sfx.lift();
      this.renderCards();
      return;
    }
    if (this.busy) {
      this.pending = hd;
      this.hurry = true;
      this.renderCards();
      return;
    }
    void this.play(hd);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.el || this.root.querySelector('.overlay')) return;
    const map: Record<string, Hand> = { '1': 'G', '2': 'C', '3': 'P', g: 'G', c: 'C', p: 'P' };
    const hd = map[e.key.toLowerCase()];
    if (hd) this.onCard(hd);
    else if (e.key === 'Enter' && this.selected && !(document.activeElement instanceof HTMLButtonElement)) this.onCard(this.selected);
  }

  // ---------------------------------------------------------------- 1ターンの進行
  private async play(mine: Hand): Promise<void> {
    const ai = this.ai;
    if (this.busy || !this.state || !ai || this.state.winner !== null || this.tiebreak) return;
    const token = this.epoch;
    this.busy = true;
    this.selected = null;
    this.renderCards();
    try {
      const s0 = this.state;
      const aiHand = ai.chooseHand(s0);
      const r = resolveJanken(s0, mine, aiHand);
      const vs = `${handLabel(mine)} vs ${handLabel(aiHand)}`;
      await this.revealHands(token, mine, aiHand);
      this.state = r.state;
      if (r.kind === 'tie') {
        const tieName = HAND_NAME[mine];
        const reset = r.state.tieCount === 1 && s0.tieCount > 0 ? '（手が変わったので1回目から）' : '';
        this.renderDuel({ mine, ai: aiHand, verdict: 'tie', text: `${tieName}であいこ ${r.state.tieCount}/${TIE_LIMIT}` });
        this.sfx.tie();
        this.pushLog(`${vs} … ${tieName}であいこ (${r.state.tieCount}/${TIE_LIMIT})${reset}`);
        this.renderHud();
        return;
      }
      const v: Verdict = r.winner === 0 ? 'win' : 'lose';
      // 同じ手のあいこ5回: ゴールに近いほうが「その手で勝った」ことになり、その手の段数だけ進む
      const text = r.kind === 'tiebreak'
        ? `${HAND_NAME[r.hand]}のあいこ5回 → ${whoName(r.winner)}の勝ち`
        : pickLine(v === 'win' ? PRAISE : DESPAIR, this.rng());
      this.renderDuel({ mine, ai: aiHand, verdict: v, text });
      this.reactVerdict(v);
      this.pushLog(r.kind === 'tiebreak'
        ? `${vs} … ${HAND_NAME[r.hand]}であいこ5回！ ゴールに近い${whoName(r.winner)}の勝ち`
        : `${vs} … ${whoName(r.winner)}の勝ち`);
      await this.wait(token, this.timing().verdict);
      if (r.kind === 'win') {
        await this.doMove(token, r.winner, r.steps, r.hand);
        return;
      }
      // 同じ手のあいこ5回: 勝った側が3段か6段を選ぶ
      if (r.winner === 0) {
        this.tiebreak = true;
        this.hurry = false;
        this.pending = null;
        this.renderCards();
        return;
      }
      const steps = ai.chooseTiebreakSteps(r.state);
      this.pushLog(`AIは${steps}段を選んだ`);
      await this.doMove(token, 1, steps);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    } finally {
      if (token === this.epoch) this.afterTurn();
    }
  }

  /** 演出が終わったら操作を戻し、予約があれば続けて出す */
  private afterTurn(): void {
    this.busy = false;
    this.hurry = false;
    const next = this.pending;
    this.pending = null;
    this.renderCards();
    if (next && this.state && this.state.winner === null && !this.tiebreak) {
      this.selected = next;
      void this.play(next);
    }
  }

  /** 「じゃん・けん・ぽん」。伏せたカードを揺らし、同時にめくる */
  private async revealHands(token: number, mine: Hand, aiHand: Hand): Promise<void> {
    const t = this.timing();
    this.renderDuel({ mine, ai: aiHand, verdict: null, text: '', hidden: true });
    this.sfx.jan(0);
    await this.wait(token, t.jan);
    this.sfx.jan(1);
    await this.wait(token, t.jan);
    this.renderDuel({ mine, ai: aiHand, verdict: null, text: '', flip: true });
    this.sfx.pon();
    this.sfx.flip();
    await this.wait(token, t.reveal);
  }

  /** 勝ったら褒め、負けたらまずい感じを出す */
  private reactVerdict(v: Verdict): void {
    const battle = this.el?.battle;
    if (v === 'win') {
      this.sfx.good();
      if (battle && !this.calm) {
        flash(battle, 1, false, '#fff3c4');
        const st = this.el?.duel.querySelector<HTMLElement>('.stamp b');
        if (st) {
          const c = centerIn(battle, st);
          confetti(battle, false, { mode: 'burst', count: 28, x: c.x, y: c.y });
        }
      }
    } else if (v === 'lose') {
      this.sfx.bad();
      vibrate(1, this.calm);
      if (battle && !this.fast) {
        battle.classList.remove('danger');
        void battle.offsetWidth; // アニメーションをやり直す
        battle.classList.add('danger');
        shake(battle, 1, this.calm);
      }
    }
  }

  private renderDuel(d: { mine: Hand; ai: Hand; verdict: Verdict | null; text: string; hidden?: boolean; flip?: boolean } | null): void {
    const e = this.el;
    const s = this.state;
    if (!e || !s) return;
    clear(e.duel);
    const fav = tieFavored(s);
    const dots = Array.from({ length: TIE_LIMIT }, (_, i) => h('i', { class: `dot${i < s.tieCount ? ' on' : ''}` }));
    const tie = h(
      'div',
      { class: 'tie', id: 'tie' },
      h('span', {}, s.tieHand ? `${HAND_NAME[s.tieHand]}のあいこ ${s.tieCount}/${TIE_LIMIT}` : `あいこ 0/${TIE_LIMIT}`),
      h('span', { class: 'dots', 'aria-hidden': 'true' }, ...dots),
      h('span', { class: 'fav' }, fav === null ? '（5回でも決まらない）' : `同じ手で5回 → ${whoName(fav)}の勝ち`),
    );
    const card = (who: Player) => {
      const hand = d ? (who === 0 ? d.mine : d.ai) : null;
      const showFace = d && !d.hidden;
      const cls = ['mini', who === 0 ? 'me' : 'ai', showFace ? 'face' : 'back', d?.hidden ? 'shake' : '', d?.flip ? 'flip' : '',
        d?.verdict === 'win' && who === 0 ? 'won' : '', d?.verdict === 'lose' && who === 1 ? 'won' : ''].filter(Boolean).join(' ');
      return h(
        'div',
        { class: 'mini-wrap' },
        h('span', { class: 'mini-who' }, who === 0 ? 'あなた' : 'AI'),
        h('div', { class: cls }, showFace && hand ? h('span', { class: 'ic' }, HAND_ICON[hand]) : h('span', { class: 'q' }, '？'),
          showFace && hand ? h('span', { class: 'nm' }, HAND_NAME[hand]) : null),
      );
    };
    const stamp = d?.verdict
      ? h('div', { class: `stamp ${d.verdict}`, id: 'verdict' },
        h('b', {}, d.verdict === 'win' ? '勝' : d.verdict === 'lose' ? '負' : '分'),
        h('span', {}, d.text))
      : h('div', { class: 'stamp idle' },
        !d && this.bubble ? h('p', { class: 'bubble', id: 'bubble' }, this.bubble) : h('span', {}, d ? 'じゃんけん…' : 'vs'));
    e.duel.append(
      h('div', { class: 'duel-row' }, card(0), stamp, card(1)),
      tie,
    );
  }

  private async chooseTiebreak(steps: 3 | 6): Promise<void> {
    if (!this.tiebreak || this.busy) return;
    const token = this.epoch;
    this.busy = true;
    this.tiebreak = false;
    this.pushLog(`あなたは${steps}段を選んだ`);
    this.renderCards();
    try {
      await this.doMove(token, 0, steps);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    } finally {
      if (token === this.epoch) this.afterTurn();
    }
  }

  private async doMove(token: number, mover: Player, steps: number, hand?: Hand): Promise<void> {
    if (!this.state) return;
    const res = applyMove(this.state, mover, steps);
    await this.animateMove(token, res, hand);
    this.state = res.state;
    for (const line of moveLines(res)) this.pushLog(line);
    this.turnDeclared = false;
    this.startTurn();
    this.renderHud();
    this.renderMarks();
    this.placePieces();
    this.renderDuel(null);
    if (res.state.winner !== null) {
      this.pending = null;
      const battle = this.el?.battle;
      if (res.state.winner === 0) {
        this.sfx.victory();
        if (battle) {
          banner(battle, '勝利！', 'win', this.calm, 'ゴールに一番乗り', 2000);
          confetti(battle, this.calm, { mode: 'rain', count: 160 });
          flash(battle, 2, this.calm, '#fff3c4');
        }
      } else {
        this.sfx.defeat();
        if (battle) {
          if (!this.fast) battle.classList.add('defeated');
          banner(battle, '敗北', 'lose', this.calm, 'AIが先にゴールした', 2000);
          shake(battle, 2, this.calm);
        }
      }
      vibrate(res.state.winner === 0 ? 2 : 4, this.calm);
      await this.wait(token, this.fast ? 0 : 2300);
      this.showResult();
    }
  }

  // ---------------------------------------------------------------- 動きの演出
  /** 勝った側の移動。1段ずつ跳ねて進む → 地雷で爆発（連鎖ごとに強く）→ 落ちる → ミス/無事 */
  private async animateMove(token: number, res: MoveResult, hand?: Hand): Promise<void> {
    const t = this.timing();
    const p = res.mover;
    const from = res.from;
    const walkTo = Math.min(res.landed, GOAL);
    const call = CALL[hand ?? (res.landed - from === 3 ? 'G' : 'P')];
    const battle = this.el?.battle;
    const ticker = this.el?.ticker;

    if (t.walk && !this.hurry) {
      for (let i = 1; i <= walkTo - from; i++) {
        this.movePiece(p, from + i, true);
        this.sfx.step(i - 1);
        if (ticker) ticker.textContent = call.slice(0, i).join('・');
        this.track?.set(p === 0 ? from + i : this.state?.pos[0] ?? 0, p === 1 ? from + i : this.state?.pos[1] ?? 0);
        await this.wait(token, t.step);
      }
    } else {
      this.movePiece(p, walkTo, true);
      this.sfx.step(call.length - 1);
    }
    if (ticker) ticker.textContent = call.join('・');
    if (res.outcome === 'goal') {
      await this.wait(token, t.end);
      return;
    }

    // 爆発: 自分が踏んだら「被弾」、相手に踏ませたら「命中」。連鎖するほど派手に
    const kind = p === 0 ? 'hurt' : 'hit';
    let n = 0;
    for (const b of res.blasts) {
      n++;
      const cell = this.board?.cell(b.stage);
      if (cell) this.board?.marks(b.stage).append(badge('boom', '爆', '爆発'));
      if (battle && cell) {
        const c = centerIn(battle, cell);
        explosion(battle, c.x, c.y, n, kind, this.calm);
        pulse(cell, kind === 'hurt' ? '#2a2622cc' : '#e69f00cc', this.calm);
        shake(battle, Math.min(6, n + 2), this.calm);
        if (kind === 'hurt') {
          tint(battle, '#3a0606', 0.55 + 0.1 * n, this.calm, 600);
          battle.classList.remove('danger');
          void battle.offsetWidth;
          if (!this.fast) battle.classList.add('danger');
        } else {
          tint(battle, '#fff1b8', 0.5, this.calm, 380);
          confetti(battle, this.calm, { mode: 'burst', count: 18 + 6 * n, x: c.x, y: c.y });
        }
        if (n === 1) {
          if (kind === 'hurt') banner(battle, '被弾！', 'hurt', this.calm, `${b.stage}段目の地雷 ${b.stage - b.fellTo}段落ちる`, 1100);
          else banner(battle, '命中！', 'hit', this.calm, `AIが${b.stage}段目の罠を踏んだ`, 1100);
        } else {
          // 連鎖ボーナス: 2発目以降は回数に応じてどんどん派手にする
          chainBurst(battle, c.x, c.y, n, kind, this.calm);
          if (this.board && !this.calm && typeof this.board.el.animate === 'function') {
            const z = 1 + 0.025 * Math.min(n, 5);
            this.board.el.animate([{ transform: 'scale(1)' }, { transform: `scale(${z})` }, { transform: 'scale(1)' }], { duration: 320 + 60 * n, easing: 'cubic-bezier(.2,1.6,.4,1)' });
          }
          const bangs = '！'.repeat(Math.min(n, 4));
          const sub = kind === 'hurt' ? `${b.stage}段目でも被弾 さらに${b.stage - b.fellTo}段落ちる` : `AIが${b.stage}段目でも罠にかかった`;
          banner(battle, `${n}連鎖${bangs}`, kind, this.calm, sub, 1200 + 150 * n, `chain c${Math.min(n, 5)}`);
        }
      }
      vibrate(kind === 'hurt' ? n + 3 : n + 1, this.calm);
      if (kind === 'hurt') this.sfx.boomHurt(n);
      else this.sfx.boomHit(n);
      if (n >= 2) this.sfx.chain(n, kind);
      if (ticker) ticker.textContent = kind === 'hurt' ? `${b.stage}段目で被弾！${n > 1 ? `（${n}連鎖）` : ''}` : `AIが${b.stage}段目で被弾！${n > 1 ? `（${n}連鎖）` : ''}`;
      await this.wait(token, t.hit + (n >= 2 ? 220 * Math.min(n - 1, 4) : 0)); // 溜め（ヒットストップ）。連鎖ほど長く
      this.sfx.fall();
      if (t.walk && !this.hurry) {
        for (let q = b.stage - 1; q >= b.fellTo; q--) {
          this.movePiece(p, q, false);
          await this.wait(token, t.fall);
        }
      } else {
        this.movePiece(p, b.fellTo, false);
      }
      await this.wait(token, t.chain);
    }

    if (res.outcome === 'miss') {
      this.sfx.miss();
      const cell = this.board?.cell(res.to);
      if (cell) pulse(cell, '#0072b2aa', this.calm);
      if (battle) banner(battle, p === 0 ? '地雷がばれた…' : 'AIの地雷が判明', 'miss', this.calm, `${res.to}段目`, 900);
    } else if (res.blasts.length === 0) {
      this.sfx.safe();
    }
    await this.wait(token, t.end);
  }

  private cycleMemo(stage: number): void {
    const cur = this.memos.get(stage) ?? null;
    const next = MEMO_CYCLE[(MEMO_CYCLE.indexOf(cur) + 1) % MEMO_CYCLE.length];
    if (next) this.memos.set(stage, next);
    else this.memos.delete(stage);
    this.renderMarks();
  }

  // ---------------------------------------------------------------- ダイアログ
  private dialog(label: string, ...children: Array<Node | null>): () => void {
    const close = () => this.root.querySelector('.overlay')?.remove();
    this.root.append(
      h('div', { class: 'overlay', role: 'dialog', 'aria-label': label, onclick: (ev: Event) => { if (ev.target === ev.currentTarget) close(); } },
        h('div', { class: 'dialog' }, h('h3', {}, label), ...children, h('button', { class: 'link close', onclick: close }, '閉じる'))),
    );
    return close;
  }

  private openDeclare(): void {
    const ai = this.ai;
    if (!ai || this.root.querySelector('.overlay')) return;
    let close = () => {};
    const send = (d: Declaration, said: string) => {
      ai.hearDeclaration(d);
      this.sfx.declare();
      this.pushLog(`あなた ${said}`);
      this.bubble = reactionLine(this.level, this.rng());
      close();
      this.renderDuel(null);
    };
    const opts = (none: boolean) => [
      ...(none ? [h('option', { value: '' }, 'なし')] : []),
      ...Array.from({ length: 45 }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}段目`)),
    ];
    const selA = h('select', { id: 'decl-a', 'aria-label': '1つ目の段' }, ...opts(false));
    const selB = h('select', { id: 'decl-b', 'aria-label': '2つ目の段' }, ...opts(true));
    close = this.dialog(
      '宣言する',
      h('p', { class: 'hint' }, '本当でも嘘でもかまいません。AIがどう受け取るかは、強さしだいです。'),
      h('h4', {}, '次に出す手'),
      h('div', { class: 'row' }, ...HANDS.map((hd) =>
        h('button', { dataset: { declHand: hd }, onclick: () => send({ kind: 'hand', hand: hd }, `「次は${HAND_NAME[hd]}を出す」`) }, handLabel(hd)),
      )),
      h('h4', {}, '地雷の位置'),
      h('div', { class: 'row' }, selA, selB, h('span', {}, 'に仕掛けた')),
      h('button', {
        id: 'decl-mine',
        onclick: () => {
          const stages = [...new Set([Number(selA.value), selB.value ? Number(selB.value) : 0].filter((x) => x > 0))].sort((a, b) => a - b);
          send({ kind: 'mine', stages }, `「${stages.join('段目と')}段目に仕掛けた」`);
        },
      }, '地雷を宣言'),
    );
  }

  private openLog(): void {
    if (this.root.querySelector('.overlay')) return;
    // 起きた順に1番から番号を振る。開いたら最新（いちばん下）が見えるようにする
    this.dialog('記録', h('ol', { class: 'log', id: 'log' }, ...this.logLines.map((l) => h('li', {}, l))));
    const log = this.root.querySelector<HTMLElement>('.overlay .log');
    log?.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  private openSettings(): void {
    if (this.root.querySelector('.overlay')) return;
    const update = (patch: Partial<Settings>) => {
      this.settings = { ...this.settings, ...patch };
      saveSettings(this.settings);
      this.applySettings();
    };
    const s = this.settings;
    const sound = h('input', {
      type: 'checkbox', id: 'set-sound', checked: !s.muted,
      onchange: (ev: Event) => update({ muted: !(ev.target as HTMLInputElement).checked }),
    });
    const volume = h('input', {
      type: 'range', id: 'set-volume', min: '0', max: '100', value: String(Math.round(s.volume * 100)),
      oninput: (ev: Event) => update({ volume: Number((ev.target as HTMLInputElement).value) / 100 }),
    });
    const reduce = h('input', {
      type: 'checkbox', id: 'set-reduce', checked: s.reduceMotion,
      onchange: (ev: Event) => update({ reduceMotion: (ev.target as HTMLInputElement).checked }),
    });
    this.dialog(
      '設定',
      h('label', { class: 'opt' }, sound, '効果音を鳴らす'),
      h('label', { class: 'opt col' }, '音量', volume),
      h('button', { id: 'set-test', onclick: () => { this.sfx.unlock(); this.sfx.good(); } }, '試しに鳴らす'),
      h('label', { class: 'opt' }, reduce, '振動・点滅を減らす'),
      h('p', { class: 'hint' }, 'オンにすると、画面の振動・光の点滅・端末の振動をやめて、動きも短くなります。'),
    );
    this.root.querySelector('.overlay .close')?.setAttribute('id', 'set-close');
  }

  // ================================================================ 結果
  private showResult(): void {
    const s = this.state;
    if (!s || s.winner === null) return;
    const won = s.winner === 0;
    const myAll = [...new Set([...s.mines[0], ...s.exploded[1]])].sort((a, b) => a - b);
    const aiAll = [...new Set([...s.mines[1], ...s.exploded[0]])].sort((a, b) => a - b);
    this.board = buildBoard();
    this.pieceMe = this.makePiece(0);
    this.pieceAi = this.makePiece(1);
    this.el = null;
    this.mount(
      h(
        'div',
        { class: 'screen-wide result' },
        this.topbar('結果'),
        h(
          'main',
          { class: 'result-main' },
          h('div', { class: `result-stamp ${won ? 'win' : 'lose'}`, id: 'result-title' }, h('b', {}, won ? '勝' : '負'), h('span', {}, won ? 'あなたの勝ち！' : 'AIの勝ち…')),
          h('p', { class: 'layouts', id: 'layouts' },
            h('span', { class: 'me' }, `あなたの地雷: ${myAll.join('・')}段目`),
            h('span', { class: 'ai' }, `AIの地雷: ${aiAll.join('・')}段目`),
          ),
          this.board.el,
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'primary', id: 'again', onclick: () => this.startPlacement() }, 'もう一度'),
            h('button', { onclick: () => this.showTitle() }, 'タイトルへ'),
          ),
        ),
      ),
    );
    this.renderMarks(true);
    this.placePieces();
    const screen = this.root.querySelector<HTMLElement>('.result');
    if (screen && won) confetti(screen, this.calm, { mode: 'rain', count: 90 });
  }
}
