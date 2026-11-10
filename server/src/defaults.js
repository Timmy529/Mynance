// Default configuration written on first start. Everything here can be edited in
// the Settings page or directly in the JSON files under <data>/config/.

const sub = (...names) => names;

export const DEFAULT_CATEGORIES = {
  expense: [
    { name: 'Housing', subcategories: sub('Mortgage / Rent', 'Property Tax', 'HOA', 'Maintenance', 'Furnishings'), excludeFromCore: false },
    { name: 'Utilities', subcategories: sub('Electric', 'Gas', 'Water / Sewer', 'Trash', 'Internet', 'Phone'), excludeFromCore: false },
    { name: 'Groceries', subcategories: sub('Groceries', 'Household Supplies'), excludeFromCore: false },
    { name: 'Dining', subcategories: sub('Restaurants', 'Coffee', 'Takeout'), excludeFromCore: false },
    { name: 'Vehicle', subcategories: sub('Fuel', 'Maintenance', 'Insurance', 'Registration', 'Payment', 'Parking / Tolls'), excludeFromCore: true },
    { name: 'Insurance', subcategories: sub('Home', 'Life', 'Umbrella', 'Other'), excludeFromCore: false },
    { name: 'Healthcare', subcategories: sub('Doctor', 'Pharmacy', 'Dental', 'Vision', 'Other'), excludeFromCore: false },
    { name: 'Shopping', subcategories: sub('Clothing', 'Electronics', 'Home Goods', 'Other'), excludeFromCore: false },
    { name: 'Entertainment', subcategories: sub('Streaming', 'Events', 'Hobbies', 'Games'), excludeFromCore: false },
    { name: 'Travel', subcategories: sub('Lodging', 'Flights', 'Activities', 'Transportation'), excludeFromCore: false },
    { name: 'Personal Care', subcategories: sub('Haircut', 'Fitness', 'Other'), excludeFromCore: false },
    { name: 'Gifts', subcategories: sub('Birthdays', 'Holidays', 'Other'), excludeFromCore: false },
    { name: 'Education', subcategories: sub('Tuition', 'Books', 'Courses'), excludeFromCore: false },
    { name: 'Subscriptions', subcategories: sub('Software', 'Memberships', 'Other'), excludeFromCore: false },
    { name: 'Tithe', subcategories: sub('Church'), excludeFromCore: true },
    { name: 'Charity', subcategories: sub('Donations'), excludeFromCore: true },
    { name: 'Miscellaneous', subcategories: sub('Fees', 'Other'), excludeFromCore: false },
  ],
  activity: [
    { name: 'Deposit', countsAsIncome: false },
    { name: 'Paycheck Deposit', countsAsIncome: false },
    { name: 'Transfer', countsAsIncome: false },
    { name: 'Contribution', countsAsIncome: false },
    { name: 'Employer Match', countsAsIncome: false },
    { name: 'Withdrawal', countsAsIncome: false },
    { name: 'Credit Card Payment', countsAsIncome: false },
    { name: 'Interest', countsAsIncome: true },
    { name: 'Dividend', countsAsIncome: false },
    { name: 'Other Income', countsAsIncome: true },
    { name: 'Refund', countsAsIncome: false },
    { name: 'Fee', countsAsIncome: false },
  ],
};

export const DEFAULT_PAYMENT_METHODS = [{ name: 'Cash' }];

export const DEFAULT_SETTINGS = {
  currency: 'USD',
  locale: 'en-US',
  dashboard: {
    // Categories removed from the dashboard "monthly expense average".
    excludedCategories: [],
    // How many months of history drive averages on the dashboard.
    averageMonths: 12,
    projectionYears: 10,
  },
  projection: {
    years: 10,
    expectedReturn: 7, // % per year on investments
    homeAppreciation: 3, // % per year
    inflation: 3, // % per year
    cashReturn: 0, // % per year on cash
    monthlyInvestment: null, // null = estimate from recorded contributions / savings
    monthlyCash: null, // null = 0
  },
  retirement: {
    birthYear: null,
    retirementAge: 60,
    endAge: 95,
    annualSpending: null, // null = last 12 months of spending
    returnBeforeRetirement: 7,
    returnInRetirement: 5,
    inflation: 3,
    otherIncome: 0, // e.g. social security, in today's dollars per year
    otherIncomeStartAge: 67,
    includeCash: false,
    withdrawalRate: 4,
  },
  budget: {
    projectionAdjustment: 3, // % applied to last year's actuals when projecting next year
    categoryAdjustments: {}, // { "Groceries": 5 }
  },
};

export const DATA_README = `# Mynance data folder

Everything Mynance knows lives in this folder as plain text, so you can read it,
edit it in a spreadsheet or text editor, track it in git, or back it up by copying it.

    config/
      accounts.json          Accounts (checking, savings, credit cards, investment, home, ...)
      categories.json        Expense categories + subcategories, account-activity categories
      payment-methods.json   Extra payment methods that are not accounts (e.g. Cash)
      budgets.json           Annual budgets, keyed by year
      settings.json          Preferences and projection / retirement assumptions
    records/
      expenses.csv           date,amount,vendor,payment_method,category,subcategory,notes,id
      account-activity.csv   date,amount,account,category,notes,id
      balances.csv           date,account,balance,contributed,notes,id
      paychecks.csv          date,employer,gross,bonus,taxes...,deductions...,net,...,id
      salary.csv             date,employer,title,salary,notes,id
    backups/                 Automatic zip snapshots (can be changed with BACKUP_DIR)

Conventions
- Dates are YYYY-MM-DD. Amounts are plain numbers with 2 decimals (no $ or commas).
- expenses.csv: amount is positive for a purchase, negative for a refund.
- account-activity.csv: amount is positive for money into the account
  (deposit, contribution, credit card payment) and negative for money out.
- balances.csv: one row per account per day. For credit cards, mortgages and loans
  enter the amount owed as a positive number. "contributed" is the running total you
  have put into an investment account (leave blank for other accounts).
- Names (accounts, categories, payment methods) are stored as text. Rename them in the
  app's Settings page so every record is updated together.
- The id column is generated by the app. Leave it blank on rows you add by hand and
  one will be assigned.

It is safe to edit these files while the app is running; changes are picked up on
the next page load.
`;
