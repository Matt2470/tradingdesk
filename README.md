# TradingDesk

A practice dashboard that runs on your PC. It never places real orders.

## Install (once)

1. Double-click `setup.bat`. It checks the PC, adds TradingDesk to Windows startup and opens it.
2. If it says Bun is missing, press a key to let it install Bun (a small free program), then it continues.

After that the dashboard opens by itself each time you start the PC. To open it by hand,
double-click `start.vbs`. To stop it opening at startup, run `remove-from-startup.bat`.

## Screens

- **Today**: one list of every symbol with its live price (updated each minute), what to do, and the signal on 15 min, 30 min, 1 hour, 4 hour and daily charts. The line at the top says whether the price downloads worked.
- **Competition**: four paper bots (Leo buys and Ursa sells short on stocks and gold; Raven sells short on crypto; Nova is free to do either, on any crypto Lighter trades well) compete to become Experienced traders. Each trades a 250 USD loan from the accountant. At twice the grant a bot closes everything, earns a badge, locks the profit in its award (which repays the loan first) and starts again with 250 USD. At half the grant the award refills it, or the bot is fired and a recruit with a new name takes its seat. 4, 8 and 12 badges in a row make a Pro, a Master and an Experienced trader. Loans cost 2% a week after two free weeks. Nothing trades from Friday 22:00 to Monday (Madrid time). Each bot chooses up to 6 charts to trade, and carries a random twin that trades the same charts with random entries, to show whether it beats chance.
- **Paper bots**: one bot at a time: its badges, where it stands between the bust line and the next badge, its weekly 3-4 strategies (of its own direction only), open trades, the accountant's decisions and what it did each day. Profits are taken in steps and losses cut in steps.
- **Running 24/7 on GitHub**: the bots can run every 15 minutes on GitHub (a public repository), so they keep trading when the PC is off. See "Running on GitHub" in CLAUDE.md. Your own trade exports in `data/imports` never leave the PC.
- **Strategies**: a map of every symbol on every timeframe (the rule the bot uses there, how good it is, any signal now), a card per rule with small charts, and the full detail of a chart when you click its cell.
- **Test and feedback**: a list of things to try after each update. Mark each one "Works" or "Problem" and write notes; Claude reads them next time.

## Settings

`config/settings.json` holds your limits (largest position, longest time in a losing trade, adds
to a loser), trading costs, and the bot's starting money and risk per trade. `config/universe.json`
is the list of symbols. Run `restart.bat` after editing so the change takes effect. `restart.bat` also helps after an update or if the window stops changing.

## If something is wrong

Look at the line at the top of Today first. Then run `bun run doctor` in this folder; it prints what
works and what does not. The server log is `data/server.log`.

For anyone changing the code: read `CLAUDE.md` first.
