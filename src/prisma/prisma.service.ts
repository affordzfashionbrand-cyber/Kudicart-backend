import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  INITIAL_DARK_STORES,
  INITIAL_DRIVERS,
  INITIAL_SHIFTS,
  INITIAL_SLOTS,
  INITIAL_SURGES,
  INITIAL_NOTIFICATIONS,
} from './initial-data';
import { INITIAL_EARNINGS_WEEKS } from './initial-earnings';
import { INITIAL_CATEGORIES_HIERARCHY } from './initial-categories';
import {
  INITIAL_ADMIN_USERS,
  INITIAL_ADMIN_ROLES,
  INITIAL_ROLE_PERMISSIONS,
  INITIAL_ADMIN_VENDORS,
  INITIAL_ADMIN_DRIVERS,
  INITIAL_ADMIN_CUSTOMERS,
  INITIAL_AUDIT_EVENTS,
  INITIAL_VENDOR_LEDGER,
  INITIAL_ADMIN_PAYMENTS,
  INITIAL_ADMIN_REVIEWS,
  INITIAL_SUPPORT_TICKETS,
  INITIAL_OPERATIONAL_NOTIFICATIONS,
  DEFAULT_WORKSPACE_PREFERENCES,
} from './initial-admin-data';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public isConnectedToDb = false;

  // Authoritative in-memory data store with enterprise multi-actor state
  private store = {
    users: [
      {
        id: 'usr-1',
        firebaseUid: 'fb-user-123',
        phone: '+91 98450 12890',
        email: 's.vishwa8999@gmail.com',
        name: 'Ananya Sharma',
        avatar:
          'https://lh3.googleusercontent.com/aida/AEtjO1VWtKT1o8SeNnSo4l3FyyDwDHs_2VrqMmxcyY66IrRg9rL8LkbbnuL2TffL_CyEaqzkwfMMb8tXKb4wQTNtgTrqXO9l2Yi8Pq4du2CXnP7lmY5vWpGHBTWfweA4JAHjIOXuFa59STYjuuXipREO_RT3mGzoprfKCWe-WrMubapxuDZ2B7UA-MwnQfHcf1AtMn-UkuyrLssuYf_YUriU8q2jFN8qIrperLt43xS0h1vE3Hgb0dCyrts8bMA',
        role: 'CUSTOMER',
        createdAt: new Date('2026-01-15T09:00:00Z').toISOString(),
      },
      {
        id: 'usr-driver-1',
        firebaseUid: 'fb-driver-123',
        phone: '+91 98765 43210',
        email: 'rajesh.driver@kudicart.in',
        name: 'Rajesh Kumar',
        avatar:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuB-9n0OJClXNM6d0TX37sDPYy2u14Q2urWrIDrGrcsqp-xeOqvJWO4kLCkJM2p4l8e4m4L2wDCHqTawwJ4RiTjZPrGzg0jToIbTJpMggV8VY-XM8NL1FIq9KmGLwPNEJ_9rmCB4K-W2qmOS5AXnWOrQVPZSlvSNve7Z3L9QAVxRKy5jXEY_LUYbxNPc7m3PZ877qBOS_WWQ8dabL-BBYfbKqFLHaaegb80kVZpY-Z_FPvHZPdgyE2SFDA',
        role: 'DRIVER',
        createdAt: new Date('2026-01-10T08:00:00Z').toISOString(),
      },
      {
        id: 'usr-vendor-1',
        firebaseUid: 'fb-vendor-123',
        phone: '+91 80 4123 9988',
        email: 'vendor.avanya@kudicart.in',
        name: 'Meera Deshmukh',
        avatar: null,
        role: 'VENDOR',
        createdAt: new Date('2026-01-01T08:00:00Z').toISOString(),
      },
      {
        id: 'usr-admin-1',
        firebaseUid: 'fb-admin-123',
        phone: '+91 99999 00000',
        email: 'admin@kudicart.in',
        name: 'Operations Admin',
        avatar: null,
        role: 'ADMIN',
        createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      },
    ],
    drivers: JSON.parse(JSON.stringify(INITIAL_DRIVERS)),
    shifts: JSON.parse(JSON.stringify(INITIAL_SHIFTS)),
    slots: JSON.parse(JSON.stringify(INITIAL_SLOTS)),
    earningsWeeks: JSON.parse(JSON.stringify(INITIAL_EARNINGS_WEEKS)),
    surges: JSON.parse(JSON.stringify(INITIAL_SURGES)),
    notifications: JSON.parse(JSON.stringify(INITIAL_NOTIFICATIONS)),
    tryAndBuySessions: [] as any[],
    darkStores: JSON.parse(JSON.stringify(INITIAL_DARK_STORES)),
    vendors: [
      {
        id: 'vend-affordz-official',
        userId: 'usr-admin-1',
        storeName: 'Affordz Official Store',
        address: 'Central Distribution Pod, Indiranagar, Bengaluru, Karnataka 560038',
        phone: '+91 99999 00000',
        contactPerson: 'Affordz Operations Admin',
      },
      {
        id: 'vend-1',
        userId: 'usr-vendor-1',
        storeName: 'Avanya Ethnic Boutique',
        address: 'Shop 14, 100ft Road, Indiranagar, Bengaluru, Karnataka 560038',
        phone: '+91 80 4123 9988',
        contactPerson: 'Meera Deshmukh',
      },
      {
        id: 'vend-2',
        userId: 'usr-vendor-2',
        storeName: 'Gulabi Studio',
        address: '42 Commercial Street, Tasker Town, Bengaluru, Karnataka 560001',
        phone: '+91 80 2558 7711',
        contactPerson: 'Rohan Verma',
      },
    ],
    coupons: [
      {
        id: 'cpn-1',
        code: 'AFFORDZ10',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minOrderValue: 999,
        maxDiscount: 300,
        usageLimit: 1000,
        usedCount: 14,
        startDate: new Date('2026-01-01').toISOString(),
        endDate: new Date('2026-12-31').toISOString(),
        isActive: true,
      },
      {
        id: 'cpn-2',
        code: 'FIRSTDROP',
        discountType: 'FLAT',
        discountValue: 200,
        minOrderValue: 799,
        maxDiscount: 200,
        usageLimit: 500,
        usedCount: 28,
        startDate: new Date('2026-01-01').toISOString(),
        endDate: new Date('2026-12-31').toISOString(),
        isActive: true,
      },
    ],
    categories: JSON.parse(JSON.stringify(INITIAL_CATEGORIES_HIERARCHY)),
    products: [
      {
        id: 'prod-1',
        vendorId: 'vend-1',
        categoryId: 'kurtis',
        brand: 'Avanya Ethnic',
        title: 'Embroidered Anarkali Kurta Set',
        description:
          'Pure Mulmul Silk with Chiffon Dupatta. Features intricate golden zari work along the neckline and cuffs with flowy flair.',
        price: 1299,
        originalPrice: 2499,
        discount: '48% OFF',
        rating: 4.8,
        reviewsCount: 89,
        stockQuantity: 10,
        stockBadge: '18m Delivery',
        readyToShip: true,
        category: 'Kurtis',
        gender: 'Women',
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        fabric: 'Pure Mulmul Silk',
        origin: 'Jaipur, Rajasthan',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-indiranagar',
        tryAndBuyEligible: false,
        tags: ['kurta', 'anarkali', 'mulmul', 'silk', 'zari', 'ethnic', 'festive', 'women'],
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
        altText:
          'Editorial studio photo of a female model wearing an opulent deep berry-red Anarkali kurta set with golden zari embroidery.',
        galleryImages: [
          'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1610030469668-93510cb67655?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-2',
        vendorId: 'vend-1',
        categoryId: 'sarees',
        brand: 'Varanasi Looms',
        title: 'Handloom Cotton Saree with Zari',
        description:
          'Includes unstitched blouse piece. Woven in soft ivory and rose-berry hues with broad golden zari border.',
        price: 1849,
        originalPrice: 3190,
        discount: '42% OFF',
        rating: 4.9,
        reviewsCount: 142,
        stockQuantity: 15,
        stockBadge: 'Boutique Artisan',
        readyToShip: true,
        category: 'Sarees',
        gender: 'Women',
        sizes: ['Free Size (5.5m + 0.8m)'],
        fabric: 'Fine Cotton Silk',
        origin: 'Varanasi, UP',
        fulfillmentType: 'VENDOR',
        darkStoreHubId: null,
        tryAndBuyEligible: false,
        tags: ['saree', 'cotton', 'silk', 'handloom', 'zari', 'varanasi', 'traditional', 'women'],
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBZmXmAng2VIvmt-e5UoQ1MrsXUMl1p1ftqAD3jjKM_YhlObUmOfd_rwaYD9cuGHuKnJVJBq6kagdOAfjiCSzvvDeVpdrAoGZBOD7YgEfEhdUx85DVetiWSmEdkgQISuSVzZXuSiadjUZUFFvsv0XIZp7_tRq9rvE-Exol7J2LYupakSoB-rwJjs7Y3evVbNoXHjav-QXpye1FUGXeKzjdjw_34arHkcmA3NY6gd6xMd-6DRSq6M5oNfw',
        altText:
          'Elegant studio showcase of handloom cotton saree in ivory and rose-berry hues with golden zari border.',
        galleryImages: [
          'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1610030469668-93510cb67655?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1609357605129-26f69add5d6e?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-3',
        vendorId: 'vend-2',
        categoryId: 'dresses',
        brand: 'Gulabi Studio',
        title: 'Tiered Floral Rayon Maxi Dress',
        description:
          'Breathable weave with waist tie-up. Hand-printed floral motifs in blush pink, rose berry, and peach tones.',
        price: 999,
        originalPrice: 1999,
        discount: '50% OFF',
        rating: 4.7,
        reviewsCount: 76,
        stockQuantity: 8,
        stockBadge: '20m Delivery',
        readyToShip: true,
        category: 'Dresses',
        gender: 'Women',
        sizes: ['S', 'M', 'L', 'XL'],
        fabric: 'Premium Rayon Weave',
        origin: 'Sanganer, Jaipur',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-koramangala',
        tryAndBuyEligible: false,
        tags: ['dress', 'maxi', 'floral', 'summer', 'rayon', 'gulabi', 'women'],
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuChjjRPXtK6wGlAzoX8MBkuhS5YQslHvyJa70gSCTmiApO-Lv00JijbP2efRpHEXOYf7Sb03MXrwmH90rYSHdWR_oiv_PNVMCQPGogU99bT_moi70avCMo2utLRF3l_PH6o7WaUE_ndCaN1oW4g9nWiFuH3yLqZDFknFOazu7KzBYjldvcFKSVuQDqubPby_0bCn0qmp1p5scLFl83Y1KDLoHjsLtaL4FCmrZV4k7E3Zx-u5XYrt3g3KQ',
        altText:
          'Flowing tiered maxi dress with delicate floral motifs in blush pink and rose berry tones.',
        galleryImages: [
          'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-4',
        vendorId: 'vend-1',
        categoryId: 'kurtis',
        brand: 'Avanya DarkStore Curated',
        title: 'Chanderi Silk Festive Kurti',
        description:
          '18-Minute Try & Buy Dark Store Express. Pure Chanderi woven with gota patti detailing.',
        price: 1599,
        originalPrice: 2899,
        discount: '45% OFF',
        rating: 4.9,
        reviewsCount: 112,
        stockQuantity: 12,
        stockBadge: '18m Delivery',
        readyToShip: true,
        category: 'Kurtis',
        gender: 'Women',
        sizes: ['S', 'M', 'L', 'XL'],
        fabric: 'Chanderi Silk',
        origin: 'Madhya Pradesh',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-indiranagar',
        tryAndBuyEligible: false,
        tags: ['kurti', 'chanderi', 'silk', 'festive', 'gota patti', 'ethnic', 'women'],
        image:
          'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80',
        altText: 'Chanderi Silk Festive Kurti',
        galleryImages: [
          'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1610030469668-93510cb67655?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-5',
        vendorId: 'vend-2',
        categoryId: 'tops',
        brand: 'Studio 04',
        title: 'Structured Linen Cotton Shirt',
        description:
          'Crisp tailored fit crafted from breathable French linen blend with mother-of-pearl buttons.',
        price: 2190,
        originalPrice: 3990,
        discount: '45% OFF',
        rating: 4.7,
        reviewsCount: 64,
        stockQuantity: 14,
        stockBadge: '18m Delivery',
        readyToShip: true,
        category: 'Tops',
        gender: 'Men',
        sizes: ['M', 'L', 'XL'],
        fabric: 'French Linen Blend',
        origin: 'Coimbatore, TN',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-indiranagar',
        tryAndBuyEligible: false,
        tags: ['shirt', 'linen', 'cotton', 'structured', 'casual', 'men', 'tops'],
        image:
          'https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=800&q=85',
        altText: 'Structured Linen Cotton Shirt',
        galleryImages: [
          'https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1620012253295-c15c429f66bf?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-6',
        vendorId: 'vend-1',
        categoryId: 'bottoms',
        brand: 'Aurel',
        title: 'Wide Leg Tailored Trousers',
        description:
          'Fluid drape high-waist silhouette cut from tropical wool blend. Concealed side zip.',
        price: 2990,
        originalPrice: 5490,
        discount: '45% OFF',
        rating: 4.8,
        reviewsCount: 52,
        stockQuantity: 9,
        stockBadge: '18m Delivery',
        readyToShip: true,
        category: 'Bottoms',
        gender: 'Women',
        sizes: ['S', 'M', 'L'],
        fabric: 'Tropical Wool Blend',
        origin: 'Bengaluru, KA',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-koramangala',
        tryAndBuyEligible: false,
        tags: ['trousers', 'pants', 'wide leg', 'tailored', 'bottoms', 'women'],
        image:
          'https://images.unsplash.com/photo-1506629905607-d9e08e2d3e8e?auto=format&fit=crop&w=800&q=85',
        altText: 'Wide Leg Tailored Trousers',
        galleryImages: [
          'https://images.unsplash.com/photo-1506629905607-d9e08e2d3e8e?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-7',
        vendorId: 'vend-2',
        categoryId: 'bottoms',
        brand: 'Novalis',
        title: 'Raw Selvedge Denim Jeans',
        description:
          'Japanese shuttle-loom selvedge denim in deep indigo. Custom copper rivets and button fly.',
        price: 3690,
        originalPrice: 5890,
        discount: '37% OFF',
        rating: 4.9,
        reviewsCount: 88,
        stockQuantity: 11,
        stockBadge: 'Boutique Artisan',
        readyToShip: true,
        category: 'Bottoms',
        gender: 'Men',
        sizes: ['30', '32', '34', '36'],
        fabric: '13.5oz Selvedge Denim',
        origin: 'Okayama & Mumbai',
        fulfillmentType: 'VENDOR',
        darkStoreHubId: null,
        tryAndBuyEligible: false,
        tags: ['denim', 'jeans', 'selvedge', 'raw', 'indigo', 'bottoms', 'men'],
        image:
          'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=85',
        altText: 'Raw Selvedge Denim Jeans',
        galleryImages: [
          'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1555689502-c4b22d76c56f?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1506629905607-d9e08e2d3e8e?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-8',
        vendorId: 'vend-1',
        categoryId: 'footwear',
        brand: 'Studio 04',
        title: 'Court Minimal Leather Sneaker',
        description:
          'Full-grain Italian calfskin with cushioned ortholite footbed and natural rubber sole.',
        price: 4990,
        originalPrice: 7990,
        discount: '38% OFF',
        rating: 4.8,
        reviewsCount: 94,
        stockQuantity: 7,
        stockBadge: '18m Delivery',
        readyToShip: true,
        category: 'Footwear',
        gender: 'Men',
        sizes: ['UK 7', 'UK 8', 'UK 9', 'UK 10'],
        fabric: 'Italian Calfskin Leather',
        origin: 'Agra Atelier',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-indiranagar',
        tryAndBuyEligible: false,
        tags: ['sneakers', 'shoes', 'footwear', 'leather', 'court', 'men'],
        image:
          'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=85',
        altText: 'Court Minimal Leather Sneaker',
        galleryImages: [
          'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-9',
        vendorId: 'vend-1',
        categoryId: 'accessories',
        brand: 'Forme',
        title: 'Minimal Leather Everyday Tote',
        description:
          'Hand-stitched vegetable-tanned leather tote with brass hardware and detachable pouch.',
        price: 5490,
        originalPrice: 8990,
        discount: '39% OFF',
        rating: 4.9,
        reviewsCount: 110,
        stockQuantity: 6,
        stockBadge: 'Boutique Artisan',
        readyToShip: true,
        category: 'Accessories',
        gender: 'Women',
        sizes: ['Standard'],
        fabric: 'Vegetable-Tanned Leather',
        origin: 'Puducherry Atelier',
        fulfillmentType: 'VENDOR',
        darkStoreHubId: null,
        tryAndBuyEligible: false,
        tags: ['tote', 'bag', 'leather', 'handbag', 'accessories', 'women'],
        image:
          'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=85',
        altText: 'Minimal Leather Everyday Tote',
        galleryImages: [
          'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1566150905458-1bf1fc113f0d?auto=format&fit=crop&w=1200&q=90',
        ],
      },
      {
        id: 'prod-10',
        vendorId: 'vend-2',
        categoryId: 'kurtis',
        brand: 'Royal',
        title: 'Men Raw Silk Kurta Set',
        description:
          'Classic bandhgala collar in pure raw silk with churidar pyjama. Subtle self-textured sheen.',
        price: 3490,
        originalPrice: 5990,
        discount: '42% OFF',
        rating: 4.8,
        reviewsCount: 45,
        stockQuantity: 8,
        stockBadge: '18m Delivery',
        readyToShip: true,
        category: 'Kurtis',
        gender: 'Men',
        sizes: ['38', '40', '42', '44'],
        fabric: 'Pure Raw Silk',
        origin: 'Varanasi, UP',
        fulfillmentType: 'DARK_STORE',
        darkStoreHubId: 'hub-koramangala',
        tryAndBuyEligible: false,
        tags: ['kurta', 'raw silk', 'ethnic', 'men', 'festive', 'kurtis'],
        image:
          'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=85',
        altText: 'Men Raw Silk Kurta Set',
        galleryImages: [
          'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1610652492500-ded49ceeb378?auto=format&fit=crop&w=1200&q=90',
          'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1200&q=90',
        ],
      },
    ],
    addresses: [
      {
        id: 'addr-1',
        userId: 'usr-1',
        label: 'Home Sanctuary',
        line1: 'Apt 4B, Sunrise Heights, 42 Westend Boulevard',
        locality: 'Indiranagar',
        city: 'Bengaluru',
        pincode: '560038',
        isDefault: true,
      },
      {
        id: 'addr-2',
        userId: 'usr-1',
        label: 'Work Office',
        line1: '9th Floor, Tech Hub Tower 2, Embassy Golf Links',
        locality: 'Domlur',
        city: 'Bengaluru',
        pincode: '560071',
        isDefault: false,
      },
    ],
    cartItems: [
      {
        id: 'cart-1',
        userId: 'usr-1',
        productId: 'prod-1',
        size: 'Size M',
        trialSize: 'Size L' as string | undefined,
        quantity: 1,
      },
    ],
    orders: [
      {
        id: 'ord-89241',
        orderNumber: 'KC-89241',
        customerId: 'usr-1',
        driverId: 'drv-1',
        addressId: 'addr-1',
        vendorId: 'vend-1',
        status: 'OUT_FOR_DELIVERY',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'COMPLETED',
        razorpayOrderId: 'rzp_order_demo892',
        razorpayPaymentId: 'pay_demo89241',
        itemTotal: 1299,
        deliveryFee: 40,
        taxes: 65,
        grandTotal: 1404,
        etaMinutes: 12,
        isTryAndBuy: true,
        couponCode: 'AFFORDZ10',
        discountAmount: 129.9,
        createdAt: new Date('2026-09-24T14:15:00Z').toISOString(),
        updatedAt: new Date('2026-09-24T14:55:00Z').toISOString(),
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            title: 'Embroidered Anarkali Kurta Set',
            brand: 'Avanya Ethnic',
            size: 'Size M',
            trialSize: 'Size L',
            price: 1299,
            quantity: 1,
            decision: 'KEEP',
            collected: true,
            image:
              'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
          },
        ],
        history: [
          { status: 'PLACED', time: '2:15 PM', note: 'Order placed by customer', actor: 'CUSTOMER' },
          { status: 'ACCEPTED', time: '2:17 PM', note: 'Vendor accepted order', actor: 'VENDOR' },
          { status: 'PREPARING', time: '2:25 PM', note: 'Quality check & gift packaging', actor: 'VENDOR' },
          { status: 'READY_FOR_PICKUP', time: '2:40 PM', note: 'Ready at store counter', actor: 'VENDOR' },
          { status: 'ASSIGNED', time: '2:42 PM', note: 'Admin assigned rider Rahul Sharma', actor: 'ADMIN' },
          { status: 'PICKED_UP', time: '2:50 PM', note: 'Picked up from vendor', actor: 'DRIVER' },
          { status: 'OUT_FOR_DELIVERY', time: '2:55 PM', note: 'Out for express delivery', actor: 'DRIVER' },
        ],
      },
    ],
    reviews: [
      {
        id: 'rev-1',
        userId: 'usr-1',
        productId: 'prod-1',
        orderId: 'ord-89241',
        rating: 5,
        comment: 'Exceptional craftsmanship and the Mulmul silk fabric feels incredibly luxurious! Fast delivery.',
        createdAt: new Date('2026-09-20T10:00:00Z').toISOString(),
      },
    ],
    tickets: [
      {
        id: 'tkt-1',
        userId: 'usr-1',
        orderId: 'ord-89241',
        title: 'Delivery instructions note',
        category: 'Delivery',
        description: 'Please ring the doorbell twice upon arrival at Sunrise Heights.',
        status: 'OPEN',
        createdAt: new Date('2026-09-24T14:30:00Z').toISOString(),
      },
    ],
    adminUsers: JSON.parse(JSON.stringify(INITIAL_ADMIN_USERS)),
    adminRoles: JSON.parse(JSON.stringify(INITIAL_ADMIN_ROLES)),
    rolePermissions: JSON.parse(JSON.stringify(INITIAL_ROLE_PERMISSIONS)),
    adminVendors: [
      {
        id: 'vend-affordz-official',
        vendorNumber: '#VEN-OFFICIAL',
        storeName: 'Affordz Official Store',
        legalEntityName: 'Affordz Quick-Commerce Official Pvt Ltd',
        ownerName: 'Affordz Operations Admin',
        ownerRole: 'Central Operations Platform',
        email: 'admin@affordz.in',
        phone: '+91 99999 00000',
        category: 'Official Dark Store Platform',
        operatingHub: 'Central Distribution Pod, Indiranagar',
        status: 'ACTIVE',
        isOfficialStore: true,
      },
      ...JSON.parse(JSON.stringify(INITIAL_ADMIN_VENDORS)),
    ],
    adminDrivers: JSON.parse(JSON.stringify(INITIAL_ADMIN_DRIVERS)),
    adminCustomers: JSON.parse(JSON.stringify(INITIAL_ADMIN_CUSTOMERS)),
    auditEvents: JSON.parse(JSON.stringify(INITIAL_AUDIT_EVENTS)),
    vendorLedger: JSON.parse(JSON.stringify(INITIAL_VENDOR_LEDGER)),
    adminPayments: JSON.parse(JSON.stringify(INITIAL_ADMIN_PAYMENTS)),
    adminReviews: JSON.parse(JSON.stringify(INITIAL_ADMIN_REVIEWS)),
    adminSupportTickets: JSON.parse(JSON.stringify(INITIAL_SUPPORT_TICKETS)),
    operationalNotifications: JSON.parse(JSON.stringify(INITIAL_OPERATIONAL_NOTIFICATIONS)),
    workspacePreferences: JSON.parse(JSON.stringify(DEFAULT_WORKSPACE_PREFERENCES)),
  };

  async onModuleInit() {
    if (process.env.DATABASE_URL && process.env.APP_ENV === 'production') {
      try {
        await this.$connect();
        this.isConnectedToDb = true;
        this.logger.log('PrismaService: Successfully connected to PostgreSQL database.');
      } catch (err: any) {
        this.logger.warn(
          `PrismaService: PostgreSQL connection failed (${err.message}). Operating with validated fallback store.`,
        );
      }
    } else {
      this.logger.log('PrismaService: Running in hybrid mode with authoritative in-memory store.');
    }
  }

  async onModuleDestroy() {
    if (this.isConnectedToDb) {
      await this.$disconnect();
    }
  }

  getStore() {
    this.store.products.forEach((p) => {
      p.tryAndBuyEligible = p.fulfillmentType === 'DARK_STORE';
    });
    return this.store;
  }

  recordAuditEvent(event: {
    actorId?: string;
    actorName?: string;
    actorRole?: string;
    actionType: string;
    entityId: string;
    entityName?: string;
    entityType: string;
    ipAddress?: string;
    userAgent?: string;
    summary: string;
    targetDescription?: string;
    changePayload?: Record<string, any>;
    entityLink?: string;
  }) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestampShort = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const timestampFull = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}, ${timestampShort} IST`;

    const actorName = event.actorName || 'Operations Admin';
    const initials = actorName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const auditEntry = {
      id: `AUD-${Date.now().toString().slice(-5)}`,
      timestamp: timestampShort,
      timestampFull,
      actorId: event.actorId || 'ADM-001',
      actorName,
      actorRole: event.actorRole || 'Central Ops Lead',
      actorInitials: initials,
      actionType: event.actionType,
      entityId: event.entityId,
      entityName: event.entityName || event.entityId,
      entityType: event.entityType,
      ipAddress: event.ipAddress || '127.0.0.1',
      gatewayVpn: 'MUM-VPN-NODE-01',
      userAgent: event.userAgent || 'KudiCart Admin Portal',
      sessionTokenHash: `sha256:${Date.now().toString(16)}`,
      summary: event.summary,
      targetDescription: event.targetDescription || `${event.entityType} ${event.entityId}`,
      changePayload: event.changePayload || {},
      entityLink: event.entityLink,
    };

    this.store.auditEvents.unshift(auditEntry);
    return auditEntry;
  }
}
