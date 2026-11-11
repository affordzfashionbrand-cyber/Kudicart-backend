export const GIFT_WRAP_FEE = 35;
export const FREE_DELIVERY_THRESHOLD = 1499;
export const STANDARD_DELIVERY_FEE = 40;
export const GST_TAX_RATE = 0.05;
export const DEFAULT_COMMISSION_RATE = 12.5;
export const MAX_DARK_STORE_RADIUS_KM = 8.0;

export function roundRupees(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

export function roundCurrency2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * Largest-remainder pro-rata integer allocation so split-order discounts
 * sum back to the exact total discount without rupee drift.
 */
export function allocateProRata(totalAmount: number, weights: number[]): number[] {
  const cleanTotal = Math.max(0, Math.round(totalAmount));
  const sumWeights = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (weights.length === 0 || cleanTotal === 0 || sumWeights <= 0) {
    return weights.map(() => 0);
  }

  const rawShares = weights.map((w) => (cleanTotal * Math.max(0, w)) / sumWeights);
  const floored = rawShares.map((s) => Math.floor(s));
  let remainder = cleanTotal - floored.reduce((acc, v) => acc + v, 0);

  const indexedRemainders = rawShares
    .map((s, idx) => ({ idx, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < indexedRemainders.length && remainder > 0; i++) {
    floored[indexedRemainders[i].idx] += 1;
    remainder -= 1;
  }

  return floored.map((amt, i) => Math.min(amt, Math.max(0, Math.round(weights[i]))));
}

export interface PricedLineItem {
  price: number;
  quantity: number;
}

export function computeSplitOrderTotals(params: {
  items: PricedLineItem[];
  discountAmount?: number;
  giftWrapFee?: number;
  donationAmount?: number;
}) {
  const itemTotal = roundRupees(
    params.items.reduce((acc, it) => acc + Math.round(it.price) * Math.max(1, it.quantity), 0),
  );
  const discountAmount = Math.min(itemTotal, Math.max(0, roundRupees(params.discountAmount || 0)));
  const deliveryFee =
    itemTotal > 0 ? (itemTotal >= FREE_DELIVERY_THRESHOLD ? 0 : STANDARD_DELIVERY_FEE) : 0;
  const taxes = roundRupees(itemTotal * GST_TAX_RATE);
  const giftWrapFee = Math.max(0, roundRupees(params.giftWrapFee || 0));
  const donationAmount = Math.max(0, roundRupees(params.donationAmount || 0));
  const grandTotal =
    Math.max(0, itemTotal - discountAmount) +
    deliveryFee +
    taxes +
    giftWrapFee +
    donationAmount;

  return {
    itemTotal,
    discountAmount,
    deliveryFee,
    taxes,
    giftWrapFee,
    donationAmount,
    grandTotal,
  };
}

export function computeTryAndBuyFinancials(params: {
  order: {
    itemTotal: number;
    deliveryFee: number;
    taxes: number;
    discountAmount: number;
    giftWrapFee?: number;
    donationAmount?: number;
    grandTotal: number;
    paymentMethod: string;
  };
  items: Array<{ id: string; price: number; quantity: number }>;
  selections: Record<string, 'KEEP' | 'RETURN'>;
}) {
  const { order, items, selections } = params;

  const keptItems = items.filter((it) => (selections[it.id] || 'KEEP') === 'KEEP');
  const returnedItems = items.filter((it) => selections[it.id] === 'RETURN');

  const keptItemTotal = roundRupees(
    keptItems.reduce((acc, it) => acc + Math.round(it.price) * Math.max(1, it.quantity), 0),
  );
  const returnedItemTotal = roundRupees(
    returnedItems.reduce((acc, it) => acc + Math.round(it.price) * Math.max(1, it.quantity), 0),
  );

  let finalPayableTotal = 0;
  let keptDiscount = 0;

  if (keptItemTotal === order.itemTotal && returnedItems.length === 0) {
    finalPayableTotal = order.grandTotal;
    keptDiscount = order.discountAmount || 0;
  } else if (keptItemTotal > 0 && order.itemTotal > 0) {
    keptDiscount = Math.min(
      keptItemTotal,
      roundRupees((order.discountAmount || 0) * (keptItemTotal / order.itemTotal)),
    );
    const keptTaxes = roundRupees(keptItemTotal * GST_TAX_RATE);
    finalPayableTotal =
      Math.max(0, keptItemTotal - keptDiscount) +
      keptTaxes +
      (order.deliveryFee || 0) +
      (order.giftWrapFee || 0) +
      (order.donationAmount || 0);
  } else {
    finalPayableTotal = 0;
    keptDiscount = 0;
  }

  finalPayableTotal = Math.min(order.grandTotal, Math.max(0, roundRupees(finalPayableTotal)));
  const refundAmount =
    order.paymentMethod === 'RAZORPAY'
      ? Math.max(0, roundRupees(order.grandTotal - finalPayableTotal))
      : 0;
  const amountDue = order.paymentMethod === 'COD' ? finalPayableTotal : 0;
  const netKeptSubtotalForCommission = Math.max(0, keptItemTotal - keptDiscount);

  return {
    keptItems,
    returnedItems,
    keptItemTotal,
    returnedItemTotal,
    keptDiscount,
    netKeptSubtotalForCommission,
    finalPayableTotal,
    refundAmount,
    amountDue,
  };
}

export function computeCommissionBreakdown(
  netKeptSubtotal: number,
  commissionRate: number = DEFAULT_COMMISSION_RATE,
) {
  const safeSubtotal = Math.max(0, Number(netKeptSubtotal) || 0);
  const safeRate = Math.max(0, Math.min(100, Number(commissionRate) || DEFAULT_COMMISSION_RATE));
  const commissionAmount = roundCurrency2((safeSubtotal * safeRate) / 100);
  const vendorPayout = roundCurrency2(safeSubtotal - commissionAmount);
  return {
    commissionRate: safeRate,
    commissionAmount,
    vendorPayout,
  };
}
