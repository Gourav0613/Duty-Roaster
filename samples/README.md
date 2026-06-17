# samples/

Drop the real HR export here as **`Duty_Roster_Report.XLS`**.

The app and tests detect band layout dynamically, so any month (28–31 days) works.
Expected result for the reference sample: **35 employees, 30 days**, with employee
`AF00072` having only days 1, 4 and 5 filled (a partial month).

> The binary `.XLS` is not committed to this repo. Until it's present, the unit
> tests run against a synthetic fixture (`test/fixtures/buildGrid.js`) that
> reproduces the same messy layout (band split, merged-cell shift, irregular day
> step, partial-month employee).

To run the real file through the parser once it's here:

```bash
node scripts/run-sample.js
```
