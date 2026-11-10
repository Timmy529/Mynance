import { addMonthKey } from './dates.js';

const monthlyRate = (annualPct) => (1 + (annualPct || 0) / 100) ** (1 / 12) - 1;

// Month-by-month net worth projection from current totals.
//  - investments grow at expectedReturn and receive monthlyInvestment
//  - cash grows at cashReturn and receives monthlyCash
//  - home value appreciates; mortgage is paid down by mortgagePaydown per month
//  - other assets and other debts stay flat
export function projectNetWorth(start, { startMonth, months, expectedReturn, homeAppreciation, cashReturn = 0, monthlyInvestment = 0, monthlyCash = 0, mortgagePaydown = 0 }) {
  let inv = start.investments;
  let cash = start.cash;
  let home = start.home;
  let mort = start.mortgage;
  const other = start.asset;
  const debt = start.credit + start.loan;
  const ri = monthlyRate(expectedReturn);
  const rh = monthlyRate(homeAppreciation);
  const rc = monthlyRate(cashReturn);
  const out = [];
  for (let i = 1; i <= months; i++) {
    inv = inv * (1 + ri) + monthlyInvestment;
    cash = cash * (1 + rc) + monthlyCash;
    home *= 1 + rh;
    mort = Math.max(0, mort - mortgagePaydown);
    out.push({
      month: addMonthKey(startMonth, i),
      investments: inv,
      cash,
      home,
      mortgage: mort,
      homeEquity: home - mort,
      netWorth: inv + cash + home + other - mort - debt,
    });
  }
  return out;
}

// Future value of investments under several return scenarios (yearly points).
export function projectInvestments({ value, contributed, years, rate, monthlyContribution = 0, spread = 2, startYear }) {
  const scenarios = [
    { key: 'low', rate: rate - spread },
    { key: 'expected', rate },
    { key: 'high', rate: rate + spread },
  ];
  const state = Object.fromEntries(scenarios.map((s) => [s.key, value]));
  let contrib = contributed;
  const rows = [{ year: startYear, low: value, expected: value, high: value, contributed: contrib }];
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      for (const s of scenarios) state[s.key] = state[s.key] * (1 + monthlyRate(s.rate)) + monthlyContribution;
      contrib += monthlyContribution;
    }
    rows.push({ year: startYear + y, ...state, contributed: contrib });
  }
  return { scenarios, rows };
}

function simulate(p, annualSpending) {
  const rb = (p.returnBefore || 0) / 100;
  const ra = (p.returnAfter || 0) / 100;
  const inf = (p.inflation || 0) / 100;
  let bal = p.startBalance;
  let depletionAge = null;
  let atRetirement = p.currentAge >= p.retirementAge ? bal : null;
  const rows = [];
  for (let age = p.currentAge; age <= p.endAge; age++) {
    const t = age - p.currentAge;
    const infl = (1 + inf) ** t;
    const retired = age >= p.retirementAge;
    if (age === p.retirementAge) atRetirement = bal;
    const row = { age, year: p.startYear + t, balance: bal, real: bal / infl, retired, contribution: 0, withdrawal: 0, spending: 0, otherIncome: 0 };
    if (!retired) {
      row.contribution = p.annualContribution || 0;
      bal = bal * (1 + rb) + row.contribution;
    } else {
      row.spending = annualSpending * infl;
      row.otherIncome = age >= p.otherIncomeStartAge ? (p.otherIncome || 0) * infl : 0;
      row.withdrawal = Math.max(0, row.spending - row.otherIncome);
      bal -= row.withdrawal;
      if (bal < -0.005) {
        if (depletionAge === null && row.withdrawal > 0) depletionAge = age;
        bal = 0;
      } else bal = Math.max(0, bal) * (1 + ra);
    }
    rows.push(row);
  }
  return { rows, depletionAge, atRetirement };
}

// Retirement burn-down: grow investments until retirement, then withdraw spending
// (inflation-adjusted, net of other income such as social security) each year.
export function retirementPlan(p) {
  const params = { endAge: 95, withdrawalRate: 4, ...p };
  const { rows, depletionAge, atRetirement } = simulate(params, params.annualSpending);
  const yearsToRetire = Math.max(0, params.retirementAge - params.currentAge);
  const inflAtRet = (1 + (params.inflation || 0) / 100) ** yearsToRetire;
  const atRetirementReal = atRetirement !== null ? atRetirement / inflAtRet : null;
  const wr = (params.withdrawalRate || 4) / 100;

  // Highest spending (today's dollars) that still lasts through endAge.
  let lo = 0;
  let hi = Math.max(1000, (params.startBalance + (params.annualContribution || 0) * yearsToRetire) * 0.5 + (params.otherIncome || 0) * 2);
  for (let i = 0; i < 50 && simulate(params, hi).depletionAge === null; i++) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (simulate(params, mid).depletionAge === null) lo = mid;
    else hi = mid;
  }

  return {
    rows,
    depletionAge,
    atRetirement,
    atRetirementReal,
    sustainableSpending: atRetirementReal !== null ? atRetirementReal * wr + (params.otherIncome || 0) : null,
    neededAtRetirement: Math.max(0, params.annualSpending - (params.otherIncome || 0)) / wr,
    maxSpending: lo,
  };
}
