# Analytics Rules

## Cohorts

Comparable price cohorts must not mix:

- WTS and WTB
- new and used
- full set and watch-only
- different exact/canonical references
- standard and special editions
- materially different configurations

## Metrics

Required:

- count
- unique dealer count
- median
- average
- min/max
- Q1/Q3/IQR
- lower/upper fences
- low/high outliers
- price by date
- listing velocity
- repost persistence
- WTS supply
- WTB demand
- price dispersion
- confidence and missing-data warnings

## Outlier Rule

```text
Q1 = 25th percentile
Q3 = 75th percentile
IQR = Q3 - Q1
Lower fence = Q1 - 1.5 * IQR
Upper fence = Q3 + 1.5 * IQR
```

## Sample Size Labels

- Fewer than 5: raw observations only.
- 5 to 9: provisional.
- 10 or more: more useful robust statistics.

## Current Risk

`api/price-research.js` uses 1.0 * IQR and marks analytics ready at 4 records. It also limits rows to 5000.

