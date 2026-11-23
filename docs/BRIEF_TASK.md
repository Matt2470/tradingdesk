# Morning brief: file contract and scheduled-task prompt

The dashboard shows the newest file named `data/briefs/YYYY-MM-DD.json`. A Claude scheduled
task writes one every morning at 06:06 Madrid time. `validateBrief` in `src/brief.ts` enforces
this format. The brief has two parts: stocks (the last trading session, so Friday's on a weekend
or a Monday morning) and crypto (the last 24 hours).

## File format

```json
{
  "date": "2026-11-16",
  "generatedAt": "2026-11-16T05:27:00Z",
  "marketSummary": "Stocks: two to four plain sentences on the last trading session.",
  "cryptoSummary": "Crypto: two to four plain sentences on the last 24 hours.",
  "items": [
    { "symbol": "NVDA", "type": "news | filing | earnings | macro",
      "headline": "What happened, one sentence.",
      "why": "Why it matters for this symbol, one or two sentences.",
      "sources": ["https://..."] }
  ],
  "earnings": [ { "symbol": "NVDA", "date": "2026-11-18", "when": "after close" } ],
  "fundamentals": {
    "NVDA": { "revenueGrowthYoYPct": 55.1, "netMarginPct": 52.0, "peRatio": 41.2,
              "note": "One sentence.", "asOf": "2026-08-27", "sources": ["https://..."] }
  },
  "strategyOfDay": { "strategyId": "rsi2_dip", "symbols": ["NVDA"], "timeframe": "4h",
                     "reasoning": "Why this rule fits today, tied to the app's own signals.",
                     "risks": "What could make it wrong." }
}
```

Rules: every item needs at least one source link. Unknown numbers are `null`, never guessed.
`cryptoSummary` and `strategyOfDay.timeframe` are optional; when present, `timeframe` is one of
`15m` `30m` `1h` `4h` `1d`. `strategyOfDay` is `null` when the app shows no new signal with a good
record; `strategyId` must be one of the ids in CLAUDE.md. Use symbol names exactly as in
`config/universe.json`. "macro" items use the symbol `MARKET`. Text values are in Spanish (the
owner's choice); field names, symbols, strategy ids and timeframes stay as written here.

## Where the app's signals are

`data/derived/today.json` (stocks and gold) and `data/derived/today-crypto.json` (crypto) each
hold `rows`: one per symbol and timeframe, with `symbol`, `class`, `tf`, `action`
(`enter` `exit` `hold` `wait` `no-strategy` `no-data`), `best` (strategy id), `bestName`, `side`,
`why`, `plan` (`stop`, `target`) and `record` (`trades`, `winRate`, `profitFactor`, `evidence`,
`passes`, `fragile`). The scheduled task's prompt (kept in the task itself) tells Claude how to use them.
