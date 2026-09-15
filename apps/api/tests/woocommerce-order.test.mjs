import test from 'node:test';
import assert from 'node:assert/strict';
import { orderKey, requiresService, customerIdentityFromOrder, serviceJobFromPaidOrder } from '../src/integrations/woocommerce-order.mjs';

const paidOrder = {
  id: 8534001,
  customer_id: 42,
  status: 'processing',
  billing: { first_name: 'Customer', last_name: 'One', email: 'Customer@Example.com', phone: '+966500000000', address_1: 'A', city: 'Riyadh' },
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

test('creates stable customer identity without exposing phone on technician job view', () => {
  const identity = customerIdentityFromOrder(paidOrder);
  assert.equal(identity.externalCustomerId, '42');
  assert.equal(identity.identityKey, 'woocommerce:customer:42');
  assert.equal(identity.email, 'customer@example.com');
});

test('maps a paid service order to pending assignment and internal customer id', () => {
  const job = serviceJobFromPaidOrder(paidOrder, { customerId: 'subil-customer-1' });
  assert.equal(job.status, 'pending_assignment');
  assert.equal(job.externalOrderId, '8534001');
  assert.equal(job.customerId, 'subil-customer-1');
  assert.equal(job.customerIdentityKey, 'woocommerce:customer:42');
  assert.equal(job.serviceLocation.city, 'Riyadh');
  assert.equal(job.items.length, 1);
  assert.equal('phone' in job.customer, false);
});

test('uses deterministic guest identity when WooCommerce customer data is unavailable', () => {
  const guest = { ...paidOrder, customer_id: 0, billing: { first_name: 'Guest' } };
  assert.equal(customerIdentityFromOrder(guest).identityKey, 'woocommerce:guest-order:8534001');
});

test('does not create job for product without service', () => {
  const order = { ...paidOrder, line_items: [{ id: 11, name: 'Filter', quantity: 1, meta_data: [] }] };
  assert.equal(serviceJobFromPaidOrder(order), null);
});

test('rejects unpaid order status', () => {
  assert.throws(() => serviceJobFromPaidOrder({ ...paidOrder, status: 'pending' }));
});
