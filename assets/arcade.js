/* Arcade: shared client for all maybaah.github.io mini-games.

   Two layers, same pattern as flowcode:
   - a local localStorage store every game writes to (per-browser bests), and
   - a thin API client for the global leaderboard Worker, which verifies each
     run server-side before it lands on a board. Games live in their own repos
     but load this file from the root site, so everything shares one player
     identity and one store. When the API is unreachable everything degrades
     to local-only. */
(function () {
  "use strict";

  const KEY = "maybaah:arcade:v1";
  const PLAYER_KEY = "maybaah:player-id";
  const MAX_PER_GAME = 200;
  const API = "https://arcade-leaderboard.maybeez.workers.dev";
  const PROTOCOL = 1;

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      return d && typeof d === "object" ? d : {};
    } catch {
      return {};
    }
  }

  function save(d) {
    localStorage.setItem(KEY, JSON.stringify(d));
  }

  function getPlayer() {
    return load().player || "player";
  }

  function setPlayer(name) {
    const d = load();
    d.player = String(name || "").trim().slice(0, 16) || "player";
    save(d);
    return d.player;
  }

  function getScores(game) {
    const d = load();
    return (d.scores && d.scores[game]) || [];
  }

  function addScore(game, entry) {
    const d = load();
    d.scores = d.scores || {};
    const list = (d.scores[game] = d.scores[game] || []);
    list.push(Object.assign({ name: getPlayer(), ts: Date.now() }, entry));
    if (list.length > MAX_PER_GAME) list.splice(0, list.length - MAX_PER_GAME);
    save(d);
  }

  /* Best-run helpers used by the arcade hub cards */
  function bestWordle() {
    const wins = getScores("wordle").filter((s) => s.result === "win");
    wins.sort((a, b) => a.guesses - b.guesses || a.timeMs - b.timeMs);
    return wins[0] || null;
  }

  function bestMinesweeper(difficulty) {
    const wins = getScores("minesweeper").filter(
      (s) => s.result === "win" && s.difficulty === difficulty
    );
    wins.sort((a, b) => a.timeMs - b.timeMs);
    return wins[0] || null;
  }

  function fmtTime(ms) {
    if (ms == null) return "none";
    const total = Math.round(ms / 100) / 10;
    if (total < 60) return total.toFixed(1) + "s";
    const m = Math.floor(total / 60);
    const s = (total - m * 60).toFixed(1).padStart(4, "0");
    return m + ":" + s;
  }

  function fmtDate(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  /* ── global leaderboard API (same shape as flowcode's client) ── */

  function playerId() {
    let id = null;
    try { id = localStorage.getItem(PLAYER_KEY); } catch {}
    if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID
        ? crypto.randomUUID()
        : "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36)
      ).replace(/[^a-zA-Z0-9-]/g, "");
      try { localStorage.setItem(PLAYER_KEY, id); } catch {}
    }
    return id;
  }

  async function top(game, board) {
    const q = new URLSearchParams({ game });
    if (board) q.set("board", board);
    const res = await fetch(API + "/api/leaderboard?" + q, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) throw new Error("leaderboard unavailable (" + res.status + ")");
    return res.json();
  }

  async function submit(game, payload) {
    const res = await fetch(API + "/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({
        v: PROTOCOL,
        game,
        name: getPlayer(),
        player: playerId(),
      }, payload)),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.reason || body.error || "submission failed");
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /* ── boards ──────────────────────────────────────────────────────────────
     One description of every board, used by both /leaderboard/ and the widget
     each game page mounts under itself. Keeping the columns, the board names
     and the empty copy in one place is the point: two renderers drifting apart
     is how a board ends up showing the wrong day on one page and not the
     other. */

  const WORDLE_EPOCH = Date.UTC(2026, 0, 1);

  function wordleDayNumber(offset) {
    const n = new Date();
    return Math.floor((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - WORDLE_EPOCH) / 864e5) + 1 - (offset || 0);
  }

  /* Every game except wordle keeps two boards: a player's best ever, and one
     per day named by the Worker's own clock. Wordle is already one puzzle a
     day, and snake's daily seed board is likewise dated at birth. */
  function utcDayKey(offset) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (offset || 0));
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  function dailySuffix() {
    return "-" + utcDayKey(0);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  /* read at render time, not at load: the player names themselves after a run,
     so a board drawn later in the session should still mark their row */
  function nameCell(name) {
    return esc(name) + (name === getPlayer() ? '<span class="you">you?</span>' : "");
  }

  function table(headers, rows, emptyText, emptyHint) {
    if (!rows.length) {
      return '<div class="empty"><p>' + emptyText + '</p><p class="mono" style="margin-top:8px;">' + emptyHint + "</p></div>";
    }
    const h = headers.map((x) => "<th>" + x + "</th>").join("");
    const b = rows.map((cells, i) => {
      const tds = cells.map((c) => "<td" + (c.num ? ' class="num"' : "") + ">" + c.html + "</td>").join("");
      return "<tr" + (i === 0 ? ' class="top"' : "") + '><td class="rank">' + (i + 1) + "</td>" + tds + "</tr>";
    }).join("");
    return '<div style="overflow-x:auto;"><table class="board-table"><thead><tr><th>#</th>' + h +
           "</tr></thead><tbody>" + b + "</tbody></table></div>";
  }

  const loadingHtml = '<div class="empty"><p class="mono">loading board…</p></div>';
  const offlineHtml = '<div class="empty"><p>The board is unreachable right now.</p>' +
    '<p class="mono" style="margin-top:8px;">check your connection and reload</p></div>';

  const num = (v) => ({ html: String(v), num: true });
  const when = (at) => ({ html: fmtDate(at), num: true });

  const RANGE = [{ id: "all", label: "All-time" }, { id: "today", label: "Today" }];

  const BOARDS = {
    wordle: {
      label: "Wordle",
      path: "/wordle/",
      columns: ["Player", "Guesses", "Time", "When"],
      row: (s) => [{ html: nameCell(s.name) }, num(s.guesses + "/6"), { html: fmtTime(s.timeMs), num: true }, when(s.at)],
      axes: [{ id: "day", label: "Day", options: [{ id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }] }],
      hint: "first solve claims the crown",
      resolve(st) {
        const day = wordleDayNumber(st.day === "yesterday" ? 1 : 0);
        return {
          board: "daily-" + day,
          meta: "daily #" + day + " · resets at midnight UTC",
          empty: "Nobody has solved daily #" + day + " yet.",
        };
      },
    },

    minesweeper: {
      label: "Minesweeper",
      path: "/minesweeper/",
      columns: ["Player", "Time", "When"],
      row: (s) => [{ html: nameCell(s.name) }, { html: fmtTime(s.timeMs), num: true }, when(s.at)],
      axes: [
        { id: "difficulty", label: "Difficulty", options: [
          { id: "beginner", label: "Beginner" }, { id: "intermediate", label: "Intermediate" }, { id: "expert", label: "Expert" }] },
        { id: "range", label: "Range", options: RANGE },
      ],
      hint: "the field is untouched",
      resolve(st) {
        const daily = st.range === "today";
        return {
          board: st.difficulty + (daily ? dailySuffix() : ""),
          meta: daily
            ? "today's clears · " + utcDayKey(0) + " · resets at midnight UTC"
            : "all-time board · one row per player, your best clear counts",
          empty: daily ? "No " + st.difficulty + " clears today yet." : "No verified " + st.difficulty + " clears yet.",
        };
      },
    },

    "2048": {
      label: "2048",
      path: "/2048/",
      columns: ["Player", "Score", "Top tile", "Moves", "When"],
      row: (s) => [{ html: nameCell(s.name) }, num(s.points), num(s.maxTile), num(s.moves), when(s.at)],
      axes: [{ id: "range", label: "Range", options: RANGE }],
      hint: "play until the board jams",
      resolve(st) {
        const daily = st.range === "today";
        return {
          board: "classic" + (daily ? dailySuffix() : ""),
          meta: daily
            ? "today's runs · " + utcDayKey(0) + " · resets at midnight UTC"
            : "all-time board · finished runs only, replayed move by move",
          empty: daily ? "No finished 2048 runs today yet." : "No finished 2048 runs yet.",
        };
      },
    },

    snake: {
      label: "Snake",
      path: "/snake/",
      columns: ["Player", "Apples", "Steps", "Length", "When"],
      row: (s) => [{ html: nameCell(s.name) }, num(s.apples), num(s.steps), num(s.length), when(s.at)],
      axes: [{ id: "range", label: "Range", options: RANGE.concat([{ id: "daily", label: "Daily seed" }]) }],
      hint: "most apples wins, ties go to the shorter route",
      resolve(st) {
        if (st.range === "daily") {
          return {
            board: "daily" + dailySuffix(),
            meta: "daily seed · " + utcDayKey(0) + " · same apples for everyone, resets at midnight UTC",
            empty: "Nobody has run today's seed yet.",
          };
        }
        const daily = st.range === "today";
        return {
          board: "classic" + (daily ? dailySuffix() : ""),
          meta: daily
            ? "today's runs · " + utcDayKey(0) + " · resets at midnight UTC"
            : "all-time board · steps counted to the last apple",
          empty: daily ? "No snake runs today yet." : "No verified snake runs yet.",
        };
      },
    },

    /* flowcode verifies its runs in its own Worker, because that replay needs
       the game's word engine, but the rows land in this database like every
       other board, so they read back through the same client. */
    flowcode: {
      label: "flowcode",
      path: "/flowcode/",
      columns: ["Player", "Score", "WPM", "Acc", "Combo", "When"],
      row: (s) => [{ html: nameCell(s.name) }, num(s.points), num(s.wpm), { html: s.acc + "%", num: true },
                   { html: "×" + s.maxCombo, num: true }, when(s.at)],
      axes: [
        { id: "mode", label: "Mode", options: [
          { id: "daily", label: "Daily" }, { id: "time", label: "Time" }, { id: "words", label: "Words" },
          { id: "endless", label: "Survival" }, { id: "sudden", label: "Flawless" }, { id: "ramp", label: "Rush" }] },
        { id: "range", label: "Range", options: [
          { id: "today", label: "Today" }, { id: "yesterday", label: "Yesterday" }, { id: "all", label: "All-time" }] },
      ],
      hint: "the board is warming up",
      resolve(st) {
        const allTime = st.range === "all";
        const day = utcDayKey(st.range === "yesterday" ? 1 : 0);
        return {
          board: st.mode + "-" + (allTime ? "all" : day),
          meta: allTime
            ? st.mode + " board · all-time · one row per player, best ranked run counts"
            : st.mode + " board · " + day + " · seeded runs, no power-ups · resets at midnight UTC",
          empty: allTime ? "No ranked " + st.mode + " runs yet." : "No ranked " + st.mode + " runs for " + day + " yet.",
        };
      },
    },
  };

  /* Mounts a board into `el` and returns a handle. Pills are queried inside the
     mounted element, never document-wide, so two widgets on one page cannot
     drive each other. */
  function mountBoard(el, opts) {
    opts = opts || {};
    const def = BOARDS[opts.game];
    if (!el || !def) return null;

    const limit = opts.limit || 50;
    const state = {};
    def.axes.forEach((ax) => {
      const wanted = opts.state && opts.state[ax.id];
      state[ax.id] = ax.options.some((o) => o.id === wanted) ? wanted : ax.options[0].id;
    });

    el.innerHTML = "";

    if (opts.title) {
      const head = document.createElement("header");
      head.innerHTML = "<h2>" + esc(opts.title) + "</h2>" +
        (opts.fullBoardLink === false ? "" : '<a class="full-board" href="/leaderboard/">full board ↗</a>');
      el.appendChild(head);
    }

    if (opts.pills !== false) {
      const hidden = opts.hiddenAxes || [];
      def.axes.filter((ax) => hidden.indexOf(ax.id) === -1).forEach((ax) => {
        const row = document.createElement("div");
        row.className = "sub-pills";
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", ax.label);
        ax.options.forEach((o) => {
          const b = document.createElement("button");
          b.className = "pill";
          b.textContent = o.label;
          b.dataset.axis = ax.id;
          b.dataset.value = o.id;
          b.setAttribute("aria-pressed", String(state[ax.id] === o.id));
          b.addEventListener("click", () => {
            state[ax.id] = o.id;
            row.querySelectorAll(".pill").forEach((q) => q.setAttribute("aria-pressed", String(q === b)));
            render();
          });
          row.appendChild(b);
        });
        el.appendChild(row);
      });
    }

    const metaEl = document.createElement("p");
    metaEl.className = "board-meta";
    el.appendChild(metaEl);

    const tableEl = document.createElement("div");
    el.appendChild(tableEl);

    function render() {
      const r = def.resolve(state);
      metaEl.textContent = r.meta;
      tableEl.innerHTML = loadingHtml;
      const hint = opts.selfLink === false
        ? def.hint
        : def.hint + ' → <a href="' + def.path + '" style="text-decoration:underline;">play</a>';
      top(opts.game, r.board).then((data) => {
        tableEl.innerHTML = table(def.columns, data.entries.slice(0, limit).map(def.row), r.empty, hint);
      }).catch(() => { tableEl.innerHTML = offlineHtml; });
    }

    render();
    return {
      render,
      state,
      board: () => def.resolve(state).board,
      /* for an axis the host page already has controls for, so the widget does
         not grow a second row of pills that says the same thing */
      setState(patch) {
        Object.keys(patch || {}).forEach((k) => { state[k] = patch[k]; });
        render();
      },
    };
  }

  window.Arcade = {
    getPlayer,
    setPlayer,
    getScores,
    addScore,
    bestWordle,
    bestMinesweeper,
    fmtTime,
    fmtDate,
    playerId,
    top,
    submit,
    boards: BOARDS,
    mountBoard,
    table,
    nameCell,
    utcDayKey,
    dailySuffix,
    wordleDayNumber,
  };
})();
