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
| `/sudoku/` | Sudoku: 3 difficulties, pencil marks | [Maybaah/sudoku](https://github.com/Maybaah/sudoku) |
| `/2048/` | 2048: slide and merge to 2048 | [Maybaah/2048](https://github.com/Maybaah/2048) |
| `/snake/` | Snake: classic + daily seed challenge | [Maybaah/snake](https://github.com/Maybaah/snake) |
| `/pacman/` | Pac-Man: maze chase with the arcade ghost AI | [Maybaah/pacman](https://github.com/Maybaah/pacman) |
| `/tictactoe/` | Tic tac toe: 1v1 rooms + bot | [Maybaah/tictactoe](https://github.com/Maybaah/tictactoe) |
| `/chess/` | Chess: 1v1 rooms + pass and play | [Maybaah/chess](https://github.com/Maybaah/chess) |
| `/codenames/` | Codenames: team lobbies, English and Russian decks | [Maybaah/codenames](https://github.com/Maybaah/codenames) |
| `/flowcode/` | 3D typing trainer | [Maybaah/flowcode](https://github.com/Maybaah/flowcode) |

Every game is its own repository deployed as a project page under the same
domain; this repo owns the shared design system, the arcade client and the
leaderboard backend. Adding a cabinet: [`NEW-GAME.md`](NEW-GAME.md).

## How the leaderboards work

Same architecture as flowcode: a Cloudflare Worker + D1 ([`worker/`](worker/))
that never trusts a submitted score. A Wordle run is checked against the day's
real answer; Minesweeper, Sudoku, 2048, Snake and Pac-Man runs ship a seed and a move
log, and the Worker rebuilds the board and replays the whole game before
anything lands on a board. One row per player per board: your best run counts.

Every game stores its rows in the one `arcade` database, in the same `scores`
table keyed `(game, board, player)`. flowcode is the exception in one respect
only: its runs are replayed by its own Worker, because that verification needs
the game's word engine. The rows still land here, so `/leaderboard/` reads every
board through a single API and a player keeps one identity across every game.

Tic tac toe, chess and codenames leave this model entirely. Several people
playing at once produce no single tape, so `tictactoe-match`, `chess-match` and
`codenames-room` referee the game while it happens, from a Durable Object per
room. Tic tac toe stores nothing at all. Chess keeps no position either, but
does write an Elo rating for each finished 1v1 game, computed by the referee
from the result it watched happen. Codenames has a second reason to be
refereed: half the table is not allowed to see the board, so the key is held by
the room and sent down only to the two spymasters.

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
| Sudoku | `easy` / `medium` / `hard` | `<difficulty>-<YYYYMMDD>` |
| 2048 | `classic` | `classic-<YYYYMMDD>` |
| Snake | `classic` | `classic-<YYYYMMDD>`, plus `daily-<YYYYMMDD>` for seeded runs |
| Pac-Man | `classic` | `classic-<YYYYMMDD>` |
| flowcode | `<mode>-all` | `<mode>-<YYYYMMDD>` |
| Tic tac toe | none | none |
| Chess | `elo` | none |
| Codenames | none | none |

Every board above is rendered from one description in
[`assets/arcade.js`](assets/arcade.js), which both `/leaderboard/` and the widget
each game page mounts under itself read. Adding a board in one place and not the
other is how the same board ends up showing two different days.

Tic tac toe and codenames have no board at all. Tic tac toe is a solved game, so
two players who know what they are doing draw every time and there is nothing
worth ranking; codenames is a party game scored by a table of friends, and a
ladder would only measure who brought the best teammates. Chess has a board, but not a run-shaped one. It ranks an Elo rating
instead of a best run, which is why it is the one board with no daily twin, and
why the rating can fall as well as rise. Because two cooperating browsers are
exactly what a ladder has to survive, `chess-match` only rates games with two
distinct players, refuses to rate a resignation inside ten plies, and holds the
rating flat after the same pair have traded three games in a day.

Games load [`assets/arcade.js`](assets/arcade.js) from this repo: it holds the
local run history (localStorage), the shared player identity and the API client
for the Worker (`https://arcade-leaderboard.maybeez.workers.dev`).

## Stack

Vanilla HTML/CSS/JS · Geist + Geist Mono · dark-first design tokens in
[`assets/site.css`](assets/site.css) · Cloudflare Worker + D1 · SEO: per-page
meta, Open Graph, JSON-LD, `sitemap.xml`, custom 404.
