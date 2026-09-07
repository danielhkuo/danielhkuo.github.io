/**
 * The cbonsai growth algorithm, ported from cbonsai.c (John Allbritten,
 * GPL-3.0, https://gitlab.com/jallbrit/cbonsai) with every `rand()` call in
 * the same order so a seed grows the same tree.
 *
 * The C recurses in `branch()` and sleeps inside the recursion when live.
 * Here the recursion is an explicit stack driven by `step()`, which performs
 * exactly one drawn growth step per call, so a host can pace the animation
 * without generators or threads.
 */
import type { Config } from "./args.ts";
import { TEXT_COLOR } from "./colors.ts";
import type { GlibcRandom } from "./rand.ts";
import { Screen, Win } from "./screen.ts";
import { wcwidth } from "./wcwidth.ts";

export const TRUNK = 0;
export const SHOOT_LEFT = 1;
export const SHOOT_RIGHT = 2;
export const DYING = 3;
export const DEAD = 4;
export type BranchType = 0 | 1 | 2 | 3 | 4;

export interface Counters {
  branches: number;
  shoots: number;
  shootCounter: number;
}

/** Result of one `step()`: a drawn step the live view should show, one it should not, or the end of the tree. */
export const STEP_VISIBLE = 0;
export const STEP_HIDDEN = 1;
export const STEP_DONE = 2;
export type StepResult = 0 | 1 | 2;

/** One activation of the C `branch()` function. */
interface Frame {
  y: number;
  x: number;
  type: BranchType;
  life: number;
  dx: number;
  dy: number;
  age: number;
  shootCooldown: number;
  /** 0: about to run the top of the while loop; 1: a nested branch returned, finish this iteration. */
  phase: 0 | 1;
}

interface BaseArt {
  width: number;
  height: number;
}

function baseSize(baseType: number): BaseArt {
  switch (baseType) {
    case 1:
      return { width: 31, height: 4 };
    case 2:
      return { width: 15, height: 3 };
    default:
      return { width: 0, height: 0 };
  }
}

/** printf `%0Nd`. */
function zpad(n: number, width: number): string {
  const s = Math.abs(n).toString();
  const sign = n < 0 ? "-" : "";
  return sign + s.padStart(width - sign.length, "0");
}

/** printf `% Nd`. */
function spad(n: number, width: number): string {
  const s = (n < 0 ? "-" : " ") + Math.abs(n).toString();
  return s.padStart(width, " ");
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isspace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

export class Bonsai {
  readonly counters: Counters = { branches: 0, shoots: 0, shootCounter: 0 };
  treeWin: Win;
  baseWin: Win | null = null;
  messageBorderWin: Win | null = null;
  messageWin: Win | null = null;
  private stack: Frame[] = [];
  readonly conf: Config;
  readonly rng: GlibcRandom;
  readonly screen: Screen;

  constructor(conf: Config, rng: GlibcRandom, screen: Screen) {
    this.conf = conf;
    this.rng = rng;
    this.screen = screen;
    this.treeWin = Win.open(screen, screen.rows, screen.cols, 0, 0) as Win;
  }

  private pairColor(pair: 1 | 2 | 3 | 4 | 5): number {
    return pair === 5 ? TEXT_COLOR : this.conf.colors[pair - 1];
  }

  // ---- init() ------------------------------------------------------------

  /** C `init()`: lay out the windows, draw the base, draw the message. */
  init(): void {
    this.screen.clear();
    this.drawWins();
    this.drawMessage();
  }

  private drawWins(): void {
    const { rows, cols } = this.screen;
    const base = baseSize(this.conf.baseType);
    const baseOriginY = rows - base.height;
    const baseOriginX = Math.trunc(cols / 2) - Math.trunc(base.width / 2);
    this.baseWin =
      base.height > 0 ? Win.open(this.screen, base.height, base.width, baseOriginY, baseOriginX) : null;
    this.treeWin = Win.open(this.screen, rows - base.height, cols, 0, 0) as Win;
    this.drawBase();
  }

  private drawBase(): void {
    const w = this.baseWin;
    if (!w) return;
    const LEAF_BRIGHT = this.pairColor(3);
    const WOOD_BRIGHT = this.pairColor(4);
    const TEXT = this.pairColor(5);
    switch (this.conf.baseType) {
      case 1:
        w.bold = true;
        w.color(TEXT);
        w.addstr(":");
        w.color(LEAF_BRIGHT);
        w.addstr("___________");
        w.color(WOOD_BRIGHT);
        w.addstr("./~~~\\.");
        w.color(LEAF_BRIGHT);
        w.addstr("___________");
        w.color(TEXT);
        w.addstr(":");
        w.mvaddstr(1, 0, " \\                           / ");
        w.mvaddstr(2, 0, "  \\_________________________/ ");
        w.mvaddstr(3, 0, "  (_)                     (_)");
        w.bold = false;
        break;
      case 2:
        w.color(TEXT);
        w.addstr("(");
        w.color(LEAF_BRIGHT);
        w.addstr("---");
        w.color(WOOD_BRIGHT);
        w.addstr("./~~~\\.");
        w.color(LEAF_BRIGHT);
        w.addstr("---");
        w.color(TEXT);
        w.addstr(")");
        w.mvaddstr(1, 0, " (           ) ");
        w.mvaddstr(2, 0, "  (_________)  ");
        break;
    }
  }

  // ---- message ------------------------------------------------------------

  private createMessageWindows(messageBytes: number): boolean {
    const maxY = this.screen.rows;
    const maxX = this.screen.cols;
    let boxWidth: number;
    let boxHeight: number;
    if (messageBytes + 3 <= 0.25 * maxX) {
      boxWidth = messageBytes + 1;
      boxHeight = 1;
    } else {
      boxWidth = Math.trunc(0.25 * maxX);
      if (boxWidth === 0) return false;
      boxHeight = Math.trunc(messageBytes / boxWidth) + Math.trunc(messageBytes / boxWidth);
    }
    const border = Win.open(
      this.screen,
      boxHeight + 2,
      boxWidth + 4,
      Math.trunc(maxY * 0.7 - 1),
      Math.trunc(maxX * 0.7 - 2),
      true,
    );
    const msg = Win.open(this.screen, boxHeight, boxWidth + 1, Math.trunc(maxY * 0.7), Math.trunc(maxX * 0.7), true);
    if (!border || !msg) return false;
    this.messageBorderWin = border;
    this.messageWin = msg;
    // Panel order: border above the tree, message above the border.
    border.raise();
    border.bold = true;
    border.color(this.pairColor(5));
    border.border("|", "|", "-", "-", "+", "+", "+", "+");
    msg.raise();
    return true;
  }

  private addSpaces(count: number, state: { linePosition: number }, maxWidth: number): void {
    const win = this.messageWin as Win;
    if (state.linePosition < maxWidth - count) {
      for (let j = 0; j < count; j++) {
        win.addstr(" ");
        state.linePosition++;
      }
    }
  }

  /** C `drawMessage()`: word-wrap the message into its box, byte by byte as the C does. */
  private drawMessage(): void {
    const message = this.conf.message;
    if (message === null) return;
    const bytes = encoder.encode(message);
    if (!this.createMessageWindows(bytes.length)) return;
    const win = this.messageWin as Win;
    const tree = this.treeWin;
    const verbosity = this.conf.verbosity;
    const maxWidth = win.width - 2;

    let i = 0;
    const state = { linePosition: 0 };
    let wordLength = 0;
    let word: number[] = [];
    for (;;) {
      const thisChar = i < bytes.length ? bytes[i] : 0;
      if (verbosity) {
        tree.mvaddstr(9, 5, `index: ${zpad(i, 3)}`);
        tree.mvaddstr(10, 5, `linePosition: ${zpad(state.linePosition, 2)}`);
      }

      if (!(isspace(thisChar) || thisChar === 0) && wordLength < 512) {
        word.push(thisChar);
        wordLength++;
        state.linePosition++;
      } else if (isspace(thisChar) || thisChar === 0) {
        if (state.linePosition <= maxWidth) {
          win.addstr(decoder.decode(new Uint8Array(word)));
          wordLength = 0;
          word = [];
          switch (thisChar) {
            case 0x20:
              this.addSpaces(1, state, maxWidth);
              break;
            case 0x09:
              this.addSpaces(1, state, maxWidth);
              break;
            case 0x0a:
              win.addch("\n");
              state.linePosition = 0;
              break;
          }
        } else if (wordLength > maxWidth) {
          win.addstr(decoder.decode(new Uint8Array(word)) + " ");
          wordLength = 0;
          word = [];
          state.linePosition = win.cx;
        } else {
          if (verbosity) {
            tree.mvaddstr(
              Math.trunc(i / 24) + 28,
              5,
              `couldn't fit word. linePosition: ${zpad(state.linePosition, 2)}, wordLength: ${zpad(wordLength, 2)}`,
            );
          }
          win.addstr("\n" + decoder.decode(new Uint8Array(word)) + " ");
          state.linePosition = wordLength;
          wordLength = 0;
          word = [];
        }
      } else {
        // Word buffer full: the C prints "Error while parsing message" and gives up.
        return;
      }

      if (verbosity >= 2) {
        const buf = decoder.decode(new Uint8Array(word));
        tree.mvaddstr(11, 5, `word buffer: |${buf.padEnd(15, " ")}|`);
      }
      if (thisChar === 0) break;
      i++;
    }
  }

  // ---- growTree() / branch() ------------------------------------------------

  /** C `growTree()` up to its first `branch()` call; `step()` then runs the growth. */
  beginTree(): void {
    const maxY = this.treeWin.height;
    const maxX = this.treeWin.width;
    this.counters.shoots = 0;
    this.counters.branches = 0;
    this.counters.shootCounter = this.rng.next();
    if (this.conf.verbosity > 0) {
      this.treeWin.mvaddstr(2, 5, `maxX: ${zpad(maxX, 3)}, maxY: ${zpad(maxY, 3)}`);
    }
    this.stack = [];
    this.push(maxY - 1, Math.trunc(maxX / 2), TRUNK, this.conf.lifeStart);
  }

  get finished(): boolean {
    return this.stack.length === 0;
  }

  private push(y: number, x: number, type: BranchType, life: number): void {
    this.counters.branches++;
    this.stack.push({
      y,
      x,
      type,
      life,
      dx: 0,
      dy: 0,
      age: 0,
      shootCooldown: this.conf.multiplier,
      phase: 0,
    });
  }

  /** Run the growth until one branch character has been placed (or the tree is complete). */
  step(): StepResult {
    const conf = this.conf;
    const rng = this.rng;
    const counters = this.counters;
    const tree = this.treeWin;
    const multiplier = conf.multiplier;
    for (;;) {
      const f = this.stack[this.stack.length - 1];
      if (!f) return STEP_DONE;

      if (f.phase === 0) {
        if (f.life <= 0) {
          this.stack.pop();
          continue;
        }
        f.life--;
        f.age = conf.lifeStart - f.life;
        this.setDeltas(f);
        const maxY = tree.height;
        if (f.dy > 0 && f.y > maxY - 2) f.dy--;
        f.phase = 1;

        if (f.life < 3) {
          this.push(f.y, f.x, DEAD, f.life);
          continue;
        } else if (f.type === TRUNK && f.life < multiplier + 2) {
          this.push(f.y, f.x, DYING, f.life);
          continue;
        } else if ((f.type === SHOOT_LEFT || f.type === SHOOT_RIGHT) && f.life < multiplier + 2) {
          this.push(f.y, f.x, DYING, f.life);
          continue;
        } else if (f.type === TRUNK && (rng.next() % 3 === 0 || f.life % multiplier === 0)) {
          if (rng.next() % 8 === 0 && f.life > 7) {
            f.shootCooldown = multiplier * 2;
            this.push(f.y, f.x, TRUNK, f.life + ((rng.next() % 5) - 2));
            continue;
          } else if (f.shootCooldown <= 0) {
            f.shootCooldown = multiplier * 2;
            const shootLife = f.life + multiplier;
            counters.shoots++;
            counters.shootCounter++;
            if (conf.verbosity) tree.mvaddstr(4, 5, `shoots: ${zpad(counters.shoots, 2)}`);
            this.push(f.y, f.x, ((counters.shootCounter % 2) + 1) as BranchType, shootLife);
            continue;
          }
        }
      }

      // Second half of the loop body, after any nested branch has returned.
      f.phase = 0;
      f.shootCooldown--;
      if (conf.verbosity > 0) {
        tree.mvaddstr(5, 5, `dx: ${zpad(f.dx, 2)}`);
        tree.mvaddstr(6, 5, `dy: ${zpad(f.dy, 2)}`);
        tree.mvaddstr(7, 5, `type: ${f.type}`);
        tree.mvaddstr(8, 5, `shootCooldown: ${spad(f.shootCooldown, 3)}`);
      }
      f.x += f.dx;
      f.y += f.dy;
      this.chooseColor(f.type);
      const branchStr = this.chooseString(f.type, f.life, f.dx, f.dy);
      const width = wcwidth(branchStr.codePointAt(0) ?? 0);
      if (f.x % width === 0) tree.mvaddstr(f.y, f.x, branchStr);
      tree.bold = false;
      const visible = conf.live && !(conf.load && counters.branches < conf.targetBranchCount);
      return visible ? STEP_VISIBLE : STEP_HIDDEN;
    }
  }

  private setDeltas(f: Frame): void {
    const rng = this.rng;
    const multiplier = this.conf.multiplier;
    let dx = 0;
    let dy = 0;
    let dice: number;
    switch (f.type) {
      case TRUNK:
        if (f.age <= 2 || f.life < 4) {
          dy = 0;
          dx = (rng.next() % 3) - 1;
        } else if (f.age < multiplier * 3) {
          if (f.age % Math.trunc(multiplier * 0.5) === 0) dy = -1;
          else dy = 0;
          dice = rng.next() % 10;
          if (dice === 0) dx = -2;
          else if (dice <= 3) dx = -1;
          else if (dice <= 5) dx = 0;
          else if (dice <= 8) dx = 1;
          else dx = 2;
        } else {
          dice = rng.next() % 10;
          if (dice > 2) dy = -1;
          else dy = 0;
          dx = (rng.next() % 3) - 1;
        }
        break;

      case SHOOT_LEFT:
        dice = rng.next() % 10;
        if (dice <= 1) dy = -1;
        else if (dice <= 7) dy = 0;
        else dy = 1;
        dice = rng.next() % 10;
        if (dice <= 1) dx = -2;
        else if (dice <= 5) dx = -1;
        else if (dice <= 8) dx = 0;
        else dx = 1;
        break;

      case SHOOT_RIGHT:
        dice = rng.next() % 10;
        if (dice <= 1) dy = -1;
        else if (dice <= 7) dy = 0;
        else dy = 1;
        dice = rng.next() % 10;
        if (dice <= 1) dx = 2;
        else if (dice <= 5) dx = 1;
        else if (dice <= 8) dx = 0;
        else dx = -1;
        break;

      case DYING:
        dice = rng.next() % 10;
        if (dice <= 1) dy = -1;
        else if (dice <= 8) dy = 0;
        else dy = 1;
        dice = rng.next() % 15;
        if (dice === 0) dx = -3;
        else if (dice <= 2) dx = -2;
        else if (dice <= 5) dx = -1;
        else if (dice <= 8) dx = 0;
        else if (dice <= 11) dx = 1;
        else if (dice <= 13) dx = 2;
        else dx = 3;
        break;

      case DEAD:
        dice = rng.next() % 10;
        if (dice <= 2) dy = -1;
        else if (dice <= 6) dy = 0;
        else dy = 1;
        dx = (rng.next() % 3) - 1;
        break;
    }
    f.dx = dx;
    f.dy = dy;
  }

  private chooseColor(type: BranchType): void {
    const tree = this.treeWin;
    const rng = this.rng;
    switch (type) {
      case TRUNK:
      case SHOOT_LEFT:
      case SHOOT_RIGHT:
        if (rng.next() % 2 === 0) {
          tree.bold = true;
          tree.color(this.pairColor(4));
        } else {
          tree.color(this.pairColor(2));
        }
        break;
      case DYING:
        if (rng.next() % 10 === 0) tree.bold = true;
        tree.color(this.pairColor(3));
        break;
      case DEAD:
        if (rng.next() % 3 === 0) tree.bold = true;
        tree.color(this.pairColor(1));
        break;
    }
  }

  private chooseString(type: BranchType, life: number, dx: number, dy: number): string {
    const conf = this.conf;
    if (life < 4) type = DYING;
    switch (type) {
      case TRUNK:
        if (dy === 0) return "/~";
        if (dx < 0) return "\\|";
        if (dx === 0) return "/|\\";
        return "|/";
      case SHOOT_LEFT:
        if (dy > 0) return "\\";
        if (dy === 0) return "\\_";
        if (dx < 0) return "\\|";
        if (dx === 0) return "/|";
        return "/";
      case SHOOT_RIGHT:
        if (dy > 0) return "/";
        if (dy === 0) return "_/";
        if (dx < 0) return "\\|";
        if (dx === 0) return "/|";
        return "/";
      default: {
        const leaf = conf.leaves[this.rng.next() % conf.leaves.length];
        // strncpy into a 32-byte buffer: at most 31 bytes survive.
        return truncateBytes(leaf, 31);
      }
    }
  }
}

/** The first `max` UTF-8 bytes of `s`, dropping a trailing partial code point as a C string would. */
function truncateBytes(s: string, max: number): string {
  const bytes = encoder.encode(s);
  if (bytes.length <= max) return s;
  return decoder.decode(bytes.subarray(0, max)).replace(/\uFFFD+$/, "");
}
