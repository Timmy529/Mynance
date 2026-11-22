import { describe, it, expect } from 'vitest';
import { paymentMethodOptions, subcategoryOptions } from './options.js';

const config = {
  accounts: [
    { name: 'Checking', type: 'checking' },
    { name: 'Archived Card', type: 'credit_card', archived: true },
    { name: 'Visa', type: 'credit_card' },
    { name: 'Brokerage', type: 'brokerage' },
  ],
  paymentMethods: [{ name: 'Cash' }, { name: 'Old Cash', archived: true }],
  categories: { expense: [
    { name: 'Travel', subcategories: ['Airfare', 'Hotel'] },
    { name: 'Food', subcategories: ['Groceries'] },
  ] },
};

describe('expense filter options', () => {
  it('offers only active payment-enabled accounts and active payment methods', () => {
    const names = paymentMethodOptions(config).flatMap((group) => group.options.map((option) => option.value));
    expect(names.sort()).toEqual(['Cash', 'Checking', 'Visa'].sort());
  });

  it('returns subcategories only for the selected category', () => {
    expect(subcategoryOptions(config, 'Travel')).toEqual([
      { value: 'Airfare', label: 'Airfare' },
      { value: 'Hotel', label: 'Hotel' },
    ]);
    expect(subcategoryOptions(config, '')).toEqual([]);
  });
});
