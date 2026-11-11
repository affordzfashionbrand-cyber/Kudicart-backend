import { haversineDistanceKm } from '../orders/order-pricing.util';

export function formatOrderPacket(order: any, _legacyStore?: any, explicitTryAndBuy?: boolean) {
  const vendor = order.vendor || {};
  const customer = order.customer || {};
  const address = order.deliveryAddress || order.address || {};
  const tnb = order.tryAndBuySession || null;
  const isTryAndBuy =
    explicitTryAndBuy !== undefined ? explicitTryAndBuy : Boolean(order.isTryAndBuy);

  const amountToCollect =
    order.paymentMethod === 'COD' && order.paymentStatus !== 'COMPLETED'
      ? Math.round(tnb?.amountDue ?? order.grandTotal ?? 0)
      : 0;

  const pickupLat =
    vendor?.darkStoreHub?.lat ??
    order.items?.[0]?.product?.darkStoreHub?.lat ??
    12.9716;
  const pickupLng =
    vendor?.darkStoreHub?.lng ??
    order.items?.[0]?.product?.darkStoreHub?.lng ??
    77.6412;

  const dropLat = typeof address?.latitude === 'number' ? address.latitude : null;
  const dropLng = typeof address?.longitude === 'number' ? address.longitude : null;
  const distanceKm =
    dropLat != null && dropLng != null
      ? `${haversineDistanceKm(pickupLat, pickupLng, dropLat, dropLng)} km`
      : '2.4 km';

  const formattedAddress = address?.line1
    ? `${address.line1}, ${address.locality || ''}${address.city ? `, ${address.city}` : ''}`.replace(
        /,\s*,/g,
        ',',
      )
    : 'Bengaluru Delivery Address';

  const pickupName = vendor?.storeName || 'Affordz Official Store';
  const pickupAddress =
    vendor?.darkStoreHub?.address ||
    order.items?.[0]?.product?.darkStoreHub?.address ||
    'Indiranagar Express Hub, Bengaluru';

  const stage = tnb?.stage || (order.tryAndBuyStage ?? (isTryAndBuy ? 'HANDOVER_PENDING' : undefined));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    version: order.version ?? 1,
    fulfillmentType: order.fulfillmentType || 'DARK_STORE',
    orderType: isTryAndBuy ? 'TRY_AND_BUY' : 'STANDARD',
    isTryAndBuy,
    status: order.status,
    arrivedAt: order.arrivedAt ? new Date(order.arrivedAt).toISOString() : null,
    isArrived: Boolean(order.arrivedAt),
    deliveredAt: order.deliveredAt ? new Date(order.deliveredAt).toISOString() : null,
    verificationPhotos: Array.isArray(order.verificationPhotos)
      ? order.verificationPhotos
      : [],
    pickupLocation: pickupName,
    pickupAddress,
    customerName: customer?.name || address?.recipientName || 'Customer',
    customerPhone: customer?.phone || address?.recipientPhone || '',
    customerAddress: formattedAddress,
    itemsCount: (order.items || []).reduce(
      (acc: number, i: any) => acc + (i.quantity || 1),
      0,
    ),
    toteId: `T-${String(order.orderNumber || order.id).slice(-3)}`,
    distance: distanceKm,
    eta: `${order.etaMinutes ?? 15} mins`,
    pickupCoordinates: { latitude: pickupLat, longitude: pickupLng },
    deliveryCoordinates:
      dropLat != null && dropLng != null ? { latitude: dropLat, longitude: dropLng } : null,
    grandTotal: Math.round(order.grandTotal || 0),
    itemTotal: Math.round(order.itemTotal || order.grandTotal || 0),
    deliveryFee: Math.round(order.deliveryFee || 0),
    taxes: Math.round(order.taxes || 0),
    discountAmount: Math.round(order.discountAmount || 0),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    amountToCollect,
    createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString(),
    pickupStore: {
      name: pickupName,
      address: pickupAddress,
      phone: vendor?.user?.phone || '',
    },
    dropoffAddress: formattedAddress,
    customer: {
      id: customer?.id || order.customerId,
      name: customer?.name || address?.recipientName || 'Customer',
      phone: customer?.phone || address?.recipientPhone || '',
    },
    pickup: {
      storeName: pickupName,
      address: pickupAddress,
      phone: vendor?.user?.phone || '',
      contactPerson: vendor?.user?.name || 'Store Supervisor',
      googleMapsQuery: encodeURIComponent(pickupAddress),
    },
    dropoff: {
      label: address?.label || 'Home',
      address: formattedAddress,
      phone: customer?.phone || address?.recipientPhone || '',
      googleMapsQuery: encodeURIComponent(formattedAddress),
    },
    items: (order.items || []).map((it: any) => ({
      id: it.id,
      productId: it.productId,
      title: it.title,
      brand: it.brand,
      size: it.size,
      trialSize: it.trialSize ?? null,
      price: Math.round(it.price || 0),
      quantity: it.quantity || 1,
      image: it.image,
      tryAndBuyDecision: it.tryAndBuyDecision ?? null,
      returnCondition: it.returnCondition ?? null,
      collectedAt: it.collectedAt ? new Date(it.collectedAt).toISOString() : null,
    })),
    history: (order.history || []).map((h: any) => ({
      id: h.id,
      status: h.status,
      note: h.note,
      actorId: h.actorId ?? null,
      actorRole: h.actorRole ?? null,
      createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
    })),
    earnings: 55,
    tryAndBuyStage: stage,
    trialDurationMinutes: tnb?.trialDurationMinutes ?? 10,
    handoverConfirmedAt: tnb?.handoverConfirmedAt?.toISOString?.() ?? null,
    trialStartedAt: tnb?.trialStartedAt?.toISOString?.() ?? null,
    trialEndsAt: tnb?.trialEndsAt?.toISOString?.() ?? null,
    customerSelectionAt: tnb?.customerSelectionAt?.toISOString?.() ?? null,
    keptItemIds: tnb?.keptItemIds || [],
    returnedItemIds: tnb?.returnedItemIds || [],
    handoverImages: tnb?.handoverImages || [],
    finalPayableTotal: tnb?.finalPayableTotal ?? null,
    refundAmount: tnb?.refundAmount ?? null,
    amountDue: tnb?.amountDue ?? null,
    returnManifestId: tnb?.returnManifestId ?? null,
    returnImages: tnb?.returnImages || [],
    storeReconciliationStatus: tnb?.storeReconciliationStatus ?? null,
    tryAndBuySession: tnb || null,
  };
}
