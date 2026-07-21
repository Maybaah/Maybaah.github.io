/* arcade leaderboard: Cloudflare Worker + D1.

   Backs the global boards for the maybaah.github.io mini-games. Nothing is
   taken on faith from the client beyond elapsed time: a Wordle run is checked
   against the day's real answer, and a Minesweeper run ships its layout seed
   and move log so the Worker can rebuild the exact board and replay the game
   to the win. One row per player per board; lower score is always better. */
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

/* ═══════════════ plumbing ═══════════════ */

const GAMES = { wordle: verifyWordle, minesweeper: verifyMinesweeper };

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
  if (!GAMES[game]) return json({ error: "bad game" }, 400, origin);
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
  if (!verify) return json({ error: "bad game" }, 400, origin);

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

  await db.prepare(
    `INSERT INTO scores (game, board, player, name, score, detail, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(game, board, player) DO UPDATE SET
       name = excluded.name, score = excluded.score,
       detail = excluded.detail, created_at = excluded.created_at
     WHERE excluded.score < scores.score`
  ).bind(body.game, run.board, player, name, run.score, JSON.stringify(run.detail), Date.now()).run();

  const rank = await db.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM scores WHERE game = ?1 AND board = ?2 AND score < ?3`
  ).bind(body.game, run.board, run.score).first();

  const { results } = await db.prepare(TOP_QUERY).bind(body.game, run.board, TOP_N).all();

  return json({
    ok: true,
    board: run.board,
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
