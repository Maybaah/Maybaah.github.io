/* arcade leaderboard: Cloudflare Worker + D1.

   Backs the global boards for the maybaah.github.io mini-games. Nothing is
   taken on faith from the client beyond elapsed time: a Wordle run is checked
   against the day's real answer, and a Minesweeper run ships its layout seed
   and move log so the Worker can rebuild the exact board and replay the game
   to the win. One row per player per board; lower score is always better.

   flowcode writes into the same table from its own Worker, which owns the
   replay because it needs that game's word engine. Its boards are readable
   from here so the leaderboard page can serve every game off one API. */
"use strict";

const ALLOWED_ORIGINS = [
  "https://maybaah.github.io",
  "http://localhost:8619",
  "http://127.0.0.1:8619",
];

const PROTOCOL = 1;
const MAX_BODY = 64 * 1024;
const MAX_PER_IP_PER_DAY = 120;
const TOP_N = 50;

const TOP_QUERY =
  `SELECT name, score, detail, created_at AS at
     FROM scores WHERE game = ?1 AND board = ?2
    ORDER BY score ASC, created_at ASC
    LIMIT ?3`;

/* ── shared PRNG: must match the games exactly ── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════ wordle ═══════════════ */

const ANSWERS = ("abide about above abuse actor acute admit adobe adopt adult after again agent agile agree ahead " +
  "alarm album alert alien align alike alive allow alone along aloud alpha altar alter amber amend among ample " +
  "angel anger angle angry ankle apart apple apply apron arena argue arise armor aroma array arrow aside asset " +
  "atlas audio audit avoid awake award aware awful bacon badge bagel baker banjo basic basil basin batch beach " +
  "beard beast began begin being belly below bench berry birth black blade blame bland blank blast blaze bleak " +
  "blend bless blind blink bliss block bloom blown bluff blunt blush board boast bonus boost booth bound brain " +
  "brake brand brave bread break breed brick bride brief bring brink brisk broad broke brook broom brown brush " +
  "buddy budge build built bulky bunch bunny burst buyer cabin cable cache camel candy canoe cargo carry carve " +
  "catch cause cedar chain chair chalk charm chart chase cheap check cheek cheer chess chest chief child chill " +
  "chime choir choke chord chose chunk churn cider cigar civic civil claim clamp clash clasp class clean clear " +
  "clerk click cliff climb cling cloak clock clone close cloth cloud clout clown coach coast cobra cocoa colon " +
  "color comet comic coral couch cough could count court cover crack craft crane crank crash crate crawl crazy " +
  "cream creek creep crepe crest crime crisp cross crowd crown crumb crush crust cubic curly curve cycle daily " +
  "dairy daisy dance dandy dealt debit debut decal decay decor decoy delay delta dense depot depth derby detox " +
  "devil diary digit diner dirty disco ditch diver dizzy dodge dolly donor donut dough dozen draft drain drake " +
  "drama drank dread dream dress dried drift drill drink drive drone drove drown druid dryer dusty dwell eager " +
  "eagle early earth easel eaten ebony eight eject elbow elder elect elite email ember empty enact endow enemy " +
  "enjoy enter entry envoy epoch equal equip erase error essay ethic evade event every evoke exact exile exist " +
  "extra fable facet faint fairy faith false fancy fatal fault favor feast fence ferry fetch fever fiber field " +
  "fiery fifth fifty fight final finch first fjord flair flake flame flash fleet flesh flick fling flint flirt " +
  "float flock flood floor flora floss flour fluid flush flute focal focus foggy force forge forth forty forum " +
  "found frame frank fraud fresh fried front frost frown froze fruit fudge fully funny fuzzy gamer gamma gauge " +
  "gaunt gecko genre ghost giant giddy given giver glade gland glare glass gleam glide globe gloom glory gloss " +
  "glove going goose gorge grace grade grain grand grant grape graph grasp grass grave gravy great greed green " +
  "greet grief grill grind groan groom grove growl grown guard guess guest guide guild gusto habit happy hardy " +
  "harsh haste hasty hatch haunt haven hazel heard heart heavy hedge hefty heist hello hence hobby hoist holly " +
  "honey honor horse hotel hound house hover human humid humor hurry hydra hyena ideal idiom image imply inbox " +
  "index inert infer inner input irony issue ivory jazzy jelly jewel joint jolly judge juice juicy jumbo jumpy " +
  "kayak kebab khaki kiosk kneel knife knock known koala label labor lance large laser latch later laugh layer " +
  "learn lease least leave ledge legal lemon level lever light lilac limit linen liner liver llama lobby local " +
  "lodge lofty logic login loose lorry lower loyal lucid lucky lunar lunch lyric macro magic magma maize major " +
  "mango manor maple march marsh match mayor medal media melon mercy merge merit merry metal meter metro micro " +
  "midst might mimic minor minus mirth model moist money month moose moral motel motif motor motto mound mount " +
  "mourn mouse mouth movie mural music naive nasal nasty naval nerdy nerve never newer newly niche niece night " +
  "ninja ninth noble noise noisy nomad north novel nurse nylon oasis occur ocean offer often olive onion onset " +
  "opera orbit order organ other otter ought ounce outer owner oxide ozone pagan paint panda panel panic paper " +
  "parka party pasta paste patch patio pause peace peach pearl pedal penny perch peril petal phase phone photo " +
  "piano piece pilot pinch pitch pivot pixel pizza place plaid plain plane plank plant plate plaza plead pluck " +
  "plumb plume point polar porch pouch pound power prank press price pride prime print prior prism prize probe " +
  "prone proof prose proud prove proxy prune pulse punch pupil puppy purse quack quake qualm quart queen query " +
  "quest queue quick quiet quill quilt quirk quota quote radar radio rainy raise rally ranch range rapid ratio " +
  "raven reach react ready realm rebel recap refer regal reign relax relay relic remix renew repay reply rerun " +
  "reset resin retro rhyme rider ridge rifle right rigid rinse ripen risky rival river roast robin robot rocky " +
  "rogue roost rotor rough round route royal rugby ruler rumor rural rusty saber salad salsa salty sandy sauce " +
  "sauna savor savvy scale scarf scene scent scoop scope score scout scrap screw scrub sedan seize sense serve " +
  "setup seven shade shady shaft shake shall shame shape share shark sharp shave shawl sheep sheet shelf shell " +
  "shift shine shiny shirt shock shore short shout shove shown shrub shrug sight sigma silky silly since siren " +
  "sixth sixty skate skill skirt skull slate sleek sleep slice slide slope sloth small smart smash smile smoke " +
  "snack snail snake sneak snowy sober solar solid solve sonic sorry sound south space spade spare spark spawn " +
  "speak spear speed spell spend spice spicy spike spine split spoke spoon sport spray spree squad squat stack " +
  "staff stage stain stair stake stale stalk stall stamp stand stare start state steak steal steam steel steep " +
  "steer stern stick stiff still sting stock stole stone stool store storm story stout stove strap straw stray " +
  "strip stuck study stuff stump style sugar suite sunny super surge sushi swamp swarm swear sweat sweep sweet " +
  "swell swift swing swirl sword syrup table taken tally tango tangy taste teach tempo tenor tense tenth thank " +
  "theft their theme there these thick thief thigh thing think third thorn those three threw throb throw thumb " +
  "thump tiara tidal tiger tight timer timid title toast today token tonic topaz topic torch total touch tough " +
  "towel tower toxic trace track trade trail train trait treat trend trial tribe trick troop trout truce truck " +
  "truly trunk trust truth tulip tunic turbo tutor tweed twice twist ultra uncle under undue unify union unite " +
  "unity until upper upset urban usage usher usual utter vague valid valor value valve vapor vault vegan venom " +
  "venue verse video vigor villa vinyl viola viper viral virus visit vista vital vivid vocal vodka vogue voice " +
  "vowel wafer wager wagon waist waltz waste watch water weary weave wedge weird whale wharf wheat wheel where " +
  "which while whisk white whole whose widow width wield windy witch witty woken woman women world worry worse " +
  "worst worth would wound woven wrath wreck wrist write wrong wrote yacht yeast yield young youth zebra zesty").split(" ");

const WORDLE_EPOCH = Date.UTC(2026, 0, 1);

const WORDLE_ORDER = (() => {
  const order = ANSWERS.slice();
  const rnd = mulberry32(20260101);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
})();

function wordleDayNumber(date) {
  const n = date || new Date();
  return Math.floor((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - WORDLE_EPOCH) / 864e5) + 1;
}

function wordleAnswer(day) {
  const len = WORDLE_ORDER.length;
  return WORDLE_ORDER[(((day - 1) % len) + len) % len];
}

function verifyWordle(body) {
  const day = Number(body.day);
  const today = wordleDayNumber();
  if (day !== today && day !== today - 1) {
    return { ok: false, reason: "that daily is closed" };
  }
  const guesses = body.guesses;
  if (!Array.isArray(guesses) || guesses.length < 1 || guesses.length > 6) {
    return { ok: false, reason: "bad guess list" };
  }
  const answer = wordleAnswer(day);
  for (let i = 0; i < guesses.length; i++) {
    const g = guesses[i];
    if (typeof g !== "string" || !/^[a-z]{5}$/.test(g)) return { ok: false, reason: "bad guess" };
    if (g === answer && i !== guesses.length - 1) return { ok: false, reason: "run continued past the answer" };
  }
  if (guesses[guesses.length - 1] !== answer) {
    return { ok: false, reason: "that run did not solve the daily" };
  }
  const timeMs = Number(body.timeMs);
  if (!Number.isInteger(timeMs) || timeMs < 200 || timeMs >= 1e8) {
    return { ok: false, reason: "bad time" };
  }
  return {
    ok: true,
    board: "daily-" + day,
    score: guesses.length * 1e8 + timeMs,
    detail: { guesses: guesses.length, timeMs, day },
  };
}

/* ═══════════════ minesweeper ═══════════════ */

const DIFFS = {
  beginner: { w: 9, h: 9, mines: 10 },
  intermediate: { w: 16, h: 16, mines: 40 },
  expert: { w: 30, h: 16, mines: 99 },
};

function neighborsOf(i, W, H) {
  const x = i % W, y = (i / W) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(ny * W + nx);
    }
  }
  return out;
}

/* identical to the game's placement: seeded partial Fisher-Yates over the
   cells outside the first click's 3x3 neighborhood */
function layoutMines(W, H, MINES, seed, safe) {
  const rnd = mulberry32(seed >>> 0);
  const forbidden = new Set(neighborsOf(safe, W, H));
  forbidden.add(safe);
  const spots = [];
  for (let i = 0; i < W * H; i++) if (!forbidden.has(i)) spots.push(i);
  const mines = new Array(W * H).fill(false);
  for (let m = 0; m < MINES; m++) {
    const j = m + Math.floor(rnd() * (spots.length - m));
    [spots[m], spots[j]] = [spots[j], spots[m]];
    mines[spots[m]] = true;
  }
  return mines;
}

function verifyMinesweeper(body) {
  const cfg = DIFFS[body.difficulty];
  if (!cfg) return { ok: false, reason: "bad difficulty" };
  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, reason: "bad seed" };
  }
  const moves = body.moves;
  const W = cfg.w, H = cfg.h, MINES = cfg.mines, N = W * H;
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 8000) {
    return { ok: false, reason: "bad move log" };
  }

  let mines = null, counts = null;
  const revealed = new Array(N).fill(false);
  const flagged = new Array(N).fill(false);
  let open = 0;

  function reveal(i) {
    if (revealed[i] || flagged[i]) return true;
    if (mines[i]) return false;
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop();
      if (revealed[cur] || flagged[cur]) continue;
      revealed[cur] = true;
      open++;
      if (counts[cur] === 0) {
        for (const n of neighborsOf(cur, W, H)) {
          if (!revealed[n] && !mines[n]) stack.push(n);
        }
      }
    }
    return true;
  }

  for (const mv of moves) {
    if (!Array.isArray(mv) || mv.length !== 2) return { ok: false, reason: "bad move" };
    const [a, i] = mv;
    if (!Number.isInteger(i) || i < 0 || i >= N) return { ok: false, reason: "bad move" };

    if (a === "r") {
      // mirrors the client: a reveal on a flagged or open cell is a no-op,
      // and the layout is only generated by the first reveal that lands
      if (revealed[i] || flagged[i]) continue;
      if (mines === null) {
        mines = layoutMines(W, H, MINES, seed, i);
        counts = new Array(N).fill(0);
        for (let c = 0; c < N; c++) {
          if (mines[c]) continue;
          counts[c] = neighborsOf(c, W, H).filter((n) => mines[n]).length;
        }
      }
      if (!reveal(i)) return { ok: false, reason: "that run hit a mine" };
    } else if (a === "f") {
      if (!revealed[i]) flagged[i] = !flagged[i];
    } else if (a === "c") {
      if (mines === null || !revealed[i] || counts[i] === 0) continue;
      const ns = neighborsOf(i, W, H);
      if (ns.filter((n) => flagged[n]).length !== counts[i]) continue;
      for (const n of ns) {
        if (!flagged[n] && !revealed[n] && !reveal(n)) {
          return { ok: false, reason: "that run hit a mine" };
        }
      }
    } else {
      return { ok: false, reason: "bad move" };
    }
  }

  if (open !== N - MINES) return { ok: false, reason: "that run did not clear the board" };

  const timeMs = Number(body.timeMs);
  if (!Number.isInteger(timeMs) || timeMs < 500 || timeMs >= 1e8) {
    return { ok: false, reason: "bad time" };
  }
  return {
    ok: true,
    board: body.difficulty,
    score: timeMs,
    detail: { timeMs, moves: moves.length },
  };
}

/* ═══════════════ sudoku ═══════════════ */

/* ── the generator ──────────────────────────────────────────────────────────
   Duplicated in sudoku/game.js. The page draws whatever this builds and this
   copy rebuilds the same puzzle from the same seed to audit the run, so drift
   means the two disagree about which squares were the player's to fill and
   every solve is rejected. Same rule as the PRNG above.
   ────────────────────────────────────────────────────────────────────────── */

var SUDOKU_CLUES = { easy: 42, medium: 32, hard: 26 };

var SUDOKU_PEERS = (function () {
  var peers = [];
  for (var i = 0; i < 81; i++) {
    var ri = (i / 9) | 0, ci = i % 9;
    var bi = ((ri / 3) | 0) * 3 + ((ci / 3) | 0);
    var set = [];
    for (var j = 0; j < 81; j++) {
      if (j === i) continue;
      var rj = (j / 9) | 0, cj = j % 9;
      var bj = ((rj / 3) | 0) * 3 + ((cj / 3) | 0);
      if (ri === rj || ci === cj || bi === bj) set.push(j);
    }
    peers.push(set);
  }
  return peers;
})();

function sudokuShuffle(arr, rnd) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* A solved grid, built from the canonical pattern and then relabelled and
   shuffled by band, stack and row. Every one of those moves maps a valid
   grid to another valid grid, so no search is needed to get here. */
function sudokuSolved(rnd) {
  var digits = sudokuShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rnd);
  var bands = sudokuShuffle([0, 1, 2], rnd);
  var stacks = sudokuShuffle([0, 1, 2], rnd);
  var rows = [], cols = [], b, k;
  for (b = 0; b < 3; b++) {
    var inner = sudokuShuffle([0, 1, 2], rnd);
    for (k = 0; k < 3; k++) rows.push(bands[b] * 3 + inner[k]);
  }
  for (b = 0; b < 3; b++) {
    var innerCol = sudokuShuffle([0, 1, 2], rnd);
    for (k = 0; k < 3; k++) cols.push(stacks[b] * 3 + innerCol[k]);
  }
  var flip = rnd() < 0.5;
  var g = new Array(81);
  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      var sr = rows[r], sc = cols[c];
      g[flip ? c * 9 + r : r * 9 + c] = digits[(3 * (sr % 3) + ((sr / 3) | 0) + sc) % 9];
    }
  }
  return g;
}

/* Solutions, counted no further than two: the digger only ever asks whether
   the puzzle still pins down exactly one answer. Fewest candidates first, so
   a forced square is taken before anything is branched on. */
function sudokuCountSolutions(grid) {
  var cand = new Int32Array(81).fill(0x1ff);
  var work = grid.slice();
  var found = 0;
  var i, p, ps, bit;

  for (i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    bit = 1 << (grid[i] - 1);
    ps = SUDOKU_PEERS[i];
    for (p = 0; p < ps.length; p++) cand[ps[p]] &= ~bit;
  }

  function search() {
    var best = -1, bestN = 10, m, n, i, d, p, ps, bit, undo, u;
    for (i = 0; i < 81; i++) {
      if (work[i]) continue;
      m = cand[i]; n = 0;
      while (m) { m &= m - 1; n++; }
      if (n === 0) return;
      if (n < bestN) { bestN = n; best = i; if (n === 1) break; }
    }
    if (best < 0) { found++; return; }
    for (d = 0; d < 9; d++) {
      bit = 1 << d;
      if (!(cand[best] & bit)) continue;
      work[best] = d + 1;
      undo = [];
      ps = SUDOKU_PEERS[best];
      for (p = 0; p < ps.length; p++) {
        if (cand[ps[p]] & bit) { cand[ps[p]] &= ~bit; undo.push(ps[p]); }
      }
      search();
      for (u = 0; u < undo.length; u++) cand[undo[u]] |= bit;
      work[best] = 0;
      if (found > 1) return;
    }
  }

  search();
  return found;
}

/* Digs squares out of a solved grid in a seeded order, in pairs about the
   center so the result is symmetric, and keeps a removal only while the
   answer stays unique. Difficulty is how bare it is allowed to get. */
function sudokuGenerate(seed, difficulty) {
  var rnd = mulberry32(seed >>> 0);
  var solution = sudokuSolved(rnd);
  var puzzle = solution.slice();
  var target = SUDOKU_CLUES[difficulty];
  var clues = 81;
  var order = [], i;
  for (i = 0; i < 81; i++) order.push(i);
  sudokuShuffle(order, rnd);
  for (var k = 0; k < order.length && clues > target; k++) {
    var a = order[k], b = 80 - a;
    if (!puzzle[a]) continue;
    var va = puzzle[a], vb = puzzle[b];
    var drop = a === b || !vb ? 1 : 2;
    puzzle[a] = 0; puzzle[b] = 0;
    if (sudokuCountSolutions(puzzle) === 1) clues -= drop;
    else { puzzle[a] = va; puzzle[b] = vb; }
  }
  return { puzzle: puzzle, solution: solution, clues: clues };
}

/* ── end of the generator ── */

function verifySudoku(body) {
  if (!SUDOKU_CLUES[body.difficulty]) return { ok: false, reason: "bad difficulty" };
  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, reason: "bad seed" };
  }
  const moves = body.moves;
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 4000) {
    return { ok: false, reason: "bad move log" };
  }

  const built = sudokuGenerate(seed, body.difficulty);
  const puzzle = built.puzzle, solution = built.solution;
  const grid = puzzle.slice();
  let slips = 0;

  for (const mv of moves) {
    if (!Array.isArray(mv)) return { ok: false, reason: "bad move" };
    const i = mv[1];
    if (!Number.isInteger(i) || i < 0 || i >= 81) return { ok: false, reason: "bad move" };
    // the givens are not the player's to touch, in either direction
    if (puzzle[i]) return { ok: false, reason: "that run wrote over a given" };
    if (mv[0] === "x" && mv.length === 2) {
      grid[i] = 0;
    } else if (mv[0] === "s" && mv.length === 3 && Number.isInteger(mv[2]) && mv[2] >= 1 && mv[2] <= 9) {
      if (mv[2] !== solution[i]) slips++;
      grid[i] = mv[2];
    } else {
      return { ok: false, reason: "bad move" };
    }
  }

  // the puzzle was dug to have exactly one answer, so matching it is the
  // whole of "solved"
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== solution[i]) return { ok: false, reason: "that run did not solve the puzzle" };
  }

  const timeMs = Number(body.timeMs);
  // the easiest grid still leaves 39 squares to type by hand, so anything
  // under five seconds was not typed by a person
  if (!Number.isInteger(timeMs) || timeMs < 5000 || timeMs >= 1e8) {
    return { ok: false, reason: "bad time" };
  }
  return {
    ok: true,
    board: body.difficulty,
    score: timeMs,
    detail: { timeMs, slips, moves: moves.length },
  };
}

/* ═══════════════ 2048 ═══════════════ */

/* Line of flat indices for each row/column, ordered from the destination edge
   inward, so a slide always compacts toward index 0 of the line. Mirrors the
   game's copy exactly. */
const G2048_LINES = (() => {
  const size = 4, out = {};
  for (const dir of ["u", "r", "d", "l"]) {
    const group = [];
    for (let i = 0; i < size; i++) {
      const line = [];
      for (let j = 0; j < size; j++) {
        if (dir === "l") line.push(i * size + j);
        else if (dir === "r") line.push(i * size + (size - 1 - j));
        else if (dir === "u") line.push(j * size + i);
        else line.push((size - 1 - j) * size + i);
      }
      group.push(line);
    }
    out[dir] = group;
  }
  return out;
})();

function slide2048(values, dir) {
  let moved = false, gained = 0;
  for (const line of G2048_LINES[dir]) {
    const seq = [];
    for (const idx of line) if (values[idx]) seq.push({ v: values[idx], from: idx });

    const result = [];
    for (let i = 0; i < seq.length; i++) {
      if (i + 1 < seq.length && seq[i].v === seq[i + 1].v) {
        const merged = seq[i].v * 2;
        gained += merged;
        result.push(merged);
        moved = true;
        i++;
      } else {
        result.push(seq[i].v);
      }
    }

    for (let k = 0; k < line.length; k++) {
      const next = k < result.length ? result[k] : 0;
      if (values[line[k]] !== next) moved = true;
      values[line[k]] = next;
    }
  }
  return { moved, gained };
}

function spawn2048(values, rnd) {
  const empties = [];
  for (let i = 0; i < values.length; i++) if (!values[i]) empties.push(i);
  if (!empties.length) return;
  const index = empties[Math.floor(rnd() * empties.length)];
  values[index] = rnd() < 0.9 ? 2 : 4;
}

function movesLeft2048(values) {
  for (let i = 0; i < values.length; i++) {
    if (!values[i]) return true;
    const r = (i / 4) | 0, c = i % 4;
    if (c + 1 < 4 && values[i + 1] === values[i]) return true;
    if (r + 1 < 4 && values[i + 4] === values[i]) return true;
  }
  return false;
}

function verify2048(body) {
  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, reason: "bad seed" };
  }
  const moves = body.moves;
  if (typeof moves !== "string" || !/^[udlr]{1,20000}$/.test(moves)) {
    return { ok: false, reason: "bad move log" };
  }

  const rnd = mulberry32(seed >>> 0);
  const values = new Array(16).fill(0);
  spawn2048(values, rnd);
  spawn2048(values, rnd);

  let score = 0;
  for (const dir of moves) {
    const step = slide2048(values, dir);
    // the game only records moves that changed something, so a no-op here
    // means the tape does not belong to this seed
    if (!step.moved) return { ok: false, reason: "move log does not match the board" };
    score += step.gained;
    spawn2048(values, rnd);
  }

  if (movesLeft2048(values)) return { ok: false, reason: "that run is not finished" };

  const maxTile = Math.max(...values);
  return {
    ok: true,
    board: "classic",
    // boards sort ascending, so a higher score has to compare lower
    score: -score,
    detail: { points: score, maxTile, moves: moves.length },
  };
}

/* ═══════════════ snake ═══════════════ */

/* A snake run is tick-discrete, so a seed plus the ticks at which the player
   turned describes it completely. The tape is a run of <tickDelta><dir> pairs;
   everything below mirrors the game's copy exactly. Boost never appears here:
   it only shortens the client's timer, so it changes how long a run takes in
   real time and not how many ticks it takes. */

const SNAKE_W = 20, SNAKE_H = 20, SNAKE_CELLS = SNAKE_W * SNAKE_H;
const SNAKE_START_LEN = 3;
const SNAKE_MAX_TICKS = 50000;
const SNAKE_MAX_EVENTS = 8000;
const SNAKE_OPPOSITE = { u: "d", d: "u", l: "r", r: "l" };

function snakeSeedForDay(day) {
  return Math.imul(day, 2654435761) >>> 0;
}

/* free cells in ascending index order, then one draw */
function snakeSpawnApple(occ, rnd) {
  const free = [];
  for (let i = 0; i < SNAKE_CELLS; i++) if (!occ[i]) free.push(i);
  if (!free.length) return -1;
  return free[Math.floor(rnd() * free.length)];
}

function snakeNewState(seed) {
  const rnd = mulberry32(seed >>> 0);
  const occ = new Uint8Array(SNAKE_CELLS);
  const start = ((SNAKE_H / 2) | 0) * SNAKE_W + ((SNAKE_W / 2) | 0);
  const body = [];
  for (let i = 0; i < SNAKE_START_LEN; i++) {
    body.push(start - i);
    occ[start - i] = 1;
  }
  const st = { rnd, occ, body, dir: "r", apples: 0, steps: 0, route: 0, apple: -1, done: false };
  st.apple = snakeSpawnApple(occ, rnd);
  return st;
}

function snakeStep(st) {
  const head = st.body[0];
  let x = head % SNAKE_W, y = (head / SNAKE_W) | 0;
  if (st.dir === "l") x--;
  else if (st.dir === "r") x++;
  else if (st.dir === "u") y--;
  else y++;

  if (x < 0 || x >= SNAKE_W || y < 0 || y >= SNAKE_H) { st.done = true; return; }
  const next = y * SNAKE_W + x;

  const last = st.body[st.body.length - 1];
  const eat = next === st.apple;
  // the tail cell is vacated on this same tick unless the apple is there
  if (st.occ[next] && !(next === last && !eat)) { st.done = true; return; }

  if (!eat) {
    st.body.pop();
    st.occ[last] = 0;
  }
  st.body.unshift(next);
  st.occ[next] = 1;
  st.steps++;

  if (eat) {
    st.apples++;
    st.route = st.steps;
    st.apple = snakeSpawnApple(st.occ, st.rnd);
    if (st.apple < 0) st.done = true;
  }
}

function verifySnake(body) {
  const mode = body.mode === "daily" || body.mode === "classic" ? body.mode : null;
  if (!mode) return { ok: false, reason: "bad mode" };

  const today = utcDayKey();
  let seed;
  if (mode === "daily") {
    // the client's seed is ignored: the day, and therefore the apples, are
    // this Worker's to decide
    if (Number(body.day) !== today) {
      return { ok: false, reason: "that daily has rolled over, reload the page" };
    }
    seed = snakeSeedForDay(today);
  } else {
    seed = Number(body.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      return { ok: false, reason: "bad seed" };
    }
  }

  const moves = body.moves;
  if (typeof moves !== "string" || moves.length > 6 * SNAKE_MAX_EVENTS) {
    return { ok: false, reason: "bad move log" };
  }
  if (!/^(\d{1,5}[udlr])*$/.test(moves)) return { ok: false, reason: "bad move log" };
  const events = moves.match(/\d{1,5}[udlr]/g) || [];

  const st = snakeNewState(seed);
  let tick = 0, lastEventTick = 0, prevTick = -1;

  for (const ev of events) {
    const dir = ev[ev.length - 1];
    const target = lastEventTick + Number(ev.slice(0, -1));
    if (target > SNAKE_MAX_TICKS) return { ok: false, reason: "that run is too long" };
    // the game applies at most one turn per tick, so a second one on the same
    // tick is a tape no client could have produced
    if (target <= prevTick) return { ok: false, reason: "two turns on one tick" };
    while (tick < target) {
      snakeStep(st);
      tick++;
      if (st.done) return { ok: false, reason: "move log runs past the end of the run" };
    }
    // the game only records turns that change the heading, so a repeat or a
    // reversal means the tape does not belong to this run
    if (dir === st.dir || dir === SNAKE_OPPOSITE[st.dir]) {
      return { ok: false, reason: "move log does not match the run" };
    }
    st.dir = dir;
    prevTick = target;
    lastEventTick = target;
  }

  // with no turns left the snake always reaches a wall, so this terminates
  while (!st.done) {
    snakeStep(st);
    tick++;
    if (tick > SNAKE_MAX_TICKS) return { ok: false, reason: "that run is too long" };
  }

  return {
    ok: true,
    board: mode === "daily" ? "daily-" + today : "classic",
    /* Boards sort ascending, so more apples has to compare lower; equal apples
       are broken by the shorter route. The route is measured to the last apple,
       not to the crash: the steps a snake takes while dying say nothing about
       how well it ate, and counting them would let anyone shave their tiebreak
       by cutting the tape short of the crash. */
    score: -(st.apples * 1000000) + st.route,
    detail: { apples: st.apples, steps: st.route, total: st.steps, length: st.body.length, mode },
  };
}

/* ═══════════════ pacman ═══════════════ */

/* ── the engine ──
   Duplicated, byte for byte, from pacman/game.js. Same rule as the sudoku
   generator: drift means the page offers a run this referee rebuilds
   differently, and every submission stops verifying. */

  const PAC_MAZE = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.#####.##.#####.######",
    "     #.##### ## #####.#     ",
    "     #.##          ##.#     ",
    "     #.## ###--### ##.#     ",
    "######.## #      # ##.######",
    "          #      #          ",
    "######.## #      # ##.######",
    "     #.## ######## ##.#     ",
    "     #.##          ##.#     ",
    "     #.## ######## ##.#     ",
    "######.## ######## ##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#.####.#####.##.#####.####.#",
    "#o..##.......  .......##..o#",
    "###.##.##.########.##.##.###",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#.##########.##.##########.#",
    "#..........................#",
    "############################",
  ];
  const PAC_COLS = 28, PAC_ROWS = 31, PAC_TILE = 16;
  const PAC_FULL = 2.0, PAC_FPS = 60;
  const PAC_GRID = PAC_MAZE.map((r) => r.split(""));

  const PAC_DIRS = {
    up: { x: 0, y: -1 },
    left: { x: -1, y: 0 },
    down: { x: 0, y: 1 },
    right: { x: 1, y: 0 },
  };
  const PAC_DIR_ORDER = ["up", "left", "down", "right"];
  const PAC_DIR_CHAR = { up: "u", left: "l", down: "d", right: "r" };
  const PAC_OPP = { up: "down", down: "up", left: "right", right: "left" };
  /* Tiles where a chasing or scattering ghost may not choose to turn upward,
     exactly as the arcade forbids it above the house and in the lower field. */
  const PAC_NO_UP = ["12,11", "15,11", "12,23", "15,23"];

  const PAC_SCHEDULE = [
    { mode: "scatter", t: 7 }, { mode: "chase", t: 20 },
    { mode: "scatter", t: 7 }, { mode: "chase", t: 20 },
    { mode: "scatter", t: 5 }, { mode: "chase", t: 20 },
    { mode: "scatter", t: 5 }, { mode: "chase", t: Infinity },
  ];

  const PAC_CAST = [
    { name: "blinky", scatter: { x: 25, y: 0 }, seatCol: 13, dotLimit: 0 },
    { name: "pinky", scatter: { x: 2, y: 0 }, seatCol: 13, dotLimit: 0 },
    { name: "inky", scatter: { x: 27, y: 30 }, seatCol: 11, dotLimit: 30 },
    { name: "clyde", scatter: { x: 0, y: 30 }, seatCol: 15, dotLimit: 60 },
  ];

  function pacMulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pacLevelCfg(L) {
    return {
      pac: L === 1 ? 0.8 : L <= 4 ? 0.9 : 1.0,
      pacFright: L === 1 ? 0.9 : L <= 4 ? 0.95 : 1.0,
      ghost: L === 1 ? 0.75 : L <= 4 ? 0.85 : 0.95,
      fright: L === 1 ? 0.5 : L <= 4 ? 0.55 : 0.6,
      tunnel: L === 1 ? 0.4 : L <= 4 ? 0.45 : 0.5,
      frightSec: L <= 1 ? 6 : L <= 2 ? 5 : L <= 4 ? 3 : L <= 6 ? 2 : L <= 9 ? 1 : 0,
      elroy1: 20, elroy2: 10,
    };
  }

  const pacCX = (tx) => tx * PAC_TILE + PAC_TILE / 2;
  const pacCY = (ty) => ty * PAC_TILE + PAC_TILE / 2;
  const pacIsDoor = (x, y) => y === 12 && (x === 13 || x === 14);
  const pacInHouse = (x, y) => y >= 13 && y <= 15 && x >= 11 && x <= 16;

  function pacWrapCol(x) {
    if (x < 0) return PAC_COLS - 1;
    if (x >= PAC_COLS) return 0;
    return x;
  }

  /* mode: "pac" and "out" are blocked by the door and the house, "free" (a
     ghost leaving, returning as eyes, or re-entering) may pass both. */
  function pacCanEnter(x, y, mode) {
    if (y < 0 || y >= PAC_ROWS) return false;
    if (PAC_GRID[y][x] === "#") return false;
    if (mode === "free") return true;
    if (pacIsDoor(x, y) || pacInHouse(x, y)) return false;
    return true;
  }

  function pacFruitPoints(L) {
    const table = [100, 300, 500, 500, 700, 700, 1000, 1000, 2000, 2000, 3000, 3000, 5000];
    return table[Math.min(L - 1, table.length - 1)];
  }

  function pacBuildDots(S) {
    S.dots = [];
    S.dotTotal = 0;
    for (let y = 0; y < PAC_ROWS; y++) {
      S.dots[y] = [];
      for (let x = 0; x < PAC_COLS; x++) {
        const ch = PAC_GRID[y][x];
        if (ch === ".") { S.dots[y][x] = 1; S.dotTotal++; }
        else if (ch === "o") { S.dots[y][x] = 2; S.dotTotal++; }
        else S.dots[y][x] = 0;
      }
    }
  }

  function pacSeat(S, g, tx, ty, st) {
    g.tx = tx; g.ty = ty; g.px = pacCX(tx); g.py = pacCY(ty); g.state = st;
  }

  function pacPlaceActors(S) {
    const p = S.pac;
    p.tx = 14; p.ty = 23; p.px = pacCX(14); p.py = pacCY(23);
    p.dir = "left"; p.next = "left"; p.deadT = 0;
    for (const g of S.ghosts) {
      g.frightened = false; g.reverse = false; g.bob = 0;
      g.dir = g.name === "blinky" ? "left" : "up";
    }
    pacSeat(S, S.ghosts[0], 13, 11, "out");
    pacSeat(S, S.ghosts[1], 13, 14, "home");
    pacSeat(S, S.ghosts[2], 11, 14, "home");
    pacSeat(S, S.ghosts[3], 15, 14, "home");
  }

  function pacResetLevel(S, full) {
    S.cfg = pacLevelCfg(S.level);
    if (full) pacBuildDots(S);
    let left = 0;
    for (let y = 0; y < PAC_ROWS; y++) for (let x = 0; x < PAC_COLS; x++) if (S.dots[y][x]) left++;
    S.dotsLeft = left;
    S.dotsEaten = S.dotTotal - left;
    S.scheduleIdx = 0; S.scheduleT = 0; S.globalMode = PAC_SCHEDULE[0].mode;
    S.frightT = 0; S.ghostCombo = 0; S.forceTimer = 0;
    S.fruit = null; S.popup = null;
    for (const g of S.ghosts) { g.dotCount = 0; g.released = g.name === "blinky"; }
    pacPlaceActors(S);
  }

  function pacNew(seed) {
    const S = {
      seed: seed >>> 0,
      rnd: pacMulberry32(seed >>> 0),
      dots: null, dotTotal: 0, dotsLeft: 0, dotsEaten: 0,
      level: 1, lives: 3, score: 0,
      state: "ready", stateT: 0, frame: 0,
      cfg: null,
      pac: { tx: 0, ty: 0, px: 0, py: 0, dir: "left", next: "left", deadT: 0 },
      ghosts: PAC_CAST.map((c) => ({
        name: c.name, scatter: c.scatter, seatCol: c.seatCol, dotLimit: c.dotLimit,
        tx: 0, ty: 0, px: 0, py: 0, dir: "left", state: "home",
        dotCount: 0, released: false, frightened: false, reverse: false, bob: 0,
      })),
      scheduleIdx: 0, scheduleT: 0, globalMode: "scatter",
      frightT: 0, ghostCombo: 0, forceTimer: 0,
      fruit: null, popup: null, extraAwarded: false, over: false,
      turns: [],
    };
    pacResetLevel(S, true);
    return S;
  }

  function pacSetDir(S, dir) {
    if (PAC_DIRS[dir]) S.pac.next = dir;
  }

  /* Move `e` by `dist` pixels. Position between two tile centers is tracked as
     progress from (tx,ty)'s centre, so fractional speeds never drift: every
     crossing re-snaps exactly, and turns are only offered at a centre. */
  function pacAdvance(S, e, dist, decide) {
    let budget = dist, guard = 0;
    while (budget > 1e-6 && guard++ < 32) {
      const progress = Math.abs(e.px - pacCX(e.tx)) + Math.abs(e.py - pacCY(e.ty));
      if (progress < 1e-6) {
        const chosen = decide(S, e);
        if (!chosen) return;
        e.dir = chosen;
      }
      const d = PAC_DIRS[e.dir];
      const remaining = PAC_TILE - Math.abs(e.px - pacCX(e.tx)) - Math.abs(e.py - pacCY(e.ty));
      const step = Math.min(budget, remaining);
      if (step >= remaining - 1e-6) {
        e.tx = pacWrapCol(e.tx + d.x);
        e.ty = e.ty + d.y;
        e.px = pacCX(e.tx);
        e.py = pacCY(e.ty);
        budget -= remaining;
      } else {
        e.px += d.x * step; e.py += d.y * step;
        budget -= step;
      }
    }
  }

  function pacDecidePac(S, e) {
    const nd = PAC_DIRS[e.next];
    if (pacCanEnter(pacWrapCol(e.tx + nd.x), e.ty + nd.y, "pac")) {
      if (e.next !== e.dir) S.turns.push({ f: S.frame, d: e.next });
      return e.next;
    }
    const cd = PAC_DIRS[e.dir];
    if (pacCanEnter(pacWrapCol(e.tx + cd.x), e.ty + cd.y, "pac")) return e.dir;
    return null;
  }

  function pacGhostTarget(S, g) {
    if (g.state === "eyes") return { x: 13, y: 11 };
    if (S.globalMode === "scatter" && !g.frightened) return g.scatter;
    const p = { x: S.pac.tx, y: S.pac.ty };
    const pd = PAC_DIRS[S.pac.dir];
    if (g.name === "blinky") return p;
    if (g.name === "pinky") {
      // four tiles ahead, carrying the arcade's up-vector overflow
      let tx = p.x + pd.x * 4, ty = p.y + pd.y * 4;
      if (S.pac.dir === "up") tx -= 4;
      return { x: tx, y: ty };
    }
    if (g.name === "inky") {
      let tx = p.x + pd.x * 2, ty = p.y + pd.y * 2;
      if (S.pac.dir === "up") tx -= 2;
      const b = S.ghosts[0];
      return { x: tx * 2 - b.tx, y: ty * 2 - b.ty };
    }
    const dx = g.tx - p.x, dy = g.ty - p.y;
    if (dx * dx + dy * dy > 64) return p;
    return g.scatter;
  }

  function pacDecideGhost(S, g) {
    const mode = (g.state === "eyes" || g.state === "leaving" || g.state === "entering") ? "free" : "out";
    const back = PAC_OPP[g.dir];

    if (g.reverse) {
      g.reverse = false;
      const d = PAC_DIRS[back];
      if (pacCanEnter(pacWrapCol(g.tx + d.x), g.ty + d.y, mode)) return back;
    }

    if (g.frightened && g.state === "out") {
      const opts = [];
      for (const name of PAC_DIR_ORDER) {
        if (name === back) continue;
        const d = PAC_DIRS[name];
        if (pacCanEnter(pacWrapCol(g.tx + d.x), g.ty + d.y, mode)) opts.push(name);
      }
      const list = opts.length ? opts : [back];
      return list[Math.floor(S.rnd() * list.length) % list.length];
    }

    const target = pacGhostTarget(S, g);
    let best = null, bestDist = Infinity;
    for (const name of PAC_DIR_ORDER) {
      if (name === back) continue;
      if (name === "up" && mode === "out" && PAC_NO_UP.indexOf(g.tx + "," + g.ty) !== -1) continue;
      const d = PAC_DIRS[name];
      const nx = pacWrapCol(g.tx + d.x), ny = g.ty + d.y;
      if (!pacCanEnter(nx, ny, mode)) continue;
      const ddx = nx - target.x, ddy = ny - target.y;
      const dist = ddx * ddx + ddy * ddy;
      if (dist < bestDist) { bestDist = dist; best = name; }
    }
    if (best) return best;
    const d = PAC_DIRS[back];
    if (pacCanEnter(pacWrapCol(g.tx + d.x), g.ty + d.y, mode)) return back;
    return g.dir;
  }

  function pacGhostSpeed(S, g) {
    if (g.state === "eyes") return PAC_FULL * 1.5;
    if (g.state === "leaving" || g.state === "entering" || g.state === "home") return PAC_FULL * 0.5;
    if (g.frightened) return PAC_FULL * S.cfg.fright;
    if (g.ty === 14 && (g.tx <= 5 || g.tx >= 22)) return PAC_FULL * S.cfg.tunnel;
    if (g.name === "blinky") {
      if (S.dotsLeft <= S.cfg.elroy2) return PAC_FULL * 0.85;
      if (S.dotsLeft <= S.cfg.elroy1) return PAC_FULL * 0.8;
    }
    return PAC_FULL * S.cfg.ghost;
  }

  function pacStepHouse(S, g) {
    const exitX = pacCX(13), topY = pacCY(11), midY = pacCY(14);
    if (g.state === "home") {
      g.bob += 1;
      g.py = pacCY(14) + Math.sin(g.bob * 0.12) * 4;
      g.px = pacCX(g.seatCol);
      return;
    }
    if (g.state === "leaving") {
      const sp = PAC_FULL * 0.5;
      if (Math.abs(g.px - exitX) > 0.5) {
        g.px += Math.sign(exitX - g.px) * Math.min(sp, Math.abs(exitX - g.px));
        g.py = midY;
      } else {
        g.px = exitX;
        g.py -= Math.min(sp, g.py - topY);
        if (g.py <= topY) {
          g.py = topY; g.tx = 13; g.ty = 11;
          g.state = "out"; g.dir = "left";
          g.frightened = S.frightT > 0;
        }
      }
      return;
    }
    if (g.state === "entering") {
      const sp = PAC_FULL * 0.8;
      if (Math.abs(g.px - exitX) > 0.5) {
        g.px += Math.sign(exitX - g.px) * Math.min(sp, Math.abs(exitX - g.px));
      } else if (g.py < midY) {
        g.px = exitX;
        g.py += Math.min(sp, midY - g.py);
      } else {
        g.py = midY; g.tx = 13; g.ty = 14;
        g.state = "leaving";
      }
    }
  }

  function pacReleaseNext(S) {
    for (let i = 1; i < S.ghosts.length; i++) {
      const g = S.ghosts[i];
      if (g.state === "home" && !g.released) { g.released = true; g.state = "leaving"; return true; }
    }
    return false;
  }

  function pacHouseCounters(S) {
    for (let i = 1; i < S.ghosts.length; i++) {
      const g = S.ghosts[i];
      if (g.state === "home") {
        if (!g.released) {
          g.dotCount++;
          if (g.dotCount >= g.dotLimit) { g.released = true; g.state = "leaving"; }
        }
        return;
      }
    }
  }

  function pacStepMode(S) {
    if (S.frightT > 0) return;            // the schedule freezes while frightened
    const cur = PAC_SCHEDULE[S.scheduleIdx];
    if (cur.t === Infinity) { S.globalMode = cur.mode; return; }
    S.scheduleT++;
    if (S.scheduleT >= cur.t * PAC_FPS) {
      S.scheduleIdx = Math.min(S.scheduleIdx + 1, PAC_SCHEDULE.length - 1);
      S.scheduleT = 0;
      const nm = PAC_SCHEDULE[S.scheduleIdx].mode;
      if (nm !== S.globalMode) {
        S.globalMode = nm;
        for (const g of S.ghosts) if (g.state === "out") g.reverse = true;
      }
    }
  }

  function pacStartFright(S) {
    if (S.cfg.frightSec <= 0) { S.ghostCombo = 0; return; }
    S.frightT = S.cfg.frightSec * PAC_FPS;
    S.ghostCombo = 0;
    for (const g of S.ghosts) {
      if (g.state === "out") { g.frightened = true; g.reverse = true; }
    }
  }

  function pacCheckExtra(S) {
    if (!S.extraAwarded && S.score >= 10000) { S.extraAwarded = true; S.lives++; }
  }

  function pacEatDot(S, x, y) {
    const kind = S.dots[y][x];
    S.dots[y][x] = 0;
    S.dotsLeft--; S.dotsEaten++;
    S.forceTimer = 0;
    pacHouseCounters(S);
    if (kind === 2) { S.score += 50; pacStartFright(S); }
    else S.score += 10;
    if ((S.dotsEaten === 70 || S.dotsEaten === 170) && !S.fruit) {
      S.fruit = { tx: 13, ty: 17, points: pacFruitPoints(S.level), t: 9 * PAC_FPS + Math.floor(S.rnd() * PAC_FPS) };
    }
    pacCheckExtra(S);
    if (S.dotsLeft <= 0) { S.state = "clear"; S.stateT = 0; }
  }

  function pacCollide(S) {
    for (const g of S.ghosts) {
      if (g.state !== "out") continue;
      const dx = g.px - S.pac.px, dy = g.py - S.pac.py;
      if (dx * dx + dy * dy > 100) continue;
      if (g.frightened) {
        const pts = 200 * (1 << S.ghostCombo);
        S.ghostCombo = Math.min(S.ghostCombo + 1, 3);
        S.score += pts;
        S.popup = { x: g.px, y: g.py, text: String(pts), t: 40 };
        g.state = "eyes"; g.frightened = false;
        pacCheckExtra(S);
      } else {
        S.pac.deadT = 0;
        S.state = "dying"; S.stateT = 0;
        return;
      }
    }
  }

  /* One logical tick at 60Hz. Every branch is a pure function of S, so the
     Worker walking the same tape lands on the same score. */
  function pacStep(S) {
    S.frame++;

    if (S.state === "ready") {
      S.stateT++;
      if (S.stateT > 2 * PAC_FPS) { S.state = "play"; S.stateT = 0; }
      return;
    }
    if (S.state === "clear") {
      S.stateT++;
      if (S.stateT > 2 * PAC_FPS) {
        S.level++;
        pacResetLevel(S, true);
        S.state = "ready"; S.stateT = 0;
      }
      return;
    }
    if (S.state === "dying") {
      S.stateT++;
      S.pac.deadT = S.stateT;
      if (S.stateT > 1.6 * PAC_FPS) {
        S.lives--;
        if (S.lives <= 0) { S.state = "over"; S.over = true; return; }
        pacResetLevel(S, false);
        S.state = "ready"; S.stateT = 0;
      }
      return;
    }
    if (S.state !== "play") return;

    const p = S.pac;
    pacAdvance(S, p, S.frightT > 0 ? PAC_FULL * S.cfg.pacFright : PAC_FULL * S.cfg.pac, pacDecidePac);
    if (S.dots[p.ty] && S.dots[p.ty][p.tx]) pacEatDot(S, p.tx, p.ty);
    if (S.state !== "play") return;

    if (S.fruit) {
      S.fruit.t--;
      if (S.fruit.t <= 0) S.fruit = null;
      else {
        const dx = pacCX(S.fruit.tx) - p.px, dy = pacCY(S.fruit.ty) - p.py;
        if (dx * dx + dy * dy < 100) {
          S.score += S.fruit.points;
          S.popup = { x: p.px, y: p.py, text: String(S.fruit.points), t: 50 };
          S.fruit = null;
          pacCheckExtra(S);
        }
      }
    }

    pacStepMode(S);
    if (S.frightT > 0) {
      S.frightT--;
      if (S.frightT === 0) for (const g of S.ghosts) g.frightened = false;
    }
    S.forceTimer++;
    if (S.forceTimer > 4 * PAC_FPS) { S.forceTimer = 0; pacReleaseNext(S); }

    for (const g of S.ghosts) {
      if (g.state === "home" || g.state === "leaving" || g.state === "entering") {
        pacStepHouse(S, g);
        continue;
      }
      pacAdvance(S, g, pacGhostSpeed(S, g), pacDecideGhost);
      if (g.state === "eyes" && g.tx === 13 && g.ty === 11) {
        g.state = "entering";
        g.px = pacCX(13); g.py = pacCY(11);
      }
    }

    pacCollide(S);
    if (S.popup) { S.popup.t--; if (S.popup.t <= 0) S.popup = null; }
  }

  /* The tape: "<frames since the last turn><direction>", repeated. */
  function pacEncodeTape(turns) {
    let out = "", last = 0;
    for (const t of turns) {
      out += (t.f - last) + PAC_DIR_CHAR[t.d];
      last = t.f;
    }
    return out;
  }

  /* ── the engine ── */

const PACMAN_MAX_FRAMES = 60000;
const PACMAN_MAX_TURNS = 4000;
const PACMAN_DIR_NAME = { u: "up", l: "left", d: "down", r: "right" };

function verifyPacman(body) {
  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, reason: "bad seed" };
  }
  const moves = body.moves;
  if (typeof moves !== "string" || moves.length > 8 * PACMAN_MAX_TURNS) {
    return { ok: false, reason: "bad move log" };
  }
  if (moves !== "" && !/^(\d{1,6}[uldr])*$/.test(moves)) {
    return { ok: false, reason: "bad move log" };
  }
  const events = moves.match(/\d{1,6}[uldr]/g) || [];
  if (events.length > PACMAN_MAX_TURNS) return { ok: false, reason: "bad move log" };

  const turns = [];
  let at = 0;
  for (const ev of events) {
    at += Number(ev.slice(0, -1));
    if (at > PACMAN_MAX_FRAMES) return { ok: false, reason: "that run is too long" };
    // the game commits at most one turn per frame, so a second is a tape no
    // client could have produced
    if (turns.length && at <= turns[turns.length - 1].f) {
      return { ok: false, reason: "two turns on one frame" };
    }
    turns.push({ f: at, d: PACMAN_DIR_NAME[ev[ev.length - 1]] });
  }

  const S = pacNew(seed >>> 0);
  let ei = 0;
  while (!S.over && S.frame < PACMAN_MAX_FRAMES) {
    while (ei < turns.length && turns[ei].f === S.frame + 1) {
      pacSetDir(S, turns[ei].d);
      ei++;
    }
    pacStep(S);
  }
  if (!S.over) return { ok: false, reason: "that run is too long" };

  /* The replay records the turns it actually committed. If those differ from
     the tape, the tape is not something this engine could have produced: a
     turn on a frame Pac was not at a tile centre, or into a wall, lands here. */
  if (S.turns.length !== turns.length) {
    return { ok: false, reason: "move log does not match the run" };
  }
  for (let i = 0; i < turns.length; i++) {
    if (S.turns[i].f !== turns[i].f || S.turns[i].d !== turns[i].d) {
      return { ok: false, reason: "move log does not match the run" };
    }
  }

  return {
    ok: true,
    board: "classic",
    /* Boards sort ascending, so a bigger score has to compare lower. */
    score: -S.score,
    detail: { points: S.score, level: S.level, dots: S.dotsEaten, frames: S.frame },
  };
}

/* ═══════════════ plumbing ═══════════════ */

const GAMES = {
  wordle: verifyWordle,
  minesweeper: verifyMinesweeper,
  sudoku: verifySudoku,
  "2048": verify2048,
  snake: verifySnake,
  pacman: verifyPacman,
};

/* flowcode stores its rows in this database too, but it verifies them in its
   own Worker, which is where its word engine lives. Its boards are readable
   here so one page can render every game; submissions still go to that Worker. */
/* Boards written by another Worker and only read from here. flowcode replays
   its own runs because that needs its word engine; chess is rated by the
   referee that watched the game, because a 1v1 match leaves no tape to replay. */
const READ_ONLY_GAMES = ["flowcode", "chess"];

const BOARD_RE = /^[a-z0-9-]{1,32}$/;

function cleanName(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[^ -~ -￿]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
}

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status, origin, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...cors(origin),
      ...extra,
    },
  });
}

function utcDayKey() {
  const n = new Date();
  return n.getUTCFullYear() * 10000 + (n.getUTCMonth() + 1) * 100 + n.getUTCDate();
}

async function ipKey(ip, day, env) {
  const salt = (env && env.RATE_SALT) || "arcade";
  const bytes = new TextEncoder().encode(`${salt}:${day}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseEntries(results) {
  return results.map((r) => {
    let detail = {};
    try { detail = JSON.parse(r.detail); } catch {}
    return { name: r.name, score: r.score, at: r.at, ...detail };
  });
}

/* ── GET /api/leaderboard?game=wordle&board=daily-202 ── */
async function handleLeaderboard(req, env, origin) {
  const url = new URL(req.url);
  const game = url.searchParams.get("game") || "";
  if (!GAMES[game] && !READ_ONLY_GAMES.includes(game)) {
    return json({ error: "bad game" }, 400, origin);
  }
  let board = url.searchParams.get("board") || "";
  if (game === "wordle" && !board) board = "daily-" + wordleDayNumber();
  if (!BOARD_RE.test(board)) return json({ error: "bad board" }, 400, origin);

  const { results } = await env.DB.prepare(TOP_QUERY).bind(game, board, TOP_N).all();
  return json({ game, board, count: results.length, entries: parseEntries(results) }, 200, origin, {
    "Cache-Control": "public, max-age=10",
  });
}

/* ── POST /api/submit ── */
async function handleSubmit(req, env, origin) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return json({ error: "payload too large" }, 413, origin);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "payload too large" }, 413, origin);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400, origin); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid body" }, 400, origin);
  }
  if (body.v !== PROTOCOL) {
    return json({ error: "client out of date, reload the page" }, 400, origin);
  }

  const verify = GAMES[body.game];
  if (!verify) {
    return READ_ONLY_GAMES.includes(body.game)
      ? json({ error: "wrong endpoint", reason: body.game + " runs are verified by their own worker" }, 400, origin)
      : json({ error: "bad game" }, 400, origin);
  }

  const name = cleanName(body.name);
  if (!name) return json({ error: "a name is required" }, 400, origin);

  const player = typeof body.player === "string" ? body.player.slice(0, 64) : "";
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(player)) {
    return json({ error: "bad player id" }, 400, origin);
  }

  const db = typeof env.DB.withSession === "function"
    ? env.DB.withSession("first-primary")
    : env.DB;

  const day = utcDayKey();
  const caller = await ipKey(req.headers.get("cf-connecting-ip") || "unknown", day, env);
  const hit = await db.prepare(
    `INSERT INTO rate (ip, day, n) VALUES (?1, ?2, 1)
       ON CONFLICT(ip, day) DO UPDATE SET n = n + 1
     RETURNING n`
  ).bind(caller, day).first();
  if (hit && hit.n > MAX_PER_IP_PER_DAY) {
    return json({ error: "too many submissions today" }, 429, origin);
  }
  if (Math.random() < 0.05) {
    await db.prepare(`DELETE FROM rate WHERE day < ?1`).bind(day - 3).run();
  }

  const run = verify(body);
  if (!run.ok) return json({ error: "run rejected", reason: run.reason }, 422, origin);

  /* A run counts twice: once on the board that keeps a player's best ever, and
     once on a board for the day it was played, dated by this Worker's clock so
     nobody can pick which day their run belongs to. A board that is already
     dated (wordle's daily, snake's daily seed) is both at once. */
  const detail = JSON.stringify(run.detail);
  const at = Date.now();
  const boards = run.board.startsWith("daily-") ? [run.board] : [run.board, run.board + "-" + day];

  for (const board of boards) {
    await db.prepare(
      `INSERT INTO scores (game, board, player, name, score, detail, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(game, board, player) DO UPDATE SET
         name = excluded.name, score = excluded.score,
         detail = excluded.detail, created_at = excluded.created_at
       WHERE excluded.score < scores.score`
    ).bind(body.game, board, player, name, run.score, detail, at).run();
  }

  const rank = await db.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM scores WHERE game = ?1 AND board = ?2 AND score < ?3`
  ).bind(body.game, run.board, run.score).first();

  const { results } = await db.prepare(TOP_QUERY).bind(body.game, run.board, TOP_N).all();

  return json({
    ok: true,
    board: run.board,
    dailyBoard: boards.length > 1 ? boards[1] : null,
    rank: rank ? rank.rank : null,
    entries: parseEntries(results),
  }, 200, origin);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const { pathname } = new URL(req.url);
    try {
      if (req.method === "GET" && pathname === "/api/leaderboard") {
        return await handleLeaderboard(req, env, origin);
      }
      if (req.method === "POST" && pathname === "/api/submit") {
        return await handleSubmit(req, env, origin);
      }
      if (req.method === "GET" && pathname === "/api/health") {
        return json({ ok: true, day: wordleDayNumber(), v: PROTOCOL }, 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (err) {
      console.error("unhandled", (err && err.stack) || err);
      return json({ error: "internal error" }, 500, origin);
    }
  },
};
