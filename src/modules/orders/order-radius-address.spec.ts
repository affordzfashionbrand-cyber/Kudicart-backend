import { BadRequestException } from '@nestjs/common';
import {
  MAX_DARK_STORE_RADIUS_KM,
  haversineDistanceKm,
} from './order-pricing.util';
import { OrdersService } from './orders.service';
import { AddressService } from '../address/address.service';
import { CatalogService } from '../catalog/catalog.service';

describe('Phase 2: 3 km Dark Store Radius & Address Receiver Details', () => {
  it('sets MAX_DARK_STORE_RADIUS_KM to 3.0 km and calculates Haversine distances accurately', () => {
    expect(MAX_DARK_STORE_RADIUS_KM).toBe(3.0);

    // Pozhichalur hub (12.9818, 80.1384) to nearby doorstep (~0.1 km)
    const nearKm = haversineDistanceKm(12.9818, 80.1384, 12.9825, 80.1390);
    expect(nearKm).toBeLessThanOrEqual(MAX_DARK_STORE_RADIUS_KM);

    // Pozhichalur hub to ~4.5 km away (previously allowed under 8 km, now rejected under 3 km)
    const farKm = haversineDistanceKm(12.9818, 80.1384, 13.0220, 80.1384);
    expect(farKm).toBeGreaterThan(MAX_DARK_STORE_RADIUS_KM);
    expect(farKm).toBeLessThan(8.0);
  });

  it('CatalogService.getDarkStores exposes maxRadiusKm = 3.0', async () => {
    const mockPrisma: any = {
      isConnectedToDb: true,
      darkStoreHub: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'hub-pozhichalur',
            name: 'Pozhichalur Express Hub',
            locality: 'Pozhichalur',
            address: 'Main Road',
            lat: 12.9818,
            lng: 80.1384,
            deliveryMinutes: 19,
            isActive: true,
          },
        ]),
      },
    };
    const catalog = new CatalogService(mockPrisma);
    const hubs = await catalog.getDarkStores();
    expect(hubs).toHaveLength(1);
    expect(hubs[0].maxRadiusKm).toBe(3.0);
  });

  it('AddressService persists recipientName and recipientPhone on create and update', async () => {
    const createdRecord = {
      id: 'addr-123',
      userId: 'usr-1',
      label: 'Home',
      recipientName: 'Priya Nair',
      recipientPhone: '+91 98765 11223',
      line1: 'Flat 4B, Lake View',
      line2: null,
      locality: 'Pozhichalur',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600074',
      latitude: 12.982,
      longitude: 80.139,
      isDefault: true,
    };

    const tx: any = {
      address: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue(createdRecord),
        update: jest.fn().mockResolvedValue({
          ...createdRecord,
          recipientName: 'Kiran Nair',
        }),
      },
    };
    const mockPrisma: any = {
      isConnectedToDb: true,
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'usr-1' }),
      },
      address: {
        findFirst: jest.fn().mockResolvedValue(createdRecord),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const mockUsers: any = {
      resolveCanonicalUser: jest.fn().mockResolvedValue({ id: 'usr-1' }),
    };

    const svc = new AddressService(mockPrisma, mockUsers);
    const created = await svc.addAddress('usr-1', {
      label: 'Home',
      recipientName: 'Priya Nair',
      recipientPhone: '+91 98765 11223',
      line1: 'Flat 4B, Lake View',
      locality: 'Pozhichalur',
      city: 'Chennai',
      pincode: '600074',
      latitude: 12.982,
      longitude: 80.139,
      isDefault: true,
    });

    expect(tx.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientName: 'Priya Nair',
          recipientPhone: '+91 98765 11223',
        }),
      }),
    );
    expect(created.recipientName).toBe('Priya Nair');
    expect(created.recipientPhone).toBe('+91 98765 11223');

    const updated = await svc.updateAddress('usr-1', 'addr-123', {
      recipientName: 'Kiran Nair',
    });
    expect(tx.address.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientName: 'Kiran Nair',
          recipientPhone: '+91 98765 11223',
        }),
      }),
    );
    expect(updated.recipientName).toBe('Kiran Nair');
  });

  it('OrdersService.checkout rejects DARK_STORE items when address is > 3.0 km from hub', async () => {
    const mockPrisma: any = {
      isConnectedToDb: true,
      address: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'addr-far',
          userId: 'usr-1',
          label: 'Home',
          recipientName: 'Aarav',
          recipientPhone: '+91 98765 43210',
          line1: 'Outer Road',
          locality: 'Adambakkam',
          city: 'Chennai',
          pincode: '600088',
          latitude: 13.0220, // ~4.47 km away from Pozhichalur hub
          longitude: 80.1384,
        }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prod-1',
            title: 'Silk Kurta',
            brand: 'Affordz',
            price: 1299,
            sizes: ['M'],
            image: 'https://example.com/1.jpg',
            stockQuantity: 10,
            vendorId: 'vend-affordz-official',
            categoryId: 'cat-1',
            fulfillmentType: 'DARK_STORE',
            tryAndBuyEligible: true,
            vendor: { userId: 'usr-vend', commissionRate: 12.5, categoryCommissions: [] },
            darkStoreHub: {
              id: 'hub-pozhichalur',
              name: 'Pozhichalur Express Hub',
              lat: 12.9818,
              lng: 80.1384,
              deliveryMinutes: 19,
            },
          },
        ]),
      },
    };

    const svc = new OrdersService(
      mockPrisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      svc.checkout('usr-1', {
        addressId: 'addr-far',
        paymentMethod: 'COD' as any,
        isBuyNow: true,
        buyNowItem: { productId: 'prod-1', size: 'M', quantity: 1 },
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      svc.checkout('usr-1', {
        addressId: 'addr-far',
        paymentMethod: 'COD' as any,
        isBuyNow: true,
        buyNowItem: { productId: 'prod-1', size: 'M', quantity: 1 },
      }),
    ).rejects.toThrow(/maximum 3 km/i);
  });
});
