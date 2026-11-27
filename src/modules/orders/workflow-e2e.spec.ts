import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { VendorService } from '../vendor/vendor.service';
import { AdminOrdersService } from '../admin/services/admin-orders.service';
import { DriverOrdersService } from '../driver/driver-orders.service';
import { DeliveryAssignmentService } from './delivery-assignment.service';
import { createJwtToken } from '../../common/utils/crypto.util';
import { Role } from '../../common/enums/role.enum';
import { deriveCustomerOrderOtp } from './order-otp.util';

describe('Phase 12 End-to-End Workflows — Standard & Try & Buy + Auto Assignment', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let vendorService: VendorService;
  let adminOrdersService: AdminOrdersService;
  let driverOrdersService: DriverOrdersService;
  let deliveryAssignment: DeliveryAssignmentService;

  const runId = `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds: string[] = [];
  const createdVendorIds: string[] = [];
  const createdDriverIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdGroupIds: string[] = [];

  let adminUserId: string;
  let adminToken: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    prisma = moduleRef.get(PrismaService);
    ordersService = moduleRef.get(OrdersService);
    vendorService = moduleRef.get(VendorService);
    adminOrdersService = moduleRef.get(AdminOrdersService);
    driverOrdersService = moduleRef.get(DriverOrdersService);
    deliveryAssignment = moduleRef.get(DeliveryAssignmentService);

    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminUser) {
      throw new Error('Expected seeded ADMIN user');
    }
    adminUserId = adminUser.id;
    adminToken = createJwtToken({
      sub: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: Role.ADMIN,
    });
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdOrderIds } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: createdOrderIds } } });
      await prisma.dispatchAssignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.tryAndBuySession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdGroupIds.length > 0) {
      await prisma.checkoutGroup.deleteMany({ where: { id: { in: createdGroupIds } } });
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    if (createdAddressIds.length > 0) {
      await prisma.address.deleteMany({ where: { id: { in: createdAddressIds } } });
    }
    if (createdDriverIds.length > 0) {
      await prisma.driverProfile.deleteMany({ where: { id: { in: createdDriverIds } } });
    }
    if (createdVendorIds.length > 0) {
      await prisma.vendor.deleteMany({ where: { id: { in: createdVendorIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.idempotencyKey.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app?.close();
    await moduleRef?.close();
  });

  async function seedWorkflowActors(suffix: string, options?: { isTryAndBuy?: boolean; onlineDrivers?: number }) {
    const custUserId = `${runId}_cu_${suffix}`;
    const vendUserId = `${runId}_vu_${suffix}`;
    const vendId = `${runId}_vn_${suffix}`;
    const addrId = `${runId}_ad_${suffix}`;
    const prodId = `${runId}_pr_${suffix}`;
    createdUserIds.push(custUserId, vendUserId);
    createdVendorIds.push(vendId);
    createdAddressIds.push(addrId);
    createdProductIds.push(prodId);

    await prisma.user.createMany({
      data: [
        {
          id: custUserId,
          firebaseUid: `fb_${custUserId}`,
          name: `Customer ${suffix}`,
          email: `${custUserId}@kudicart.test`,
          phone: `+919801${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
        {
          id: vendUserId,
          firebaseUid: `fb_${vendUserId}`,
          name: `Vendor ${suffix}`,
          email: `${vendUserId}@kudicart.test`,
          phone: `+919802${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'VENDOR',
          status: 'ACTIVE',
        },
      ],
    });

    await prisma.vendor.create({
      data: {
        id: vendId,
        userId: vendUserId,
        storeName: `Boutique ${suffix}`,
        status: 'ACTIVE',
        isOnline: true,
        address: '100 Feet Road, Indiranagar',
      },
    });

    await prisma.address.create({
      data: {
        id: addrId,
        userId: custUserId,
        label: 'Home',
        recipientName: `Customer ${suffix}`,
        recipientPhone: '+919801123456',
        line1: '12 Main Indiranagar',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
        latitude: 12.9718,
        longitude: 77.6412,
      },
    });

    const cat = await prisma.category.findFirst({ select: { id: true } });
    await prisma.product.create({
      data: {
        id: prodId,
        vendorId: vendId,
        categoryId: cat!.id,
        brand: 'KudiCart Studio',
        title: `Test Jacket ${suffix}`,
        description: 'Workflow verification item',
        price: 1500,
        originalPrice: 1999,
        discount: '25% OFF',
        sizes: ['M', 'L'],
        image: 'https://example.com/jacket.jpg',
        altText: 'Test Jacket',
        galleryImages: [],
        stockQuantity: 10,
        fulfillmentType: options?.isTryAndBuy ? 'DARK_STORE' : 'VENDOR',
        tryAndBuyEligible: Boolean(options?.isTryAndBuy),
      },
    });

    const drivers: Array<{ userId: string; profileId: string; token: string }> = [];
    const driverCount = options?.onlineDrivers ?? 1;
    for (let i = 0; i < driverCount; i++) {
      const drvUserId = `${runId}_du_${suffix}_${i}`;
      const drvProfId = `${runId}_dp_${suffix}_${i}`;
      createdUserIds.push(drvUserId);
      createdDriverIds.push(drvProfId);
      await prisma.user.create({
        data: {
          id: drvUserId,
          firebaseUid: `fb_${drvUserId}`,
          name: `Rider ${suffix}-${i}`,
          email: `${drvUserId}@kudicart.test`,
          phone: `+919803${Math.floor(100000 + Math.random() * 899999)}`,
          role: 'DRIVER',
          status: 'ACTIVE',
        },
      });
      await prisma.driverProfile.create({
        data: {
          id: drvProfId,
          userId: drvUserId,
          fullName: `Rider ${suffix}-${i}`,
          phone: `+919803${Math.floor(100000 + Math.random() * 899999)}`,
          kycStatus: 'APPROVED',
          isOnline: true,
          availableSince: new Date(Date.now() - (driverCount - i) * 60_000),
        },
      });
      drivers.push({
        userId: drvUserId,
        profileId: drvProfId,
        token: createJwtToken({ sub: drvUserId, role: Role.DRIVER, driverId: drvProfId }),
      });
    }

    return {
      custUserId,
      custToken: createJwtToken({ sub: custUserId, role: Role.CUSTOMER }),
      vendUserId,
      vendId,
      vendToken: createJwtToken({ sub: vendUserId, role: Role.VENDOR, vendorId: vendId }),
      addrId,
      prodId,
      drivers,
    };
  }

  it('Standard Order End-to-End: Placed -> Vendor Accept triggers auto-assignment (customer still sees getting packed) -> Ready -> Pickup -> Out for Delivery -> Delivered', async () => {
    const suffix = `std_${Math.random().toString(36).slice(2, 6)}`;
    const ctx = await seedWorkflowActors(suffix, { isTryAndBuy: false, onlineDrivers: 1 });

    // 1. Place Standard Order
    const checkout = await ordersService.checkout(ctx.custUserId, {
      addressId: ctx.addrId,
      paymentMethod: 'COD',
      isTryAndBuy: false,
      isBuyNow: true,
      items: [{ productId: ctx.prodId, size: 'M', quantity: 1 }],
    } as any);
    const order = checkout.orders[0];
    createdOrderIds.push(order.id);
    if (order.checkoutGroupId) createdGroupIds.push(order.checkoutGroupId);

    expect(order.orderType).toBe('STANDARD');
    expect(order.status).toBe('PLACED');
    expect(order.deliveryAssignmentStatus).toBe('NOT_ASSIGNED');
    expect(order.driverProfileId).toBeNull();

    // Driver cannot pick up before order is ACCEPTED/READY_FOR_PICKUP
    await expect(
      driverOrdersService.pickupOrder(ctx.drivers[0].profileId, order.id),
    ).rejects.toThrow();

    // 2. Vendor Accepts -> Auto-assigns driver immediately while Order.status remains ACCEPTED & customer label says "Order is getting packed"
    const accepted = await vendorService.acceptOrder(ctx.vendUserId, Role.VENDOR, order.id);
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.deliveryAssignmentStatus).toBe('ASSIGNED');
    expect(accepted.driverProfileId).toBe(ctx.drivers[0].profileId);
    expect((accepted as any).customerStatusLabel).toBe('Order is getting packed');

    const trackAfterAccept = await ordersService.trackOrder(order.id, ctx.custUserId, Role.CUSTOMER);
    expect(trackAfterAccept.status).toBe('ACCEPTED');
    expect((trackAfterAccept as any).customerStatusLabel).toBe('Order is getting packed');
    expect(trackAfterAccept.trackingActive).toBe(false);

    // Duplicate accept rejected cleanly
    await expect(vendorService.acceptOrder(ctx.vendUserId, Role.VENDOR, order.id)).rejects.toThrow();

    // Pickup before READY_FOR_PICKUP must be rejected
    await expect(
      driverOrdersService.pickupOrder(ctx.drivers[0].profileId, order.id),
    ).rejects.toThrow();

    // Standard order cannot enter TRY_AND_BUY
    await expect(
      ordersService.updateStatus(order.id, 'TRY_AND_BUY', Role.ADMIN, 'Invalid jump', adminUserId),
    ).rejects.toThrow();

    // 3. Packing -> Ready for Pickup (still NOT Out for Delivery)
    const packed = await vendorService.prepareOrder(ctx.vendUserId, Role.VENDOR, order.id);
    expect(packed.status).toBe('PACKING');

    const ready = await vendorService.readyForPickup(ctx.vendUserId, Role.VENDOR, order.id);
    expect(ready.status).toBe('READY_FOR_PICKUP');
    expect(ready.deliveryAssignmentStatus).toBe('ASSIGNED');

    // Driver accepts assignment explicitly
    const drvAccept = await driverOrdersService.acceptOrder(ctx.drivers[0].profileId, order.id);
    expect(drvAccept.order.deliveryAssignmentStatus).toBe('ACCEPTED_BY_DELIVERY_PARTNER');
    expect(drvAccept.order.status).toBe('READY_FOR_PICKUP');

    // 4. Actual pickup confirmation transitions to OUT_FOR_DELIVERY
    const pickedUp = await driverOrdersService.pickupOrder(ctx.drivers[0].profileId, order.id, {
      verificationPhotos: ['https://example.com/pickup.jpg'],
    });
    expect(pickedUp.order.status).toBe('OUT_FOR_DELIVERY');
    expect(pickedUp.order.pickedUpAt).toBeTruthy();

    const trackAfterPickup = await ordersService.trackOrder(order.id, ctx.custUserId, Role.CUSTOMER);
    expect(trackAfterPickup.status).toBe('OUT_FOR_DELIVERY');
    expect((trackAfterPickup as any).customerStatusLabel).toBe('Out for delivery');
    expect(trackAfterPickup.trackingActive).toBe(true);

    // Standard order still blocked from Try & Buy even when OUT_FOR_DELIVERY
    await expect(
      ordersService.updateStatus(order.id, 'TRY_AND_BUY', Role.DRIVER, 'Invalid standard jump', ctx.drivers[0].userId),
    ).rejects.toThrow();

    // 5. Complete delivery -> DELIVERED
    const delivered = await driverOrdersService.deliverOrder(ctx.drivers[0].profileId, order.id, {
      deliveryImages: ['https://example.com/doorstep.jpg'],
      cashCollected: true,
    });
    expect(delivered.order.status).toBe('DELIVERED');
    expect(delivered.order.deliveryAssignmentStatus).toBe('COMPLETED');
    expect(delivered.order.paymentStatus).toBe('COMPLETED');
  });

  it('Try & Buy Reject/Return Workflow + Admin Acceptance + Driver Decline & Reassignment', async () => {
    const suffix = `tnb_${Math.random().toString(36).slice(2, 6)}`;
    const ctx = await seedWorkflowActors(suffix, { isTryAndBuy: true, onlineDrivers: 2 });

    // Place Try & Buy Order
    const checkout = await ordersService.checkout(ctx.custUserId, {
      addressId: ctx.addrId,
      paymentMethod: 'COD',
      isTryAndBuy: true,
      isBuyNow: true,
      items: [{ productId: ctx.prodId, size: 'M', quantity: 1 }],
    } as any);
    const order = checkout.orders[0];
    createdOrderIds.push(order.id);
    if (order.checkoutGroupId) createdGroupIds.push(order.checkoutGroupId);
    expect(order.orderType).toBe('TRY_AND_BUY');

    // Unauthorized vendor cannot accept another vendor's order
    const otherVendorRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${ctx.custToken}`);
    expect(otherVendorRes.status).toBe(403);

    // Admin accepts order -> auto-assigns Driver 0
    const admAccept = await adminOrdersService.acceptOrder(order.id, adminUserId, 'Operations Admin');
    expect(admAccept.order.status).toBe('ACCEPTED');
    expect(admAccept.order.deliveryAssignmentStatus).toBe('ASSIGNED');
    const firstDriverId = admAccept.order.driverProfileId!;

    // Driver 0 declines assignment -> automatically reassigns to Driver 1
    const declineRes = await driverOrdersService.rejectOrder(firstDriverId, order.id, 'Vehicle flat tire');
    expect(declineRes.success).toBe(true);
    expect(declineRes.reassigned).toBe(true);
    const refreshedAfterDecline = await adminOrdersService.getOrderById(order.id);
    expect(refreshedAfterDecline.driverProfileId).toBeTruthy();
    expect(refreshedAfterDecline.driverProfileId).not.toBe(firstDriverId);
    const secondDriverId = refreshedAfterDecline.driverProfileId!;

    // Admin marks PACKING -> READY_FOR_PICKUP
    await adminOrdersService.prepareOrder(order.id, adminUserId, 'Operations Admin');
    await adminOrdersService.readyForPickup(order.id, adminUserId, 'Operations Admin');

    // Driver 1 picks up -> OUT_FOR_DELIVERY
    const pickup = await driverOrdersService.pickupOrder(secondDriverId, order.id);
    expect(pickup.order.status).toBe('OUT_FOR_DELIVERY');

    // Try & Buy order cannot bypass directly to DELIVERED
    await expect(
      driverOrdersService.deliverOrder(secondDriverId, order.id, { cashCollected: true }),
    ).rejects.toThrow();

    // Driver arrives -> transitions OUT_FOR_DELIVERY -> TRY_AND_BUY
    const arrived = await driverOrdersService.markArrived(secondDriverId, order.id);
    expect(arrived.order.status).toBe('TRY_AND_BUY');

    const trackTnb = await ordersService.trackOrder(order.id, ctx.custUserId, Role.CUSTOMER);
    expect(trackTnb.status).toBe('TRY_AND_BUY');
    expect((trackTnb as any).customerStatusLabel).toBe('Try & Buy');

    // Handover OTP verified -> TRIAL_IN_PROGRESS
    const otp = deriveCustomerOrderOtp(order.id);
    await driverOrdersService.tryAndBuyHandover(secondDriverId, order.id, {
      otp,
      handoverImages: ['https://example.com/ho.jpg'],
    });

    // Customer explicitly rejects item
    const itemId = order.items[0].id;
    await ordersService.submitCustomerTryAndBuySelections(order.id, ctx.custUserId, Role.CUSTOMER, {
      [itemId]: 'RETURN',
    });

    // Driver collects return & settles -> RETURNING
    await driverOrdersService.tryAndBuyReturnCollection(secondDriverId, order.id, {
      collectedItemIds: [itemId],
      returnImages: ['https://example.com/ret.jpg'],
    });
    const settled = await driverOrdersService.tryAndBuySettlePayment(secondDriverId, order.id, {
      cashCollected: true,
    });
    expect(settled.orderStatus).toBe('RETURNING');

    // Admin/Vendor confirms store return reconciliation -> RETURNED & stock restored
    const stockBeforeReconcile = (await prisma.product.findUnique({ where: { id: ctx.prodId } }))!.stockQuantity;
    const reconciled = await adminOrdersService.reconcileReturn(
      order.id,
      adminUserId,
      'Operations Admin',
      'Garment returned intact',
    );
    expect(reconciled.order.status).toBe('RETURNED');
    expect(reconciled.order.deliveryAssignmentStatus).toBe('COMPLETED');
    const stockAfterReconcile = (await prisma.product.findUnique({ where: { id: ctx.prodId } }))!.stockQuantity;
    expect(stockAfterReconcile).toBe(stockBeforeReconcile + 1);
  });

  it('Assignment Failure & Recovery when all partners reject or no partner available', async () => {
    const suffix = `rec_${Math.random().toString(36).slice(2, 6)}`;
    const ctx = await seedWorkflowActors(suffix, { isTryAndBuy: false, onlineDrivers: 1 });

    // Place order, then take driver offline BEFORE accept so no partner is available
    const checkout = await ordersService.checkout(ctx.custUserId, {
      addressId: ctx.addrId,
      paymentMethod: 'COD',
      isTryAndBuy: false,
      isBuyNow: true,
      items: [{ productId: ctx.prodId, size: 'M', quantity: 1 }],
    } as any);
    const order = checkout.orders[0];
    createdOrderIds.push(order.id);
    if (order.checkoutGroupId) createdGroupIds.push(order.checkoutGroupId);

    const singleDriverId = ctx.drivers[0].profileId;
    await prisma.driverProfile.updateMany({
      where: { isOnline: true },
      data: { isOnline: false },
    });

    const acceptedNoDriver = await vendorService.acceptOrder(ctx.vendUserId, Role.VENDOR, order.id);
    expect(acceptedNoDriver.status).toBe('ACCEPTED');
    expect(acceptedNoDriver.deliveryAssignmentStatus).toBe('FAILED');
    expect(acceptedNoDriver.driverProfileId).toBeNull();

    // Bring our driver back online and retry pending assignments -> recovers cleanly
    await prisma.driverProfile.update({
      where: { id: singleDriverId },
      data: { isOnline: true, availableSince: new Date() },
    });

    const retriedCount = await deliveryAssignment.retryPendingAssignments(10);
    expect(retriedCount).toBeGreaterThanOrEqual(1);

    const recoveredOrder = await adminOrdersService.getOrderById(order.id);
    expect(recoveredOrder.deliveryAssignmentStatus).toBe('ASSIGNED');
    expect(recoveredOrder.driverProfileId).toBe(singleDriverId);
  });
});
