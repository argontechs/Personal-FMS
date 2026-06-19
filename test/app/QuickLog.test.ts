// test/app/QuickLog.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import QuickLog from '../../app/components/quicklog/QuickLog.vue';

const enqueued: any[] = [];
vi.mock('../../app/composables/useOfflineQueue', () => ({
  useOfflineQueue: () => ({
    enqueue: vi.fn(async (input: any) => { const t = { ...input, uuid: 'fixed-uuid' }; enqueued.push(t); return t; }),
    pending: vi.fn(async () => []),
    flush: vi.fn(async () => ({ flushed: 0, remaining: 0 })),
  }),
  registerAutoFlush: vi.fn(),
}));

const mockAccounts = [
  { id: 10, name: 'Maybank Current', type: 'bank' },
  { id: 11, name: 'Touch n Go', type: 'ewallet' },
  { id: 12, name: 'Cash Wallet', type: 'cash' },
];

beforeEach(() => { enqueued.length = 0; });

describe('QuickLog', () => {

  // ── Expense mode (existing behaviour unchanged) ─────────────────────────
  it('enqueues amount + category in two taps and emits logged', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('12.50');
    await wrapper.find('[data-test="cat-food"]').trigger('click'); // category tap submits
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].amount_cents).toBe(-1250); // RM12.50 → −1250 sen, expense
    expect(enqueued[0].category).toBe('food');
    expect(enqueued[0].account_id).toBe(1);
    expect(enqueued[0].date).toBe('2026-06-18');
    expect(wrapper.emitted('logged')).toBeTruthy();
    expect(wrapper.emitted('logged')![0][0]).toMatchObject({ uuid: 'fixed-uuid', category: 'food' });
  });

  it('does not enqueue when amount is empty or non-positive', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="cat-food"]').trigger('click'); // no amount
    expect(enqueued.length).toBe(0);
    await wrapper.find('[data-test="amount"]').setValue('0');
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    expect(enqueued.length).toBe(0);
    await wrapper.find('[data-test="amount"]').setValue('-5');
    await wrapper.find('[data-test="cat-transport"]').trigger('click');
    expect(enqueued.length).toBe(0);
  });

  it('RM→sen conversion is exact: RM12.50 → 1250 sen stored as −1250', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('12.50');
    await wrapper.find('[data-test="cat-transport"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued[0].amount_cents).toBe(-1250);
    expect(enqueued[0].direction).toBe('expense');
  });

  it("'other' category chip enqueues with category='other'", async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('5.00');
    await wrapper.find('[data-test="cat-other"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].category).toBe('other');
    expect(enqueued[0].amount_cents).toBe(-500);
  });

  it('clears amount after successful enqueue', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('8.00');
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    await wrapper.vm.$nextTick();
    const input = wrapper.find('[data-test="amount"]').element as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('renders all 8 category chips in expense mode (including Car)', () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    const chips = wrapper.findAll('[data-test^="cat-"]');
    expect(chips.length).toBe(8);
    const keys = chips.map(c => c.attributes('data-test'));
    expect(keys).toContain('cat-food');
    expect(keys).toContain('cat-transport');
    expect(keys).toContain('cat-car');
    expect(keys).toContain('cat-fuel');
    expect(keys).toContain('cat-groceries');
    expect(keys).toContain('cat-shopping');
    expect(keys).toContain('cat-bills');
    expect(keys).toContain('cat-other');
  });

  it("'car' chip enqueues with category='car'", async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('8.50');
    await wrapper.find('[data-test="cat-car"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].category).toBe('car');
    expect(enqueued[0].amount_cents).toBe(-850);
    expect(enqueued[0].direction).toBe('expense');
  });

  it('logs a remark into note when remark input is filled', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('5.50');
    await wrapper.find('[data-test="remark"]').setValue('lunch with team');
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].note).toBe('lunch with team');
    expect(enqueued[0].category).toBe('food');
  });

  it('logs with no note when remark is empty', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('3.00');
    // leave remark blank
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    // note should be undefined (falsy trimmed empty string)
    expect(enqueued[0].note == null || enqueued[0].note === undefined).toBe(true);
  });

  it('clears remark after logging', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('5.00');
    await wrapper.find('[data-test="remark"]').setValue('quick lunch');
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    await wrapper.vm.$nextTick();
    const remarkInput = wrapper.find('[data-test="remark"]').element as HTMLInputElement;
    expect(remarkInput.value).toBe('');
  });

  it("'fuel' chip enqueues with category='fuel'", async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('80.00');
    await wrapper.find('[data-test="cat-fuel"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].category).toBe('fuel');
    expect(enqueued[0].amount_cents).toBe(-8000);
    expect(enqueued[0].direction).toBe('expense');
  });

  it("'shopping' chip enqueues with category='shopping'", async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1, defaultDate: '2026-06-18' } });
    await wrapper.find('[data-test="amount"]').setValue('45.90');
    await wrapper.find('[data-test="cat-shopping"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].category).toBe('shopping');
    expect(enqueued[0].amount_cents).toBe(-4590);
  });

  // ── Mode toggle ─────────────────────────────────────────────────────────
  it('defaults to expense mode (mode-expense toggle is active)', () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1 } });
    const expenseBtn = wrapper.find('[data-test="mode-expense"]');
    expect(expenseBtn.classes()).toContain('quicklog__toggle-btn--active');
    expect(expenseBtn.attributes('aria-pressed')).toBe('true');
    const incomeBtn = wrapper.find('[data-test="mode-income"]');
    expect(incomeBtn.classes()).not.toContain('quicklog__toggle-btn--active');
  });

  it('switching to Income mode shows account picker and source chips, hides expense chips', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-18', accounts: mockAccounts },
    });
    await wrapper.find('[data-test="mode-income"]').trigger('click');
    await wrapper.vm.$nextTick();

    // Expense chips are hidden
    expect(wrapper.find('[data-test="cat-food"]').exists()).toBe(false);

    // Account picker is visible
    expect(wrapper.find('[data-test="income-account"]').exists()).toBe(true);

    // Source note chips visible
    expect(wrapper.find('[data-test="income-src-salary"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="income-src-side-gig"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="income-src-refund"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="income-src-gift"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="income-src-other"]').exists()).toBe(true);

    // Log Income button is visible
    expect(wrapper.find('[data-test="log-income"]').exists()).toBe(true);
  });

  it('income submit enqueues direction:income, positive amount_cents, category:income, account_id, note', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    // Switch to income mode
    await wrapper.find('[data-test="mode-income"]').trigger('click');
    await wrapper.vm.$nextTick();

    // Enter amount
    await wrapper.find('[data-test="amount"]').setValue('500.00');

    // Pick account (bank: id=10 is pre-selected as default bank)
    // Confirm account picker exists
    expect(wrapper.find('[data-test="income-account"]').exists()).toBe(true);

    // Select a source chip (Side gig)
    await wrapper.find('[data-test="income-src-side-gig"]').trigger('click');
    await wrapper.vm.$nextTick();

    // Submit
    await wrapper.find('[data-test="log-income"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(enqueued.length).toBe(1);
    const t = enqueued[0];
    expect(t.direction).toBe('income');
    expect(t.amount_cents).toBe(50000); // +RM500 = +50000 sen (positive)
    expect(t.category).toBe('income');
    expect(t.account_id).toBe(10); // bank account pre-selected
    expect(t.note).toBe('Side gig');
    expect(t.date).toBe('2026-06-19');

    // emits logged
    expect(wrapper.emitted('logged')).toBeTruthy();
  });

  it('income submit without source chip sets note to undefined', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.find('[data-test="mode-income"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-test="amount"]').setValue('1000.00');
    await wrapper.find('[data-test="log-income"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(enqueued[0].direction).toBe('income');
    expect(enqueued[0].amount_cents).toBe(100000);
    expect(enqueued[0].note == null || enqueued[0].note === undefined).toBe(true);
  });

  it('income mode does not enqueue when amount is empty', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.find('[data-test="mode-income"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-test="log-income"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued.length).toBe(0);
  });

  it('switching back to expense mode restores expense chips', async () => {
    const wrapper = mount(QuickLog, { props: { accountId: 1 } });
    await wrapper.find('[data-test="mode-income"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-test="mode-expense"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="cat-food"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="log-income"]').exists()).toBe(false);
  });

  // ── Expense account picker (new behaviour) ──────────────────────────────
  it('expense mode renders account picker when >1 spendable account', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    // Already in expense mode by default
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="expense-account"]').exists()).toBe(true);
  });

  it('expense mode does NOT render account picker when only 1 spendable account', async () => {
    const singleAccount = [{ id: 12, name: 'Cash Wallet', type: 'cash' }];
    const wrapper = mount(QuickLog, {
      props: { accountId: 12, defaultDate: '2026-06-19', accounts: singleAccount },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="expense-account"]').exists()).toBe(false);
  });

  it('expense mode defaults selectedAccountId to Cash account', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.vm.$nextTick();

    // Enter amount and log — should use Cash Wallet (id=12) by default
    await wrapper.find('[data-test="amount"]').setValue('10.00');
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(enqueued.length).toBe(1);
    expect(enqueued[0].account_id).toBe(12); // Cash Wallet is default for expense
    expect(enqueued[0].direction).toBe('expense');
  });

  it('selecting a different account in expense mode enqueues chosen account_id', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.vm.$nextTick();

    // Change picker to Touch n Go (id=11)
    const select = wrapper.find('[data-test="expense-account"]');
    await select.setValue('11');
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-test="amount"]').setValue('25.00');
    await wrapper.find('[data-test="cat-transport"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(enqueued.length).toBe(1);
    expect(enqueued[0].direction).toBe('expense');
    expect(enqueued[0].account_id).toBe(11); // chosen ewallet, not hardcoded cash
    expect(enqueued[0].amount_cents).toBe(-2500);
  });

  it('expense account picker label is "Paid from"', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.vm.$nextTick();

    const label = wrapper.find('label[for="expense-account"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe('Paid from');
  });

  it('switching from expense to income re-defaults to bank account', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.vm.$nextTick();

    // Confirm expense default is Cash (id=12)
    await wrapper.find('[data-test="amount"]').setValue('5.00');
    await wrapper.find('[data-test="cat-food"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(enqueued[0].account_id).toBe(12);

    // Switch to income — should now default to bank (id=10)
    await wrapper.find('[data-test="mode-income"]').trigger('click');
    await wrapper.vm.$nextTick();
    await wrapper.find('[data-test="amount"]').setValue('500.00');
    await wrapper.find('[data-test="log-income"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(enqueued[1].direction).toBe('income');
    expect(enqueued[1].account_id).toBe(10); // bank re-selected for income
  });

  it('expense mode does not render income picker (data-test="income-account")', async () => {
    const wrapper = mount(QuickLog, {
      props: { accountId: 1, defaultDate: '2026-06-19', accounts: mockAccounts },
    });
    await wrapper.vm.$nextTick();

    // In expense mode, income-account should not exist
    expect(wrapper.find('[data-test="income-account"]').exists()).toBe(false);
    // But expense-account should exist
    expect(wrapper.find('[data-test="expense-account"]').exists()).toBe(true);
  });
});
