# btc-cent-forecast-01 — mean-reversion BTC forecaster

Entry for the [make.fun bounty](https://make.fun/bounty/btc-cent-forecast-01):
forecast Bitcoin's price 240 minutes after each checkpoint, from the 72 hours
of 1-minute closes in the case file. One program run per case, no network.

## The model

`main.ts` (Node 22, standard library only) reads every `<id>.in` in the input
directory and writes `<id>.out` with one forecast each:

```
forecast = last * exp(-0.25 * r4) + 0.15 * (mean24h - last)
```

- `last` — the close at the checkpoint.
- `r4` — the log return over the last 240 minutes.
- `mean24h` — the mean close of the last 1440 minutes.
- The forecast is clamped to ±3% of the checkpoint close and rounded to the
  price grid's 5 decimals.

## Why this, and not persistence or momentum

On the kit's six practice cases, the 4h log return has autocorrelation ≈ −0.37
at one 4h lag: a move over the last 4 hours tends to reverse over the next 4.
Short-horizon momentum and trend extrapolation score consistently *worse* than
the persistence baseline, while this two-term mean-reversion rule beats it by
about 6–8% in rolling-origin backtests (264–672 origins across three designs),
in every one of the six practice windows and in both the final checkpoints'
hours (00/04/08/12/16/20 UTC) and the practice checkpoints' hours. The
theoretical gain from the −0.37 autocorrelation is ≈7% in MAE, matching the
backtest. A fuller OLS on more features looked better in-sample but its
coefficients are unstable and regime-specific, so it was rejected in favour of
two fixed, interpretable coefficients and no fitted drift.

Honest caveat: on the six official practice cases themselves the rule scores
44,665 cents vs the persistence baseline's 44,522 — a 0.3% deficit, well
within the noise of a 6-draw sample (per-case swings vs persistence are
±$380). The final is 12 cases, so the same variance applies there; what the
backtest buys is a positive expected edge, not a guarantee on any one window.

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads `$MAKEFUN_INPUT_DIR` (else `/input`), writes `$MAKEFUN_OUTPUT_DIR`
(else `/output`). Deterministic, runs in ~0.3 s for all six practice cases,
handles flat series, missing/invalid closes (forward-filled) and short series.

## Layout

- `main.ts` — the entrypoint.
- `.makefun/owner.json` — the claim file naming the payout wallet.
- `LICENSE` — MIT.
