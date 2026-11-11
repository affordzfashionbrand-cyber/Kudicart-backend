import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayClientService } from './razorpay-client.service';
import { Role } from '../../common/enums/role.enum';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { verifyJwtToken } from '../../common/utils/crypto.util';
import {
  createCheckoutSessionToken,
  verifyCheckoutSessionToken,
} from '../../common/utils/checkout-session.util';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpayClient: RazorpayClientService,
    @Optional() private readonly firebaseAdmin?: FirebaseAdminService,
  ) {}

  private ensureDbConnected() {
    if (!this.prisma.isConnectedToDb) {
      throw new ServiceUnavailableException('PostgreSQL database connection is unavailable.');
    }
  }

  private async resolveCheckoutTarget(targetId: string, razorpayOrderId?: string) {
    const tokens = [targetId, razorpayOrderId].filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );

    const group = await this.prisma.checkoutGroup.findFirst({
      where: {
        OR: [
          ...tokens.map((t) => ({ id: t })),
          ...tokens.map((t) => ({ groupNumber: t })),
          ...tokens.map((t) => ({ razorpayOrderId: t })),
        ],
      },
      include: {
        orders: true,
        transactions: true,
      },
    });

    if (group) {
      return {
        kind: 'GROUP' as const,
        group,
        orders: group.orders,
        customerId: group.customerId,
        grandTotal: group.grandTotal,
        razorpayOrderId: group.razorpayOrderId,
        paymentStatus: group.paymentStatus,
        paymentMethod: group.paymentMethod,
        titleRef: group.groupNumber,
      };
    }

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          ...tokens.map((t) => ({ id: t })),
          ...tokens.map((t) => ({ orderNumber: t.replace(/^#/, '') })),
          ...tokens.map((t) => ({ razorpayOrderId: t })),
        ],
      },
      include: {
        checkoutGroup: { include: { orders: true, transactions: true } },
        transactions: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order or CheckoutGroup '${targetId}' not found`);
    }

    if (order.checkoutGroup) {
      return {
        kind: 'GROUP' as const,
        group: order.checkoutGroup,
        orders: order.checkoutGroup.orders,
        customerId: order.checkoutGroup.customerId,
        grandTotal: order.checkoutGroup.grandTotal,
        razorpayOrderId: order.checkoutGroup.razorpayOrderId || order.razorpayOrderId,
        paymentStatus: order.checkoutGroup.paymentStatus,
        paymentMethod: order.checkoutGroup.paymentMethod,
        titleRef: order.checkoutGroup.groupNumber,
      };
    }

    return {
      kind: 'ORDER' as const,
      group: null,
      orders: [order],
      customerId: order.customerId,
      grandTotal: order.grandTotal,
      razorpayOrderId: order.razorpayOrderId,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      titleRef: order.orderNumber,
    };
  }

  async createRazorpayOrder(
    amount: number,
    orderOrGroupId?: string,
    actorId?: string,
    actorRole?: string,
  ) {
    this.ensureDbConnected();

    let effectiveAmount = Math.round(amount);
    let receipt = `kc_rcpt_${Date.now()}`;
    let notes: Record<string, string> = {};

    if (orderOrGroupId) {
      const target = await this.resolveCheckoutTarget(orderOrGroupId);
      if (actorRole === Role.CUSTOMER && actorId && target.customerId !== actorId) {
        throw new ForbiddenException('You do not have permission to pay for this order');
      }
      if (target.paymentStatus === 'COMPLETED') {
        throw new ConflictException('Order payment has already been completed');
      }
      if (target.orders.some((o) => o.status === 'FAILED' || o.status === 'CANCELLED')) {
        throw new ConflictException('Order is expired or cancelled and cannot accept payment');
      }

      effectiveAmount = Math.round(target.grandTotal);
      receipt = target.titleRef;
      notes = target.group
        ? { checkoutGroupId: target.group.id, customerId: target.customerId }
        : { orderId: target.orders[0].id, customerId: target.customerId };

      if (target.razorpayOrderId) {
        const canonicalId = target.group?.id || target.orders[0].id;
        const amountInPaisa = Math.round(effectiveAmount * 100);
        const checkoutSessionToken = createCheckoutSessionToken(canonicalId, target.customerId);
        return {
          razorpayOrderId: target.razorpayOrderId,
          orderId: canonicalId,
          amount: amountInPaisa,
          amountInPaisa,
          currency: 'INR',
          keyId: this.razorpayClient.keyId || null,
          checkoutSessionToken,
          checkoutSessionUrl: `/api/v1/payments/razorpay/checkout-session/${encodeURIComponent(canonicalId)}?st=${encodeURIComponent(checkoutSessionToken)}`,
        };
      }

      const rzp = await this.razorpayClient.createOrder({
        amountInPaisa: Math.round(effectiveAmount * 100),
        receipt,
        notes,
      });

      await this.prisma.$transaction(async (tx) => {
        if (target.group) {
          await tx.checkoutGroup.update({
            where: { id: target.group.id },
            data: { razorpayOrderId: rzp.razorpayOrderId },
          });
        }
        await tx.order.updateMany({
          where: { id: { in: target.orders.map((o) => o.id) } },
          data: { razorpayOrderId: rzp.razorpayOrderId },
        });
      });

      const canonicalId = target.group?.id || target.orders[0].id;
      const amountInPaisa = Math.round(effectiveAmount * 100);
      const checkoutSessionToken = createCheckoutSessionToken(canonicalId, target.customerId);

      return {
        razorpayOrderId: rzp.razorpayOrderId,
        orderId: canonicalId,
        amount: amountInPaisa,
        amountInPaisa,
        currency: 'INR',
        keyId: this.razorpayClient.keyId || null,
        checkoutSessionToken,
        checkoutSessionUrl: `/api/v1/payments/razorpay/checkout-session/${encodeURIComponent(canonicalId)}?st=${encodeURIComponent(checkoutSessionToken)}`,
      };
    }

    const rzp = await this.razorpayClient.createOrder({
      amountInPaisa: Math.round(effectiveAmount * 100),
      receipt,
      notes,
    });

    const amountInPaisa = Math.round(effectiveAmount * 100);
    return {
      razorpayOrderId: rzp.razorpayOrderId,
      amount: amountInPaisa,
      amountInPaisa,
      currency: 'INR',
      keyId: this.razorpayClient.keyId || null,
    };
  }

  async verifyRazorpaySignature(
    targetId: string,
    paymentId: string,
    signature: string,
    razorpayOrderId?: string,
    actorId?: string,
    actorRole?: string,
  ) {
    this.ensureDbConnected();

    const target = await this.resolveCheckoutTarget(targetId, razorpayOrderId);
    if (actorRole === Role.CUSTOMER && actorId && target.customerId !== actorId) {
      throw new ForbiddenException('You do not have permission to verify this payment');
    }

    const effectiveRzpOrderId = target.razorpayOrderId || razorpayOrderId;
    if (!effectiveRzpOrderId) {
      throw new BadRequestException('No Razorpay order reference found for signature check');
    }

    const valid = this.razorpayClient.verifyPaymentSignature({
      razorpayOrderId: effectiveRzpOrderId,
      paymentId,
      signature,
    });

    if (!valid) {
      throw new BadRequestException('Invalid Razorpay payment signature');
    }

    if (target.orders.some((o) => o.status === 'FAILED' || o.status === 'CANCELLED')) {
      throw new ConflictException('Order has already expired or been cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      if (target.group) {
        await tx.checkoutGroup.update({
          where: { id: target.group.id },
          data: { paymentStatus: 'COMPLETED', razorpayPaymentId: paymentId },
        });
      }

      await tx.order.updateMany({
        where: { id: { in: target.orders.map((o) => o.id) } },
        data: { paymentStatus: 'COMPLETED', razorpayPaymentId: paymentId },
      });

      const existing = await tx.paymentTransaction.findFirst({
        where: { paymentId, transactionType: 'CAPTURE' },
      });

      if (!existing) {
        await tx.paymentTransaction.create({
          data: {
            checkoutGroupId: target.group?.id || null,
            orderId: target.orders.length === 1 ? target.orders[0].id : null,
            paymentId,
            razorpayOrderId: effectiveRzpOrderId,
            signature,
            amount: target.grandTotal,
            currency: 'INR',
            status: 'COMPLETED',
            transactionType: 'CAPTURE',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId || target.customerId,
          userRole: actorRole || Role.CUSTOMER,
          action: 'PAYMENT_VERIFIED',
          entityType: target.group ? 'CheckoutGroup' : 'Order',
          entityId: target.group ? target.group.id : target.orders[0].id,
          details: JSON.stringify({
            paymentId,
            razorpayOrderId: effectiveRzpOrderId,
            amount: target.grandTotal,
          }),
        },
      });
    });

    return {
      verified: true,
      checkoutGroupId: target.group?.id || null,
      orderId: target.orders[0]?.id || null,
      paymentStatus: 'COMPLETED',
      razorpayOrderId: effectiveRzpOrderId,
      razorpayPaymentId: paymentId,
    };
  }

  async getPaymentStatus(orderOrGroupId: string, actorId?: string, actorRole?: string) {
    this.ensureDbConnected();
    const target = await this.resolveCheckoutTarget(orderOrGroupId);

    if (actorRole === Role.CUSTOMER && actorId && target.customerId !== actorId) {
      throw new ForbiddenException('You do not have permission to view this payment status');
    }
    if (actorRole === Role.VENDOR && actorId) {
      const vendor = await this.prisma.vendor.findFirst({ where: { userId: actorId } });
      if (!vendor || !target.orders.some((o) => o.vendorId === vendor.id)) {
        throw new ForbiddenException('Order does not belong to your vendor store');
      }
    }
    if (actorRole === Role.DRIVER && actorId) {
      const driver = await this.prisma.driverProfile.findFirst({ where: { userId: actorId } });
      if (
        !target.orders.some(
          (o) =>
            o.driverId === actorId ||
            (driver && o.driverProfileId === driver.id),
        )
      ) {
        throw new ForbiddenException('Order is not assigned to your driver account');
      }
    }

    const transactions = await this.prisma.paymentTransaction.findMany({
      where: {
        OR: [
          ...(target.group ? [{ checkoutGroupId: target.group.id }] : []),
          { orderId: { in: target.orders.map((o) => o.id) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const primaryOrder = target.orders[0] || null;

    return {
      orderId: primaryOrder?.id || null,
      orderNumber: primaryOrder?.orderNumber || null,
      orderStatus: primaryOrder?.status || null,
      checkoutGroupId: target.group?.id || null,
      paymentMethod: target.paymentMethod,
      paymentStatus: target.paymentStatus,
      razorpayOrderId: target.razorpayOrderId,
      razorpayPaymentId:
        (target.group as any)?.razorpayPaymentId || primaryOrder?.razorpayPaymentId || null,
      updatedAt: (
        target.group?.updatedAt ||
        primaryOrder?.updatedAt ||
        new Date()
      ).toISOString(),
      grandTotal: Math.round(target.grandTotal),
      transactions,
    };
  }

  async authenticateCheckoutSessionAccess(
    orderOrGroupId: string,
    sessionToken?: string,
    authHeader?: string,
  ): Promise<{ actorId: string; actorRole: string }> {
    this.ensureDbConnected();

    if (sessionToken?.trim()) {
      const payload = verifyCheckoutSessionToken(sessionToken.trim());
      if (payload.orderId !== orderOrGroupId) {
        const target = await this.resolveCheckoutTarget(orderOrGroupId);
        const matchesGroup = target.group?.id === payload.orderId;
        const matchesOrder = target.orders.some((o) => o.id === payload.orderId);
        if (target.customerId !== payload.sub || (!matchesGroup && !matchesOrder)) {
          throw new UnauthorizedException('Checkout session token does not match requested order');
        }
      }
      return { actorId: payload.sub, actorRole: Role.CUSTOMER };
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (!token) {
        throw new UnauthorizedException('Authentication token is missing');
      }
      const jwtResult = verifyJwtToken(token);
      if (jwtResult.valid && jwtResult.payload?.sub) {
        const user = await this.prisma.user.findUnique({ where: { id: jwtResult.payload.sub } });
        if (!user || user.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is not active');
        }
        return { actorId: user.id, actorRole: user.role };
      }

      if (this.firebaseAdmin) {
        const decoded = await this.firebaseAdmin.verifyIdToken(token);
        if (decoded?.uid) {
          const user = await this.prisma.user.findFirst({
            where: {
              OR: [
                { firebaseUid: decoded.uid },
                ...(decoded.email ? [{ email: decoded.email.toLowerCase() }] : []),
              ],
            },
          });
          if (!user || user.status !== 'ACTIVE') {
            throw new UnauthorizedException('User account is not active');
          }
          return { actorId: user.id, actorRole: user.role };
        }
      }

      throw new UnauthorizedException('Invalid or expired Bearer token');
    }

    throw new UnauthorizedException('Checkout session token or Bearer authorization is required');
  }

  async generateCheckoutHtml(
    orderOrGroupId: string,
    actorId?: string,
    actorRole?: string,
  ): Promise<string> {
    this.ensureDbConnected();
    const target = await this.resolveCheckoutTarget(orderOrGroupId);
    if (actorRole === Role.CUSTOMER && actorId && target.customerId !== actorId) {
      throw new ForbiddenException('Access denied for this checkout session');
    }

    let rzpOrderId = target.razorpayOrderId;
    if (!rzpOrderId && target.paymentMethod === 'RAZORPAY') {
      const created = await this.createRazorpayOrder(
        target.grandTotal,
        orderOrGroupId,
        actorId,
        actorRole,
      );
      rzpOrderId = created.razorpayOrderId;
    }

    const customer = await this.prisma.user.findUnique({
      where: { id: target.customerId },
      select: { name: true, email: true, phone: true },
    });

    const esc = (v: string) =>
      String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const canonicalOrderId = target.group?.id || target.orders[0]?.id || orderOrGroupId;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Affordz Secure Checkout</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#F8FAFC;">
  <div style="text-align:center; padding:32px; background:#fff; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.08); max-width:360px;">
    <h2 style="margin:0 0 8px; color:#0F172A;">Affordz Checkout</h2>
    <p style="margin:0 0 20px; color:#475569;">${esc(target.titleRef)} &middot; &#8377;${Math.round(target.grandTotal)}</p>
    <button id="pay-btn" style="background:#0F172A; color:#fff; border:none; border-radius:10px; padding:12px 24px; font-weight:600; cursor:pointer; width:100%;">Pay with Razorpay</button>
    <p id="status-msg" style="margin:14px 0 0; font-size:13px; color:#64748B;"></p>
  </div>
  <script>
    function buildCallbackUrl(status, payload) {
      var params = [
        'orderId=' + encodeURIComponent("${esc(canonicalOrderId)}"),
        'status=' + encodeURIComponent(status)
      ];
      if (payload && payload.razorpay_payment_id) {
        params.push('razorpay_payment_id=' + encodeURIComponent(payload.razorpay_payment_id));
      }
      if (payload && payload.razorpay_order_id) {
        params.push('razorpay_order_id=' + encodeURIComponent(payload.razorpay_order_id));
      }
      if (payload && payload.razorpay_signature) {
        params.push('razorpay_signature=' + encodeURIComponent(payload.razorpay_signature));
      }
      return 'affordz://payment-callback?' + params.join('&');
    }
    const options = {
      key: "${esc(this.razorpayClient.keyId)}",
      amount: ${Math.round(target.grandTotal * 100)},
      currency: "INR",
      name: "Affordz",
      description: "Order ${esc(target.titleRef)}",
      order_id: "${esc(rzpOrderId || '')}",
      prefill: {
        name: "${esc(customer?.name || '')}",
        email: "${esc(customer?.email || '')}",
        contact: "${esc(customer?.phone || '')}"
      },
      handler: function (response) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RAZORPAY_SUCCESS', payload: response }));
          return;
        }
        document.getElementById('status-msg').textContent = 'Returning to Affordz...';
        window.location.href = buildCallbackUrl('success', response);
      },
      modal: {
        ondismiss: function () {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'RAZORPAY_DISMISSED' }));
            return;
          }
          document.getElementById('status-msg').textContent = 'Payment dismissed. Returning to Affordz...';
          window.location.href = buildCallbackUrl('dismissed', null);
        }
      }
    };
    document.getElementById('pay-btn').onclick = function () {
      const rzp = new Razorpay(options);
      rzp.open();
    };
  </script>
</body>
</html>`;
  }

  async confirmCod(orderId: string, actorId?: string, actorRole?: string) {
    this.ensureDbConnected();
    const cleanId = orderId.trim().replace(/^#/, '');

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { id: cleanId }, { orderNumber: cleanId }] },
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    if (actorRole === Role.DRIVER) {
      const driver = actorId
        ? await this.prisma.driverProfile.findFirst({ where: { userId: actorId } })
        : null;
      const ownsOrder =
        order.driverId === actorId || (driver && order.driverProfileId === driver.id);
      if (!ownsOrder) {
        throw new ForbiddenException('Order is not assigned to your driver account');
      }
    }

    if (order.paymentMethod !== 'COD') {
      throw new BadRequestException('Order payment method is not COD');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'COMPLETED' },
      });

      const codPayId = `cod_${order.id}`;
      const existing = await tx.paymentTransaction.findFirst({
        where: { paymentId: codPayId, transactionType: 'CAPTURE' },
      });

      if (!existing) {
        await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            checkoutGroupId: order.checkoutGroupId,
            paymentId: codPayId,
            amount: order.grandTotal,
            currency: 'INR',
            status: 'COMPLETED',
            method: 'COD',
            transactionType: 'CAPTURE',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId || null,
          userRole: actorRole || Role.DRIVER,
          action: 'COD_PAYMENT_CONFIRMED',
          entityType: 'Order',
          entityId: order.id,
          details: JSON.stringify({ amount: order.grandTotal }),
        },
      });
    });

    return {
      success: true,
      orderId: order.id,
      paymentMethod: 'COD',
      paymentStatus: 'COMPLETED',
    };
  }
}
