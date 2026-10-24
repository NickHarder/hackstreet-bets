# HackStreet Bets 📈

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

## Running the event as an admin

Sign in like anyone else, open **Admin**, and enter the admin password. The default password is `hackadmin` unless you set `ADMIN_PASSWORD`.

- **Create market** has one-click templates for food arrival time, what the food is, first to nap, demo crashes and category winners. Tick **Live event** to put it in the "Happening now" strip.
- **Close now** stops trading the moment the answer is obvious, for example when the delivery driver walks in. That stops late snipes.
- **Resolve & pay out** picks the winner and pays every winning share $1 instantly. Everyone sees a toast.
- **Void** refunds everybody if a market turns out to be ambiguous.
- **Edit** renames outcomes at any time. Once teams form, rename the placeholder teams in "Which team wins the hackathon?".
- **Players** lets you gift or dock play money, for example a bonus for best team name.
- **Suggestions** collects market ideas players send from the footer link. One click turns one into a market.
- **Prize & settings** sets the event name, currency symbol, starting balance and the prize text on the leaderboard.
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

## Under the hood

- One Node + Express server with no database. State lives in `data/db.json`, saved after every change, so a restart loses nothing.
- Plain HTML, CSS and JavaScript with no build step. Live updates use server-sent events.
- Security is deliberately minimal because this is a toy on a trusted office network. PINs are hashed, and admin actions need the password, but nothing more.

| Command | What it does |
|---|---|
| `npm start` | Run the server on port 3000. Set `PORT` to change it. |
| `npm run demo` | Run with bots and fake history, on first start only. |
| `npm run reset` | Delete all data. |
