export function orderKey(order) {
  if (!order?.id) throw new Error('WooCommerce order id is required');
  return `woocommerce:${order.id}`;
}

export function requiresService(order) {
  return Array.isArray(order?.line_items) && order.line_items.some(item => {
    const meta = Array.isArray(item.meta_data) ? item.meta_data : [];
    return meta.some(entry => entry.key === '_subil_requires_service' && String(entry.value) === 'yes');
  });
}

export function customerIdentityFromOrder(order) {
  if (!order?.id) throw new Error('WooCommerce order id is required');
  const externalCustomerId = Number(order.customer_id || 0) > 0 ? String(order.customer_id) : null;
  const email = String(order.billing?.email || '').trim().toLowerCase() || null;
  const phone = String(order.billing?.phone || '').trim() || null;

  return {
    source: 'woocommerce',
    externalCustomerId,
    email,
    phone,
    identityKey: externalCustomerId
      ? `woocommerce:customer:${externalCustomerId}`
      : email
        ? `woocommerce:email:${email}`
        : phone
          ? `woocommerce:phone:${phone}`
          : `woocommerce:guest-order:${order.id}`
  };
}

export function serviceJobFromPaidOrder(order, options = {}) {
  if (!order?.id) throw new Error('WooCommerce order id is required');
  if (!['processing', 'completed'].includes(order.status)) {
    throw new Error('Order must be paid before creating a service job');
  }
  if (!requiresService(order)) return null;

  const identity = customerIdentityFromOrder(order);
  const customerId = options.customerId ? String(options.customerId) : null;

  return {
    source: 'woocommerce',
    externalOrderId: String(order.id),
    idempotencyKey: orderKey(order),
    status: 'pending_assignment',
    customerId,
    customerIdentityKey: identity.identityKey,
    customer: {
      name: [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ').trim()
    },
    serviceLocation: {
      address1: order.shipping?.address_1 || order.billing?.address_1 || '',
      address2: order.shipping?.address_2 || order.billing?.address_2 || '',
      city: order.shipping?.city || order.billing?.city || ''
    },
    items: order.line_items.filter(item => {
      const meta = Array.isArray(item.meta_data) ? item.meta_data : [];
      return meta.some(entry => entry.key === '_subil_requires_service' && String(entry.value) === 'yes');
    }).map(item => ({ externalLineItemId: String(item.id), name: item.name, quantity: item.quantity }))
  };
}
