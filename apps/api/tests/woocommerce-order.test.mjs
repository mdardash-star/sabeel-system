import test from 'node:test';
import assert from 'node:assert/strict';
import { orderKey, requiresService, serviceJobFromPaidOrder } from '../src/integrations/woocommerce-order.mjs';

const paidOrder = {
  id: 8534001,
  status: 'processing',
  billing: { first_name: 'Customer', last_name: 'One', address_1: 'A', city: 'Riyadh' },
  shipping: { address_1: 'B', city: 'Riyadh' },
  line_items: [{
    id: 10,
    name: 'Installation product',
    quantity: 1,
    meta_data: [{ key: '_subil_requires_service', value: 'yes' }]
  }]
};

test('creates stable idempotency key', () => {
  assert.equal(orderKey(paidOrder), 'woocommerce:8534001');
});

test('detects service items', () => {
  assert.equal(requiresService(paidOrder), true);
});

test('maps a paid service order to pending assignment', () => {
  const job = serviceJobFromPaidOrder(paidOrder);
  assert.equal(job.status, 'pending_assignment');
  assert.equal(job.externalOrderId, '8534001');
  assert.equal(job.serviceLocation.city, 'Riyadh');
  assert.equal(job.items.length, 1);
  assert.equal('phone' in job.customer, false);
});

test('does not create job for product without service', () => {
  const order = { ...paidOrder, line_items: [{ id: 11, name: 'Filter', quantity: 1, meta_data: [] }] };
  assert.equal(serviceJobFromPaidOrder(order), null);
});

test('rejects unpaid order status', () => {
  assert.throws(() => serviceJobFromPaidOrder({ ...paidOrder, status: 'pending' }));
});
