# Mynance

**Mynance** (short for "My Finances") is for the person who says:

> "I want a tool to see my finances, with my data, running on my hardware."

It's a self-hosted personal finance tracker that runs in one Docker container and keeps
**all of your data as plain CSV and JSON files** in a folder on your machine. Nothing goes
to a cloud service. You can read the files, edit them in a spreadsheet, track them in git,
and back them up by copying the folder.

- **Dashboard**: net worth, investments, cash, credit cards owed, months of operating cash,
  end-of-year net worth estimate, salary multiple, net worth roadmap (history + projection),
  income vs expenses, cash / investments / home equity split, monthly expense average with
  categories you can switch off, account balances, and daily/monthly averages.
- **Expenses**: date, amount, vendor, payment method, category, subcategory, notes. Typing a
  known vendor fills in its usual category and payment method.
- **Account activity**: deposits, transfers, contributions, credit card payments and interest.
  Activity categories can count as income.
- **Balances**: record every account's balance for a day on one screen. Investment accounts
  also record the total contributed.
- **Income**: paychecks with gross, bonus, federal/state/FICA taxes, 401(k)/Roth/HSA, medical,
  dental, vision and net. Each new paycheck is pre-filled from the previous one. Salary history
  shows raise percentages.
- **Budget**: an annual plan of fixed and variable lines (fixed lines can fall in specific
  months), a month-by-month breakdown, budget vs actual with burn-down and pace, and a
  next-year projection from one year of history with a % adjustment (global or per category).
- **Metrics**: expenses by month/year broken down by category, account, subcategory or vendor;
  income vs expenses; percent of income saved; contributions vs value; monthly % gain;
  annualized return; retirement and investment shares; net worth over time; allocation pies.
- **Projections**: net worth and investment projections (low/expected/high), plus a retirement
  burn-down that shows how long your money lasts after you retire.
- **Settings**: accounts, payment methods, expense categories and subcategories, activity
  categories, currency, and backup & restore.

It works on desktop (sidebar) and phones (bottom tab bar, quick-add button, full-screen
forms), and has light and dark themes.

---

## Quick start (Docker)

```bash
git clone <this repo> mynance && cd mynance
docker compose up -d --build
# open http://localhost:8080
```

Your data is written to `./data` next to `docker-compose.yml`. On first start, Mynance creates
a default set of categories. Add your accounts under **Settings → Accounts**; the dashboard has
a checklist for the rest.

**Want to look around first?** Load a fictional demo data set into an empty install:

```bash
docker compose exec -u node mynance node scripts/demo-data.js /data
```

(It refuses to overwrite existing data unless you add `--force`.)

### Configuration

Set these in `docker-compose.yml` under `environment:`.

| Variable | Default | Purpose |
|---|---|---|
| `PUID` / `PGID` | `1000` | Owner of the files written to the data folder. Match your host user (`id -u`, `id -g`). |
| `TZ` | `UTC` | Timezone for backup file names. |
| `PORT` | `8080` | Port inside the container. |
| `DATA_DIR` | `/data` | Where data lives inside the container (mount a host folder here). |
| `BACKUP_DIR` | `$DATA_DIR/backups` | Where automatic backups go. Point it at a second volume to keep backups elsewhere. |
| `BACKUP_INTERVAL_HOURS` | `24` | How often to take an automatic snapshot (only when something changed). `0` disables. |
| `BACKUP_RETENTION` | `30` | How many backup zips to keep. |
| `MYNANCE_PASSWORD` | _(unset)_ | Turns on HTTP basic auth. |
| `MYNANCE_USERNAME` | `mynance` | Basic-auth username, used when a password is set. |

Mynance has no built-in user accounts. If it can be reached from outside your home network,
set `MYNANCE_PASSWORD` and put it behind HTTPS (e.g. a reverse proxy).

If Docker Hub rate-limits your builds, pull Node from a mirror instead:
`docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine`.

---

## Your data

```
data/
  README.md                 explains the files below
  config/
    accounts.json           accounts and their types
    categories.json         expense categories + subcategories, activity categories
    payment-methods.json    payment methods that aren't accounts (e.g. Cash)
    budgets.json            annual budgets keyed by year
    settings.json           preferences, projection and retirement assumptions
  records/
    expenses.csv            date,amount,vendor,payment_method,category,subcategory,notes,id
    account-activity.csv    date,amount,account,category,notes,id
    balances.csv            date,account,balance,contributed,notes,id
    paychecks.csv           date,employer,gross,bonus,federal_tax,state_tax,...,net,employer_match,notes,id
    salary.csv              date,employer,title,salary,notes,id
  backups/                  automatic zip snapshots
```

Conventions:

- Dates are `YYYY-MM-DD`. Amounts are plain numbers (`1234.50`), with no `$` or commas.
- **Expenses**: positive for a purchase, negative for a refund.
- **Account activity**: positive when money goes *into* the account (a deposit, a
  contribution, a credit card payment), negative when it leaves.
- **Balances**: one row per account per day. For credit cards, mortgages and loans, enter the
  amount owed as a positive number. `contributed` is the running total you've put into an
  investment account. Leave it blank and the last value carries forward.
- Records refer to accounts and categories **by name**, so the files stay readable. Rename
  things in **Settings** and every record that uses the name is updated with it.
- Files are written atomically and kept sorted by date. You can edit them while the app is
  running; changes appear the next time the page loads. Rows added by hand can leave `id`
  blank and one will be assigned.

### Backup & restore

- **Automatic**: a zip snapshot every `BACKUP_INTERVAL_HOURS` (skipped if nothing changed),
  keeping the newest `BACKUP_RETENTION`.
- **Manual**: **Settings → Backup & data** has *Download backup (.zip)* and *Save a backup
  now*, plus a CSV download for each record type.
- **Restore**: **Settings → Backup & data → Restore from .zip**. Your current data is backed
  up first. A zip of the whole `data` folder works too.
- Or copy the `data` folder: it holds everything.

---

## How things are calculated

| Metric | Definition |
|---|---|
| Net worth | Cash + brokerage + retirement + home value + other assets − credit cards − mortgage − loans, using each account's latest balance on or before the date. |
| Home equity | Home accounts − mortgage accounts. |
| Investments | Brokerage + retirement accounts (Roth IRA, Traditional IRA, 401(k), Roth 401(k), 403(b), HSA). |
| Income | Paycheck take-home (net) pay + account activity in categories marked *counts as income*. |
| Percent saved | (income + paycheck 401(k)/HSA − expenses) ÷ (income + paycheck 401(k)/HSA). |
| Core spending | All expenses except categories marked *not core* (Tithe, Charity and Vehicle by default). |
| Daily / monthly averages | Totals over the window ÷ days (or days ÷ 30.44). The window starts no earlier than your first record. |
| Months of operating cash | Cash accounts ÷ average monthly spending (all categories). |
| Credit cards owed | Latest recorded balance + expenses charged since then − payments recorded since then. |
| Monthly % gain | (end value − start value − contributions) ÷ (start value + contributions ÷ 2). Contributions come from changes in *contributed*, or from account activity when that isn't recorded. |
| Annualized return | Monthly gains chained together and annualized (time-weighted, so deposits don't count as growth). |
| Salary vs investments | Investments ÷ current salary (or the last 12 months of gross pay when there's no salary entry). |
| Net worth projection | Monthly steps: investments grow at the expected return plus the monthly investment amount; home value appreciates; the mortgage is paid down at its recent pace; cash gets the monthly cash amount. The monthly investment defaults to your average recorded contributions over the last 12 months. |
| End-of-year estimate | The projection at December of this year. |
| Retirement burn-down | Investments grow with contributions until retirement age. After that, each year withdraws spending (inflation-adjusted, minus other income such as Social Security), until the money runs out or the plan ends. |
| Budget pace | Variable lines accrue evenly through the period; fixed lines count in full once their month arrives. |
| Next-year projection | Last 12 months (or a calendar year) per category × (1 + adjustment %). Less than a year of history is scaled up to a full year. |

---

## Development

Requires Node.js 20+.

```bash
npm run setup            # install server + client dependencies
npm run demo-data        # optional: fictional data in ./demo-data
npm run start:demo       # API + built app on :8080 using ./demo-data (run `npm run build` first)

# or, with live reload:
npm run dev:server       # API on :8080 (DATA_DIR defaults to ./data)
npm run dev:client       # Vite on :5173, proxies /api to :8080

npm test                 # server API tests + finance calculation tests
npm run build            # production build of the web app into client/dist
```

Project layout:

```
server/   Express API and file storage (CSV/JSON, atomic writes, backups)
client/   React + Vite web app (Recharts for charts)
  src/lib/       pure finance calculations (unit tested)
  src/pages/     one file per screen
shared/   account type definitions used by both
scripts/  demo data generator
```
