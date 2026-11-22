import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCategories } from '../src/configSchema.js';

test('category validation preserves reimbursement exclusion setting', () => {
  const result = validateCategories({
    expense: [
      { name: 'Travel', subcategories: ['Airfare'], excludeFromCore: false, excludeFromReimbursements: true },
      { name: 'Groceries', subcategories: ['Food'], excludeFromReimbursements: false },
    ],
    activity: [],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.expense[0].excludeFromReimbursements, true);
  assert.equal(result.value.expense[1].excludeFromReimbursements, false);
});
