/** 勝率表 V0 を別スレッドで作る（画面を止めないため） */
import { buildV0Table } from './v0';

const table = buildV0Table();
(self as unknown as Worker).postMessage(table, [table.buffer]);
