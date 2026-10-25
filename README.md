# HackStreet Bets

The official prediction market for **Champions vs. Challengers**, Gauntlet's 24-hour AI hackathon: November 6–7, 2026, Friday 5 PM to Saturday 5 PM, Austin, TX.

A Kalshi-style prediction market for your hackathon. Everyone gets play money, bets on which team wins and on whatever chaos happens during the event, and the leaderboard decides who has bragging rights.

Play money only. No real money, no payments, no deployment outside your network.

## Run it (2 minutes)

You need Node 18 or newer on one laptop that stays on during the event.

```bash
npm install
ADMIN_PASSWORD=pick-something npm start
```

The console prints a **Network** URL like `http://192.168.1.23:3000`. Post that in Slack. Anyone on the same Wi-Fi can open it on a laptop or phone.

Want to see it full of fake activity first? `npm run demo` seeds 15 bot traders and a few hours of history. Run `npm run reset` afterwards to wipe it before the real thing.

## How people play

1. Open the site and pick a handle and a PIN. New handles get the starting balance (default $1,000).
2. Click any outcome, enter an amount, and hit Buy.
3. Each share pays $1 if that outcome wins and $0 if it doesn't. A price of 34¢ means the crowd thinks it has a 34% chance.
4. Buying pushes the price up and selling pushes it down, so being early on a good call pays.
5. You can sell any time before trading closes to lock in profit or cut losses.
6. **Net worth** is your cash plus the live value of open bets. The leaderboard ranks by net worth and updates in real time.
7. **Anyone can create a market.** Click **+ Create**, pick a template or write your own question, and everyone gets a live notification. You can delete your own market until someone bets on it.
8. **Spot something off?** Every market has a **Report a problem** button. Reports show on the market page and ping the admins.

## Who decides

Players create markets, but **only admins resolve them, and admins have the final say.**

- Settle a market by closing trading and picking the winner. Winning shares pay $1 each instantly.
- If you resolved one wrong, use **Undo result**. Payouts are taken back and the market returns to closed, so you can resolve it again. A player's balance can dip below zero if they already spent the winnings.
- If there is any discrepancy, use **Void**. That includes unclear rules, inside info, or a dispute nobody can settle. Every bet is undone as if it never happened, and everyone gets back exactly what they put in. Void works even after a market was resolved.
- The admin controls appear right on each market page and in the Admin panel. Reported markets float to the top of the Admin list.

## Running the event as an admin

Sign in like anyone else, open **Admin**, and enter the admin password. The default password is `hackadmin` unless you set `ADMIN_PASSWORD`.

- **+ Create** has one-click templates for food arrival time, what the food is, first to nap, demo crashes and category winners. Tick **Live event** to put it in the "Happening now" strip. Admins also get the featured flag and the liquidity setting.
- **Close now** stops trading the moment the answer is obvious, for example when the delivery driver walks in. That stops late snipes.
- **Resolve & pay out** picks the winner and pays every winning share $1 instantly. Everyone sees a toast.
- **Undo result** reverses a wrong resolution so you can call it again.
- **Void** refunds everybody if anything about a market is off, even after it was resolved.
- **Edit** renames outcomes at any time. Once teams form, rename the placeholder teams in "Which team wins the hackathon?".
- **Players** lets you gift or dock play money, for example a bonus for best team name.
- **Suggestions** collects market ideas from players when player-created markets are turned off. One click turns one into a market.
- **Prize & settings** sets the event name, kickoff and end times, location, time zone, currency symbol, starting balance and the prize text on the leaderboard. It also has a switch to turn off player-created markets. When it's off, players can only send suggestions.
- The danger zone resets markets and balances before the real event.

## Prize ideas for 1st place

Pick one and put it in **Prize & settings**:

- A cheap trophy or a golden rubber duck, engraved "Hackathon Oracle 2026".
- First pick from the swag table.
- A custom Slack emoji of the winner's face, used whenever anyone makes a good call.
- The winner picks the next team-lunch restaurant.
- An exec or manager runs the winner's standup for a week.
- The winner names the next internal project, a meeting room, or the office plant.
- A "Market Maker" title in their Slack profile until the next hackathon.

## How the odds work

Prices come from a logarithmic market scoring rule, the standard automated market maker for prediction markets. There is always someone to trade against, so a market works with only a handful of players. Each market's **liquidity (b)** setting controls how far one bet moves the price. Use 100 to 200 for a room of about 30 people, and lower it to make prices swing harder.

## Before the event

- Set your own `ADMIN_PASSWORD`. The default is `hackadmin`.
- Check the event schedule in Admin, under Prize & settings. Kickoff, end, location and time zone drive the countdown, and every time on the site is shown in that time zone. The defaults match the poster.
- Starter markets close on that schedule: happy hour and dinner bets close Friday evening, and team and demo bets close an hour before the end. If you change the schedule after the first start, use **Reset markets + balances (keep players), and reload starter markets** to re-anchor them. That also clears any test bets.
- Never run `npm run demo` on the real server. If you did, use the same reset.
- On a cloud host, attach a persistent volume, set `DATA_DIR` to it, and run exactly one instance.
- Rename the placeholder teams and nap candidates.
- Open the URL on a phone on the office Wi-Fi before you announce it.
- Run `npm test` and `npm run loadtest` once on the machine or host you'll use.

## Tests

```bash
npm test           # unit, API and browser tests (about 15 seconds)
npm run loadtest   # simulates 30 and 60 open tabs betting; prints a table
```

`npm test` starts real servers on free ports with throwaway data folders, so it never touches your real data. It covers sign-in, betting limits, player-created markets, admin permissions, every resolve, undo and void path, and checks that balances end up exactly right. It also covers persistence across restarts and refusing to start on a busy port.

The browser tests use Playwright and skip themselves if it isn't installed. To include them:

```bash
npm i -D playwright && npx playwright install chromium
```

Measured with `npm run loadtest` after 1,500 past bets:

| Open tabs | Bets per second | Server CPU | Slowest bets (p95) |
|---|---|---|---|
| 30 | 2 | 7% | 4 ms |
| 60 | 2 | 9% | 6 ms |
| 100 | 3 | 16% | 7 ms |

## Under the hood

- One Node + Express server with no database. State lives in `data/db.json`, saved after every change, so a restart loses nothing.
- Plain HTML, CSS and JavaScript with no build step. Live updates use server-sent events.
- Security is deliberately minimal because this is a toy on a trusted office network. PINs are hashed, and admin actions need the password, but nothing more.

| Command | What it does |
|---|---|
| `npm start` | Run the server on port 3000. Set `PORT` to change it. |
| `npm run demo` | Run with bots and fake history, on first start only. |
| `npm run reset` | Delete all data. |
| `npm test` | Run the test suite. |
| `npm run loadtest` | Simulate a busy room and print timings. |
