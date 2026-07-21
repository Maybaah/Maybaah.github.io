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
| `/flowcode/` | 3D typing trainer | [Maybaah/flowcode](https://github.com/Maybaah/flowcode) |

Every game is its own repository deployed as a project page under the same
domain; this repo owns the shared design system, the arcade client and the
leaderboard backend.

## How the leaderboards work

Same architecture as flowcode: a Cloudflare Worker + D1 ([`worker/`](worker/))
that never trusts a submitted score. A Wordle run is checked against the day's
real answer; Minesweeper and 2048 runs ship a layout seed and a move log, and
the Worker rebuilds the board and replays the whole game before anything lands
on a board. One row per player per board: your best run counts.

Games load [`assets/arcade.js`](assets/arcade.js) from this repo: it holds the
local run history (localStorage) and the API client for the Worker
(`https://arcade-leaderboard.maybeez.workers.dev`).

## Stack

Vanilla HTML/CSS/JS · Geist + Geist Mono · dark-first design tokens in
[`assets/site.css`](assets/site.css) · Cloudflare Worker + D1 · SEO: per-page
meta, Open Graph, JSON-LD, `sitemap.xml`, custom 404.
