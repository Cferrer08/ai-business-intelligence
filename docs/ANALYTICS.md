# Advanced analytics (Phase 5)

All methods run in the Python data engine (`services/data-engine/app/analysis/`). Each
result lists the numbers behind it, and every flag or segment says why.

## Forecasting (`forecast.py`)

1. Build a regular series of a total or count (sum, count or distinct count; averages are
   refused). Missing periods count as zero and are noted.
2. Leave out a final period that is still in progress. A period is "in progress" only when
   the data is finer than the period and stops before it ends: monthly summary rows dated
   the 1st or month-end keep their last month.
3. Refuse with a reason if there are fewer than 8 complete periods.
4. Score candidate methods by rolling-origin backtests (fit on the past, predict the next
   periods, up to 5 windows): last value, same period last cycle, recent average, exponential
   smoothing (level), with damped trend, with steady trend, and the two seasonal versions.
   Seasonal methods need two full cycles (e.g. 26 months for a yearly pattern); when the
   data is shorter the result says seasonality isn't modelled.
5. Choose the simplest method unless a richer one beats it by 5% (10% for trend or seasonal
   methods) on the same backtest windows.
6. Ranges (80% and 95%): the wider of (a) backtest root-mean-square error per step ahead,
   which counts bias as well as spread, widened for few samples (t distribution) and
   extended by √distance beyond the backtest, and (b) the exponential smoothing model's own
   prediction interval. Seasonal methods are widened by √(1 + 2m/n) because a pattern
   estimated from few cycles is itself uncertain. Totals that can't be negative are
   clipped at zero.

**Measured on 360 simulated series** (60 each of six kinds, comparing forecasts with
periods the method never saw):

| Series | 80% range contained the truth | 95% range | Error |
| --- | --- | --- | --- |
| Monthly, seasonal + trend, 3 years | 88% | 96% | 3.5% |
| Monthly, seasonal + trend, 5 years | 87% | 96% | 2.7% |
| Monthly, trend only | 84% | 96% | 3.1% |
| Monthly, level only | 93% | 98% | 3.6% |
| Weekly, level + trend, 1 year | 91% | 98% | 3.4% |
| Daily with a weekday pattern | 94% | 98% | 3.4% |

The ranges are slightly cautious rather than overconfident. Forecasts assume past patterns
continue; promotions, price changes and one-off events can't be anticipated.

## Anomalies (`advanced.py`)

A value is flagged when it is both **statistically unusual** (robust z-score from the median
absolute deviation: 3.0 / 3.5 / 4.0 for high / normal / low sensitivity) **and big enough to
matter** (at least 5% / 10% / 20% from expected). Small wobbles in very smooth data aren't news.

- **Unusual periods**: each day is compared with the median of the same weekday in the four
  weeks before and after (weekends with weekends); weeks and months with the two periods on
  each side. A period never contributes to its own expected value, so one huge day can't
  hide itself.
- **Unusual rows**: robust z-scores per numeric column, plus an isolation forest (scikit-learn)
  for unusual combinations when there are 2+ numeric columns and 200+ rows. Each row gives
  its file row number, any id columns, and which values were extreme.
- **Groups that changed**: each group's latest complete period is compared with how the
  typical group moved that period (median across groups of current vs usual level). Seasons
  and growth that move every group cancel out, and one collapsing group can't make the
  others look unusually high. Needs 3+ groups; otherwise each group is compared with its
  own history.

## Correlation

Spearman rank correlation (robust to outliers) with Pearson alongside, p-values adjusted
with the Holm method for testing many pairs at once, strength in words, row-level or per
period totals. Always shown with "association, not cause".

## Customer segments (RFM)

Per customer: days since last purchase, number of orders (distinct order ids, or rows),
total spend, each scored 1–5 relative to the other customers. Named segments in order:
Champions, Loyal, Potential loyalists, New, Need attention, At risk, Hibernating. Needs 20+
customers. RFM was chosen over clustering because the segments are named and actionable
without interpretation.

## Trend

Mann-Kendall test for whether there is a trend (p < 0.05) and the matching Theil–Sen slope
for how steep it is. Both are rank-based, so a single extreme period can't flip the direction.

## Where to use them

- **Forecasts / Anomalies / Analytics pages**: choose options, run, see the result with a
  summary generated from the engine's numbers (no AI involved). Runs are saved per workspace.
- **AI Analyst**: "forecast revenue for the next 6 months", "were there any unusual days",
  "which regions changed unusually", "segment my customers", "is revenue growing".
