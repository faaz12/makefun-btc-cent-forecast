// btc-cent-forecast-01 entry: a mean-reversion forecaster for BTC's price
// 240 minutes after each checkpoint.
//
// What the practice data says (six cases p00..p05, 72h of 1-minute closes each,
// backtested with rolling origins every 30-60 min inside each window):
//   - The 4h log return has autocorrelation about -0.37 at one 4h lag: a move
//     over the last 4 hours tends to reverse over the next 4. Short-horizon
//     momentum / trend extrapolation is consistently WORSE than persistence.
//   - The best simple rule found combines two mean-reversion terms:
//       forecast = last * exp(-0.25 * r4) + 0.15 * (mean24h - last)
//     where r4 is the log return over the last 240 minutes and mean24h is the
//     mean close of the last 1440 minutes. Rolling-origin backtest MAE:
//     ~41,300-41,400 cents vs ~43,800-45,100 for persistence (about 6-8%
//     better), beating persistence in every one of the six practice windows
//     and in both the final checkpoints' hours (00/04/08/12/16/20 UTC) and
//     the practice checkpoints' hours.
//   - A plain OLS on more features looked better in-sample but its
//     coefficients are unstable (multicollinear 12h/24h terms) and regime
//     specific, so it was rejected: this entry keeps two fixed, interpretable
//     coefficients and no fitted drift, so it cannot chase a trend.
//   - The forecast is clamped to +-3% of the checkpoint close (the largest
//     |4h move| in the practice windows is 2.8%), so a wild input can never
//     produce an absurd guess. MAE scoring rewards the median guess, and
//     this rule is the honest middle estimate under the mean-reversion model.
//
// What an entry must do (same contract as the kit's starter):
//   - read every <id>.in in the input directory (the grader runs one case at
//     a time, with only that case's file there), canonical JSON
//     {"schema":"makefun/btc-cent-case/v1","competition","case","at",
//     "horizon_minutes","markets":[{"id","name","start","prices"}]}, where
//     `prices` holds one close a minute in US dollars per whole BTC from
//     `start` to `at` inclusive, so the last one is the close at the checkpoint;
//   - write <id>.out to the output directory:
//     {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly one
//     row naming the case and no other key, its price a finite number greater
//     than 0 and less than 10,000,000, at most 1 MiB.
// It runs offline, with no network, under the case's time cap: everything it
// knows is in the case's prices. Node 22, standard library only.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Weight on the last 4h log return. Negative: the last move mean-reverts. */
const MOMENTUM_ALPHA = -0.25;
/** Weight pulling the guess toward the mean close of the last 24 hours. */
const REVERT_ALPHA = 0.15;
/** The 4h return is measured over this many minutes. */
const RETURN_LAG_MIN = 240;
/** The mean-reversion level is the mean close of this many minutes. */
const MEAN_WINDOW_MIN = 1440;
/** Never forecast further than this fraction from the checkpoint close. */
const CLAMP_FRACTION = 0.03;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/**
 * Clean one price series: drop non-finite / non-positive closes by carrying
 * the last good value forward (the recorder does the same for empty minutes),
 * backfill a bad head from the first good value. Returns [] only if the
 * series holds no usable price at all.
 */
function clean(prices: number[]): number[] {
  const out: number[] = [];
  let lastGood: number | null = null;
  let badHead = 0;
  for (const p of prices) {
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      lastGood = p;
      out.push(p);
    } else if (lastGood !== null) {
      out.push(lastGood);
    } else {
      // No good value yet: count it, backfilled below.
      badHead++;
    }
  }
  if (out.length === 0) return out;
  // Backfill a bad head from the first good value, so the cleaned series
  // keeps the input's minute alignment: the 240-minute return and the 24h
  // mean are measured in minutes back from the checkpoint, and dropping
  // head minutes would shorten the window they are measured over.
  if (badHead > 0) return Array<number>(badHead).fill(out[0] as number).concat(out);
  return out;
}

/**
 * Forecast the close 240 minutes after the checkpoint from the case's
 * 1-minute closes. Deterministic, no randomness, no network.
 */
function forecast(prices: number[]): number {
  const x = clean(prices);
  if (x.length === 0) return price5(60000); // unreachable defensive fallback
  const last = x[x.length - 1] as number;
  if (x.length < 2) return price5(last);
  // 4h log return, over the minutes actually available.
  const lag = Math.min(RETURN_LAG_MIN, x.length - 1);
  const r4 = Math.log(last / (x[x.length - 1 - lag] as number));
  // Mean close of the last 24h (or the whole series when shorter).
  const w = Math.min(MEAN_WINDOW_MIN, x.length);
  let mean = 0;
  for (let i = x.length - w; i < x.length; i++) mean += x[i] as number;
  mean /= w;
  // Mean reversion on the last move, plus a pull toward the 24h mean.
  let f = last * Math.exp(MOMENTUM_ALPHA * r4) + REVERT_ALPHA * (mean - last);
  // Safety clamp: never more than +-3% from the checkpoint close.
  f = Math.min(last * (1 + CLAMP_FRACTION), Math.max(last * (1 - CLAMP_FRACTION), f));
  return price5(f);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  const market = c.markets[0] as CaseMarket;
  if (!Array.isArray(market.prices)) throw new Error(`${file} market ${market.id} has no prices`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(market.prices) }] })}\n`);
}
