# maybaah.github.io

Personal site of **Artem Kovtoniuk**: portfolio, arcade hub and global leaderboards.
Hand-built static pages for GitHub Pages: no framework, no build step, no dependencies.

**Live:** https://maybaah.github.io/

## Map

| Route | What | Repo |
| --- | --- | --- |
| `/` | Portfolio: who I am, selected work, contact | this one |
| `/arcade/` | Mini-games hub | this one |
| `/leaderboard/` | Global boards for every arcade game | this one |
| `/wordle/` | Wordle: daily puzzle + practice | [Maybaah/wordle](https://github.com/Maybaah/wordle) |
| `/minesweeper/` | Minesweeper: 3 difficulties, chording | [Maybaah/minesweeper](https://github.com/Maybaah/minesweeper) |
| `/2048/` | 2048: slide and merge to 2048 | [Maybaah/2048](https://github.com/Maybaah/2048) |
| `/snake/` | Snake: classic + daily seed challenge | [Maybaah/snake](https://github.com/Maybaah/snake) |
| `/flowcode/` | 3D typing trainer | [Maybaah/flowcode](https://github.com/Maybaah/flowcode) |

Every game is its own repository deployed as a project page under the same
domain; this repo owns the shared design system, the arcade client and the
leaderboard backend. Adding a cabinet: [`NEW-GAME.md`](NEW-GAME.md).

## How the leaderboards work

Same architecture as flowcode: a Cloudflare Worker + D1 ([`worker/`](worker/))
that never trusts a submitted score. A Wordle run is checked against the day's
real answer; Minesweeper, 2048 and Snake runs ship a seed and a move log, and
the Worker rebuilds the board and replays the whole game before anything lands
on a board. One row per player per board: your best run counts.

Every game stores its rows in the one `arcade` database, in the same `scores`
table keyed `(game, board, player)`. flowcode is the exception in one respect
only: its runs are replayed by its own Worker, because that verification needs
the game's word engine. The rows still land here, so `/leaderboard/` reads every
board through a single API and a player keeps one identity across all five
games.

A finished run counts on two boards: one that keeps a player's best ever, and
one for the day it was played, dated by the Worker's own clock so nobody can
choose which day their run lands on. A board that is already dated is both at
once: Wordle, being one puzzle per day, and Snake's daily seed, where the
Worker derives the apple sequence from its own day number so everyone that day
plays the same board.

| Game | All-time board | Daily board |
| :-- | :-- | :-- |
| Wordle | — | `daily-<n>` |
| Minesweeper | `beginner` / `intermediate` / `expert` | `<difficulty>-<YYYYMMDD>` |
| 2048 | `classic` | `classic-<YYYYMMDD>` |
| Snake | `classic` | `classic-<YYYYMMDD>`, plus `daily-<YYYYMMDD>` for seeded runs |
| flowcode | `<mode>-all` | `<mode>-<YYYYMMDD>` |

Games load [`assets/arcade.js`](assets/arcade.js) from this repo: it holds the
local run history (localStorage), the shared player identity and the API client
for the Worker (`https://arcade-leaderboard.maybeez.workers.dev`).

## Stack

Vanilla HTML/CSS/JS · Geist + Geist Mono · dark-first design tokens in
[`assets/site.css`](assets/site.css) · Cloudflare Worker + D1 · SEO: per-page
meta, Open Graph, JSON-LD, `sitemap.xml`, custom 404.
