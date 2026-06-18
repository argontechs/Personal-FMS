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

beforeEach(() => { enqueued.length = 0; });

describe('QuickLog', () => {
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
});
