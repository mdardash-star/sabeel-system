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

function metaValue(item, key) {
  const meta = Array.isArray(item?.meta_data) ? item.meta_data : [];
  const entry = meta.find(value => value.key === key);
  return entry?.value ?? null;
}

export function serviceJobFromPaidOrder(order, options = {}) {
  if (!order?.id) throw new Error('WooCommerce order id is required');
  if (!['processing', 'completed'].includes(order.status)) {
    throw new Error('Order must be paid before creating a service job');
  }
  if (!requiresService(order)) return null;

  const identity = customerIdentityFromOrder(order);
  const customerId = options.customerId ? String(options.customerId) : null;
  const serviceItems = order.line_items.filter(item => String(metaValue(item, '_subil_requires_service')) === 'yes');
  const requiredSkillCode = serviceItems.map(item => String(metaValue(item, '_subil_required_skill') || '').trim()).find(Boolean) || null;
  const durationValue = serviceItems.map(item => Number(metaValue(item, '_subil_service_duration_minutes'))).find(value => Number.isInteger(value) && value > 0 && value <= 1440);

  return {
    source: 'woocommerce',
    externalOrderId: String(order.id),
    idempotencyKey: orderKey(order),
    status: 'pending_assignment',
    customerId,
    customerIdentityKey: identity.identityKey,
    requiredSkillCode,
    serviceDurationMinutes: durationValue || 60,
    customer: {
      name: [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ').trim()
    },
    serviceLocation: {
      address1: order.shipping?.address_1 || order.billing?.address_1 || '',
      address2: order.shipping?.address_2 || order.billing?.address_2 || '',
      city: order.shipping?.city || order.billing?.city || ''
    },
    items: serviceItems.map(item => ({ externalLineItemId: String(item.id), name: item.name, quantity: item.quantity }))
  };
}

export function extractOrderAttribution(order){
  const meta=Array.isArray(order?.meta_data)?order.meta_data:[];
  const get=(key)=>{const row=meta.find(x=>x.key===key);return row?.value==null?'':String(row.value).trim();};
  const source=get('_wc_order_attribution_utm_source')||get('_wc_order_attribution_source_type')||'';
  const medium=get('_wc_order_attribution_utm_medium')||'';
  const campaign=get('_wc_order_attribution_utm_campaign')||'';
  const content=get('_wc_order_attribution_utm_content')||'';
  const term=get('_wc_order_attribution_utm_term')||'';
  const landingUrl=get('_wc_order_attribution_session_entry')||'';
  const occurredAt=get('_wc_order_attribution_session_start_time')||order?.date_created_gmt||order?.date_created||new Date().toISOString();
  const meaningful=Boolean(source&&source!=='(direct)'||medium||campaign||content||term);
  return {source:source||'(direct)',medium,campaign,content,term,landingUrl,occurredAt,meaningful};
}
