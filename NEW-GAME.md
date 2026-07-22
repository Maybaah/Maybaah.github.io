# Adding a game to the arcade

Everything a new cabinet has to match. The newest game, [Maybaah/2048](https://github.com/Maybaah/2048),
is the reference implementation: copy its shape rather than inventing one.

## What to say

> "Make Snake."

That is enough if the game is well known. Otherwise say the rules, and the two
things the leaderboard needs:

- **What ends a run** (board jams, all mines cleared, timer runs out)
- **What ranks it** (score, time, moves) and whether higher or lower wins

If a run cannot be rebuilt from a seed and a list of moves, say so early: it
changes the whole verification design.

## Non-negotiables

**Its own repo.** `Maybaah/<game>`, GitHub Pages from `main` branch root, lands
at `maybaah.github.io/<game>/`. Nothing goes in the site repo except the card,
the tab and the sitemap entry.

**No build step.** Vanilla HTML/CSS/JS, no framework, no dependencies, no
bundler. One `index.html`, one `game.js`, style inline in a `<style>` block.

**Shared design system.** Load these root-relative, never copy them:

```html
<link rel="stylesheet" href="/assets/site.css" />
<script src="/assets/arcade.js"></script>
```

Use the existing classes: `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-sm`,
`.card`, `.badge`, `.eyebrow`, `.site-nav`, `.site-footer`, `.fade-up`. Dark
tokens only (`var(--bg-surface)`, `var(--text-secondary)`, …), Geist + Geist
Mono, 1px borders, no drop shadows. No em dashes anywhere in the copy.

**Never trust the client.** The browser submits *evidence*, never a score: a
seed plus the move log. The Worker rebuilds the run and computes the score
itself. A game whose score arrives as a number is not finished.

**The PRNG must be byte-identical** in `game.js` and the Worker:

```js
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

So must the rules that consume it: spawn order, merge order, tie-breaks. One
character of drift and every run fails to verify.

**Name after the run, not before.** No nickname prompt on entry. On a finished
run show the name input, a "Submit run" button and a status line, exactly like
2048's `showSubmitUI()` / `submitRun()`.

## The exception: games with two players

Everything above assumes a run one person plays alone, which is the only kind a
Worker can audit after the fact. Two people playing at once break it: there is
no single tape, and no reason to believe either copy of it.

Such a game swaps the auditor for a **referee**. A Durable Object holds the
board and is the only thing allowed to change it; clients send intents and draw
whatever they are sent back. A tampered page can ask to move twice, move out of
turn or fill an occupied square, and simply be told no. The rule that replaces
"never trust the client" is **the server owns the state**, and the client is not
asked to agree.

[Maybaah/tictactoe](https://github.com/Maybaah/tictactoe) is the reference. It
also shows what falls away with the replay model: no seed, no PRNG parity, no
`GAMES` entry, no D1 binding, and no board, because a solved game has nothing
worth ranking. Reach for this only when a run genuinely cannot be replayed from
one client's tape. Everything else stays on the model above.

## Storage

One D1 database, `arcade`, one table, `scores`, keyed `(game, board, player)`.

**Lower score always wins.** A higher-is-better game stores `-points` and puts
the real value in the `detail` JSON:

```js
return { ok: true, board: "classic", score: -points, detail: { points, ... } };
```

**Two boards per run** — all-time and daily, the daily one dated by the
Worker's own clock so a client cannot pick its day. Add the verify function to
`GAMES` in the arcade Worker and the dual write happens for free.

## Wiring checklist

In the game repo:

- [ ] `index.html` with the full SEO head: title, description, canonical, OG,
      Twitter, `VideoGame` JSON-LD, `BreadcrumbList`
- [ ] Nav back to `/arcade/` and `/leaderboard/`, plus the standard footer
- [ ] `game.js` recording `{ seed, moves }` and submitting via `Arcade.submit()`
- [ ] Keyboard handlers skip inputs:
      `if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;`
- [ ] `README.md`

In the site repo:

- [ ] `verify<Game>()` in `worker/src/index.js`, registered in `GAMES`
- [ ] Card on `/arcade/` plus its entry in the page's `ItemList` JSON-LD
- [ ] Tab and render function on `/leaderboard/`, with Today / All-time pills
- [ ] `sitemap.xml`
- [ ] The board table in `README.md`

## Before it ships

- Play a real run, submit it, confirm the client's score and the Worker's agree
- Confirm the row lands on **both** boards
- Submit a worse run and confirm it does not displace the better one
- Tamper: truncate the move log, change the seed, send junk. All must 422
- Delete every test row from D1 afterwards
- Check the page at 375px wide with no horizontal scroll

Commits are authored `Maybaah <artemcovtonyk2909@gmail.com>` with no AI
attribution and no `Co-Authored-By` trailer.
