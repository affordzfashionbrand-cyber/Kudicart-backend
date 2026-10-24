/**
 * Order packet formatter for Driver Partner API responses
 */

export function formatOrderPacket(order: any, store: any, isTryAndBuy: boolean) {
  const customer = store.users.find((u: any) => u.id === order.customerId);
  const address = store.addresses.find((a: any) => a.id === order.addressId);
  const vendor = store.vendors.find((v: any) => v.id === order.vendorId) || store.vendors[0];

  const cashToCollect =
    order.paymentMethod === 'COD' && order.paymentStatus !== 'COMPLETED'
      ? order.grandTotal
      : 0;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: isTryAndBuy ? 'TRY_AND_BUY' : 'STANDARD',
    isTryAndBuy,
    status: order.status,
    pickupLocation: vendor?.storeName || 'KudiCart Darkstore Hub #04 - Indiranagar',
    pickupAddress: vendor?.address || '100ft Road, HAL 2nd Stage, Indiranagar, Bengaluru',
    customerName: customer?.name || 'Ananya Sharma',
    customerPhone: customer?.phone || '+91 98450 12890',
    customerAddress: address
      ? `${address.line1}, ${address.locality}, ${address.city} - ${address.pincode}`
      : 'Indiranagar, Bengaluru',
    itemsCount: (order.items || []).reduce((acc: number, i: any) => acc + (i.quantity || 1), 0),
    toteId: '#T-08',
    distance: '2.4 km',
    eta: `${order.etaMinutes || 15} mins`,
    grandTotal: order.grandTotal,
    itemTotal: order.itemTotal || order.grandTotal,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    cashToCollect,
    createdAt: order.createdAt,
    // Backward-compatible structured fields for tests
    pickupStore: {
      name: vendor?.storeName || 'Avanya Ethnic Boutique',
      address: vendor?.address || 'Shop 14, 100ft Road, Indiranagar, Bengaluru, Karnataka 560038',
      phone: vendor?.phone || '+91 80 4123 9988',
    },
    dropoffAddress: address
      ? `${address.line1}, ${address.locality}, ${address.city} - ${address.pincode}`
      : 'Indiranagar, Bengaluru',
    customer: {
      id: customer?.id || order.customerId,
      name: customer?.name || 'Customer',
      phone: customer?.phone || '+91 98450 12890',
    },
    pickup: {
      storeName: vendor?.storeName || 'Avanya Ethnic Boutique',
      address: vendor?.address || 'Shop 14, 100ft Road, Indiranagar, Bengaluru, Karnataka 560038',
      phone: vendor?.phone || '+91 80 4123 9988',
      contactPerson: vendor?.contactPerson || 'Meera Deshmukh',
      googleMapsQuery: encodeURIComponent(vendor?.address || 'Indiranagar, Bengaluru'),
    },
    dropoff: {
      label: address?.label || 'Home',
      address: address
        ? `${address.line1}, ${address.locality}, ${address.city} - ${address.pincode}`
        : 'Delivery Location',
      phone: customer?.phone || '+91 98450 12890',
      googleMapsQuery: address
        ? encodeURIComponent(`${address.line1}, ${address.locality}, ${address.city}`)
        : '',
    },
    items: order.items || [],
    history: order.history || [],
    earnings: 55,
    // Try & Buy fields
    tryAndBuyStage: order.tryAndBuyStage || (isTryAndBuy ? 'HANDOVER_PENDING' : undefined),
    trialDurationMinutes: order.trialDurationMinutes || 20,
    handoverConfirmedAt: order.handoverConfirmedAt || null,
    trialStartedAt: order.trialStartedAt || null,
    trialEndsAt: order.trialEndsAt || null,
    finalPayableTotal: order.finalPayableTotal,
    refundAmount: order.refundAmount,
    amountDue: order.amountDue,
    returnManifestId: order.returnManifestId,
    returnImages: order.returnImages || [],
    storeReconciliationStatus: order.storeReconciliationStatus,
  };
}
