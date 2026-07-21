/* Arcade — shared client for all maybaah.github.io mini-games.

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
    if (ms == null) return "—";
    const total = Math.round(ms / 100) / 10;
    if (total < 60) return total.toFixed(1) + "s";
    const m = Math.floor(total / 60);
    const s = (total - m * 60).toFixed(1).padStart(4, "0");
    return m + ":" + s;
  }

  function fmtDate(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  function exportAll() {
    return JSON.stringify(load(), null, 2);
  }

  function importAll(json) {
    const d = JSON.parse(json);
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      throw new Error("Not an arcade export");
    }
    save(d);
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

  window.Arcade = {
    getPlayer,
    setPlayer,
    getScores,
    addScore,
    bestWordle,
    bestMinesweeper,
    fmtTime,
    fmtDate,
    exportAll,
    importAll,
    playerId,
    top,
    submit,
  };
})();
