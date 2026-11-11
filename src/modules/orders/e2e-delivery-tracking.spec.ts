import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FulfillmentType, PaymentMethod } from '@prisma/client';
import request = require('supertest');
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { AdminOrdersService } from '../admin/services/admin-orders.service';
import { DriverOrdersService } from '../driver/driver-orders.service';
import { DriverProfileService } from '../driver/driver-profile.service';
import { Role } from '../../common/enums/role.enum';
import { createJwtToken } from '../../common/utils/crypto.util';

describe('E2E Delivery & Tracking Workflow (Real HTTP + PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let adminOrdersService: AdminOrdersService;
  let driverOrdersService: DriverOrdersService;
  let driverProfileService: DriverProfileService;

  const runId = `e2et_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdProductIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdGroupIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get(PrismaService);
    ordersService = moduleRef.get(OrdersService);
    adminOrdersService = moduleRef.get(AdminOrdersService);
    driverOrdersService = moduleRef.get(DriverOrdersService);
    driverProfileService = moduleRef.get(DriverProfileService);
  });

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdOrderIds } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.paymentTransaction.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.orderStatusHistory.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [...createdOrderIds, ...createdGroupIds] } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
      createdOrderIds.length = 0;
    }
    if (createdGroupIds.length > 0) {
      await prisma.checkoutGroup.deleteMany({
        where: { id: { in: createdGroupIds } },
      });
      createdGroupIds.length = 0;
    }
    if (createdProductIds.length > 0) {
      await prisma.product.deleteMany({
        where: { id: { in: createdProductIds } },
      });
      createdProductIds.length = 0;
    }
    if (createdDriverProfileIds.length > 0) {
      await prisma.driverProfile.deleteMany({
        where: { id: { in: createdDriverProfileIds } },
      });
      createdDriverProfileIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await app?.close();
    await moduleRef?.close();
  });

  it('runs complete PLACED -> READY_FOR_PICKUP -> Manual ASSIGN -> GPS tracking -> arrivedAt -> DELIVERED lifecycle', async () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    const prodId = `${runId}_prd_${suffix}`;
    const drvUserId = `${runId}_du_${suffix}`;
    const drvProfId = `${runId}_dp_${suffix}`;

    createdProductIds.push(prodId);
    createdUserIds.push(drvUserId);
    createdDriverProfileIds.push(drvProfId);

    await prisma.product.create({
      data: {
        id: prodId,
        title: `Tracking Silk Dress ${suffix}`,
        brand: 'KudiCart Atelier',
        description: 'Temp product for delivery tracking e2e',
        vendorId: 'vend-1',
        categoryId: 'cat-1',
        price: 1600,
        originalPrice: 2000,
        discount: '20% OFF',
        sizes: ['M'],
        image: 'https://example.com/dress.jpg',
        altText: 'Silk Dress',
        galleryImages: [],
        stockQuantity: 5,
        fulfillmentType: FulfillmentType.DARK_STORE,
      },
    });

    await prisma.user.create({
      data: {
        id: drvUserId,
        firebaseUid: `fb_${drvUserId}`,
        name: `E2E Rider ${suffix}`,
        email: `${drvUserId}@test.kudicart.in`,
        phone: `+919855${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'DRIVER',
        status: 'ACTIVE',
      },
    });

    await prisma.driverProfile.create({
      data: {
        id: drvProfId,
        userId: drvUserId,
        fullName: `E2E Rider ${suffix}`,
        phone: `+919855${Math.floor(100000 + Math.random() * 899999)}`,
        kycStatus: 'APPROVED',
        isOnline: true,
        currentLat: 12.9352,
        currentLng: 77.6245,
      },
    });

    const checkoutRes = await ordersService.checkout('usr-1', {
      addressId: 'addr-1',
      paymentMethod: PaymentMethod.COD,
      isBuyNow: true,
      items: [{ productId: prodId, size: 'M', quantity: 1 }],
    } as any);

    expect(checkoutRes.orders).toHaveLength(1);
    const order = checkoutRes.orders[0];
    createdOrderIds.push(order.id);
    if (order.checkoutGroupId) {
      createdGroupIds.push(order.checkoutGroupId);
    }

    // Vendor prepares order
    await ordersService.vendorAccept(order.id, Role.VENDOR, 'usr-vendor-1');
    await ordersService.vendorPrepare(order.id, Role.VENDOR, 'usr-vendor-1');
    await ordersService.vendorReadyForPickup(order.id, Role.VENDOR, 'usr-vendor-1');

    // Manual admin driver assignment (D-006)
    const assigned = await adminOrdersService.assignDriver(
      order.id,
      { driverId: drvProfId },
      'usr-admin-1',
      'Amara',
    );
    expect(assigned.order.status).toBe('ASSIGNED');

    // Driver picks up & starts delivery
    await driverOrdersService.pickupOrder(drvProfId, order.id);
    await driverOrdersService.outForDelivery(drvProfId, order.id);

    await driverProfileService.updateLocation(drvProfId, {
      latitude: 12.95,
      longitude: 77.63,
      heading: 120,
      orderId: order.id,
    });

    const outsiderId = `${runId}_outsider_${suffix}`;
    createdUserIds.push(outsiderId);
    await prisma.user.create({
      data: {
        id: outsiderId,
        firebaseUid: `fb_${outsiderId}`,
        name: `Outsider Customer ${suffix}`,
        email: `${outsiderId}@test.kudicart.in`,
        phone: `+919854${Math.floor(100000 + Math.random() * 899999)}`,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    const customerToken = createJwtToken({ uid: 'usr-1', role: Role.CUSTOMER });
    const outsiderToken = createJwtToken({ uid: outsiderId, role: Role.CUSTOMER });

    await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}/track`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    const httpTrack = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}/track`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(httpTrack.body.trackingActive).toBe(true);
    expect(httpTrack.body.driverLocation).toMatchObject({ latitude: 12.95, longitude: 77.63 });

    await driverOrdersService.markArrived(drvProfId, order.id);
    const arrivedTracking = await ordersService.trackOrder(order.id, 'usr-1', Role.CUSTOMER);
    expect(arrivedTracking.status).toBe('OUT_FOR_DELIVERY');
    expect(arrivedTracking.isArrived).toBe(true);

    const delivered = await driverOrdersService.deliverOrder(drvProfId, order.id, {
      cashCollected: true,
    });
    expect(delivered.success).toBe(true);
    expect(delivered.order.status).toBe('DELIVERED');
    expect(delivered.order.paymentStatus).toBe('COMPLETED');
  });
});
