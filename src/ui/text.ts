/** 画面に出す文言（テストしやすいよう、画面から分離） */
import type { Hand, MoveResult, Player } from '../core/rules';

export const HAND_NAME: Record<Hand, string> = { G: 'グー', C: 'チョキ', P: 'パー' };
export const HAND_ICON: Record<Hand, string> = { G: '✊', C: '✌️', P: '✋' };
/** 勝ったときの掛け声（1段ずつ上る） */
export const CALL: Record<Hand, string[]> = {
  G: ['グ', 'リ', 'コ'],
  C: ['チ', 'ヨ', 'コ', 'レ', 'イ', 'ト'],
  P: ['パ', 'イ', 'ナ', 'ツ', 'プ', 'ル'],
};

export const LEVEL_NAME = { weak: 'よわい', medium: 'ふつう', strong: 'つよい' } as const;

export function whoName(p: Player, me: Player = 0): string {
  return p === me ? 'あなた' : 'AI';
}

/** 1回の移動で起きたことを、ログ用の文にする */
export function moveLines(r: MoveResult, me: Player = 0): string[] {
  const who = whoName(r.mover, me);
  const steps = r.landed - r.from;
  if (r.outcome === 'goal') return [`${who}は${r.from}段から${steps}段進んで、ゴール到達！`];
  const lines = [`${who}は${r.from}段から${steps}段進んで ${r.landed}段へ`];
  for (const b of r.blasts) lines.push(`💥 ${b.stage}段目の地雷が爆発！ ${b.fellTo}段まで落ちた`);
  if (r.outcome === 'miss') {
    lines.push(
      r.mover === me
        ? `自分の地雷を踏んだ…（${r.to}段に地雷があると相手に知られた）`
        : `AIが自分の地雷を踏んだ（${r.to}段にAIの地雷があると分かった）`,
    );
  }
  return lines;
}

export function handLabel(h: Hand): string {
  return `${HAND_ICON[h]} ${HAND_NAME[h]}`;
}

/** 説明文（タイトル画面と検索向けの説明に使う） */
export const LEAD = '『地雷グリコ』のルールで遊べる、非公式のファンゲーム。階段を上るじゃんけんと、隠した地雷の心理戦。';

/** じゃんけんに勝ったときの褒め言葉・負けたときの焦り */
export const PRAISE = ['見事！', '読み勝ち！', '冴えてる！', 'いい手！', 'その調子！'];
export const DESPAIR = ['まずい…', '読まれた…', 'くっ…', '嫌な予感…', '押されている…'];

/** 0以上1未満の乱数で、配列から1つ選ぶ */
export function pickLine(lines: readonly string[], r: number): string {
  return lines[Math.min(lines.length - 1, Math.floor(r * lines.length))];
}

/** タイトル画面の下に出す、原作への言及（扱いは作者が決める。ここだけ直せばよい） */
export const FAN_NOTE = '青崎有吾『地雷グリコ』に着想を得た、非公式のファンメイドのゲームです。';

export const LEVEL_DESC = {
  weak: '素直な相手。宣言を文字通り信じる。',
  medium: '地雷を推理して打つ。宣言は信じたり、裏を読んだり。',
  strong: '毎回、理詰めで最適に混ぜる。宣言は通じない。',
} as const;

export const RULES: string[] = [
  '0段目から、46段目（ゴール）に先に着いたほうが勝ち。',
  '各自、1〜45段に地雷を3個、相手に見えないように置く。同じ段に置いてしまったら、重なった段の番号だけが告げられて、両者置き直し。',
  'じゃんけんで勝つと必ず進む。グー＝3段、チョキ＝6段、パー＝6段。',
  '相手の地雷に止まると爆発して10段下がる。下がった先にも相手の地雷があれば連鎖。爆発した地雷は消える。',
  '自分の地雷に止まっても罰はない。ただし、その段に自分の地雷があることが相手に知られる。',
  '〈あいこルール〉1ターン内で同じ手によるあいこが5回連続したら、そのじゃんけんは立っている位置がゴールに近いほうの勝ち（同じ段なら先に着いていたほう）。勝ったほうは3段か6段、好きなほうを選んで進む。違う手のあいこになったら、回数は1から数え直し。',
  '発言は自由。地雷の位置や次の手を宣言できる（嘘もOK）。AIがどう受け取るかは強さしだい。',
  '盤のマスをタップすると、推理メモ（？怪しい／○たぶん安全／！宣言された）を付けられる。',
  '手はカードで出す。1回タップで持ち上げ、もう1回タップで勝負。演出中に続けてタップすると、次の勝負に予約される。',
];

/** プレイヤーの宣言に対するAIの反応（強さで口ぶりが変わる。内心は明かさない） */
export function reactionLine(level: 'weak' | 'medium' | 'strong', pick: number): string {
  const lines = {
    weak: ['そうなんだ！ 信じるよ！', 'わかった、気をつけるね', 'えっ、そこなの？'],
    medium: ['ふむ…', '本当かな？', 'へえ、そう来たか', 'なるほどね'],
    strong: ['……そう。', '関係ないよ', '好きに言えばいい'],
  }[level];
  return `「${lines[Math.floor(pick * lines.length) % lines.length]}」`;
}
