import {
  PrismaClient,
  Role,
  UserStatus,
  FulfillmentType,
  DiscountType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SupportTicketStatus,
} from '@prisma/client';
import {
  INITIAL_DARK_STORES,
  INITIAL_SHIFTS,
  INITIAL_SLOTS,
  INITIAL_SURGES,
} from '../src/prisma/initial-data';
import { INITIAL_CATEGORIES_HIERARCHY } from '../src/prisma/initial-categories';
import {
  INITIAL_ADMIN_USERS,
  INITIAL_ADMIN_ROLES,
  INITIAL_ROLE_PERMISSIONS,
  INITIAL_ADMIN_VENDORS,
  DEFAULT_WORKSPACE_PREFERENCES,
} from '../src/prisma/initial-admin-data';

const prisma = new PrismaClient();

function getWeekDatesMap(): { byIso: Record<string, string>; byShort: Record<string, string> } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const sunday = new Date(now);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(now.getDate() - day);

  const offsets: Array<{ oldIso: string; oldShort: string; offset: number }> = [
    { oldIso: '2026-10-11', oldShort: '11 Oct', offset: 0 },
    { oldIso: '2026-10-12', oldShort: '12 Oct', offset: 1 },
    { oldIso: '2026-10-13', oldShort: '13 Oct', offset: 2 },
    { oldIso: '2026-10-14', oldShort: '14 Oct', offset: 3 },
    { oldIso: '2026-10-15', oldShort: '15 Oct', offset: 4 },
    { oldIso: '2026-10-16', oldShort: '16 Oct', offset: 5 },
    { oldIso: '2026-10-17', oldShort: '17 Oct', offset: 6 },
  ];

  const byIso: Record<string, string> = {};
  const byShort: Record<string, string> = {};
  for (const item of offsets) {
    const target = new Date(sunday);
    target.setDate(sunday.getDate() + item.offset);
    byIso[item.oldIso] = target.toISOString().split('T')[0];
    byShort[item.oldShort] = target.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }
  return { byIso, byShort };
}

async function upsertUserSafely(input: {
  id: string;
  firebaseUid: string;
  phone: string | null;
  email: string | null;
  name: string;
  role: Role;
  status: UserStatus;
}) {
  const existingById = await prisma.user.findUnique({ where: { id: input.id } });
  if (existingById) {
    return existingById;
  }

  if (input.email) {
    const emailOwner = await prisma.user.findUnique({ where: { email: input.email } });
    if (emailOwner) {
      return emailOwner;
    }
  }
  if (input.phone) {
    const phoneOwner = await prisma.user.findUnique({ where: { phone: input.phone } });
    if (phoneOwner) {
      return phoneOwner;
    }
  }

  return prisma.user.create({
    data: input,
  });
}

async function main() {
  console.log('Seeding Affordz PostgreSQL database...');

  // 1. Core Actor Users
  await upsertUserSafely({
    id: 'usr-1',
    firebaseUid: 'fb-usr-1',
    phone: '+91 98450 12890',
    email: 'customer@affordz.in',
    name: 'Ananya Sharma',
    role: Role.CUSTOMER,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-2',
    firebaseUid: 'fb-usr-2',
    phone: '+91 98204 31920',
    email: 'priya.s@example.com',
    name: 'Priya Sharma',
    role: Role.CUSTOMER,
    status: UserStatus.ACTIVE,
  });

  await upsertUserSafely({
    id: 'usr-driver-1',
    firebaseUid: 'fb-driver-1',
    phone: '+91 98765 43210',
    email: 'rajesh.driver@affordz.in',
    name: 'Rajesh Kumar',
    role: Role.DRIVER,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-driver-104',
    firebaseUid: 'fb-driver-104',
    phone: '+91 98202 99310',
    email: 'deepak.s@affordz.in',
    name: 'Deepak Solanki',
    role: Role.DRIVER,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-driver-118',
    firebaseUid: 'fb-driver-118',
    phone: '+91 98201 55412',
    email: 'suraj.v@affordz.in',
    name: 'Suraj Verma',
    role: Role.DRIVER,
    status: UserStatus.ACTIVE,
  });

  await upsertUserSafely({
    id: 'usr-vendor-1',
    firebaseUid: 'fb-vendor-1',
    phone: '+91 80 4123 9988',
    email: 'vendor.avanya@affordz.in',
    name: 'Meera Deshmukh',
    role: Role.VENDOR,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-vendor-2',
    firebaseUid: 'fb-vendor-2',
    phone: '+91 98203 77192',
    email: 'rohan@gulabistudio.example',
    name: 'Rohan Mehta',
    role: Role.VENDOR,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-vendor-7821',
    firebaseUid: 'fb-vendor-7821',
    phone: '+91 98201 11204',
    email: 'tariq.mir@kashmirloom.example',
    name: 'Tariq Mir',
    role: Role.VENDOR,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-vendor-7814',
    firebaseUid: 'fb-vendor-7814',
    phone: '+91 98202 44912',
    email: 'devika@luxeheritage.example',
    name: 'Devika Menon',
    role: Role.VENDOR,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-vendor-7809',
    firebaseUid: 'fb-vendor-7809',
    phone: '+91 98203 77193',
    email: 'gulabi.vendor@affordz.in',
    name: 'Rohan Kapoor',
    role: Role.VENDOR,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-vendor-7792',
    firebaseUid: 'fb-vendor-7792',
    phone: '+91 98205 99318',
    email: 'zubair@induszari.example',
    name: 'Zubair Khan',
    role: Role.VENDOR,
    status: UserStatus.SUSPENDED,
  });

  await upsertUserSafely({
    id: 'usr-admin-1',
    firebaseUid: 'fb-admin-1',
    phone: '+91 99999 00000',
    email: 'admin@affordz.in',
    name: 'Operations Admin',
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-admin-amara',
    firebaseUid: 'fb-admin-amara',
    phone: '+91 99999 00001',
    email: 'amara@affordz.in',
    name: 'Amara Okonkwo',
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-admin-tunde',
    firebaseUid: 'fb-admin-tunde',
    phone: '+91 99999 00002',
    email: 'tunde@affordz.in',
    name: 'Tunde Bakare',
    role: Role.ADMIN,
    status: UserStatus.INACTIVE,
  });
  await upsertUserSafely({
    id: 'usr-admin-chioma',
    firebaseUid: 'fb-admin-chioma',
    phone: '+91 99999 00003',
    email: 'chioma@affordz.in',
    name: 'Chioma Eze',
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
  });

  // 2. Addresses for usr-1
  await prisma.address.upsert({
    where: { id: 'addr-1' },
    update: {
      label: 'Home Sanctuary',
      line1: 'Apt 4B, Sunrise Heights, 42 Westend Boulevard',
      locality: 'Indiranagar',
      city: 'Bengaluru',
      pincode: '560038',
      latitude: 12.9658,
      longitude: 77.6465,
      isDefault: true,
    },
    create: {
      id: 'addr-1',
      userId: 'usr-1',
      label: 'Home Sanctuary',
      recipientName: 'Ananya Sharma',
      recipientPhone: '+91 98450 12890',
      line1: 'Apt 4B, Sunrise Heights, 42 Westend Boulevard',
      locality: 'Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
      latitude: 12.9658,
      longitude: 77.6465,
      isDefault: true,
    },
  });
  await prisma.address.upsert({
    where: { id: 'addr-2' },
    update: {
      label: 'Work Office',
      line1: '9th Floor, Tech Hub Tower 2, Embassy Golf Links',
      locality: 'Domlur',
      city: 'Bengaluru',
      pincode: '560071',
      latitude: 12.96,
      longitude: 77.648,
      isDefault: false,
    },
    create: {
      id: 'addr-2',
      userId: 'usr-1',
      label: 'Work Office',
      line1: '9th Floor, Tech Hub Tower 2, Embassy Golf Links',
      locality: 'Domlur',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560071',
      latitude: 12.96,
      longitude: 77.648,
      isDefault: false,
    },
  });

  // 3. Dark Store Hubs
  const coreHubs = [
    {
      id: 'hub-1',
      name: 'Indiranagar Express Pod',
      locality: 'Indiranagar 100ft Road',
      address: 'Pod #4, Metro Pillar 128, 100ft Road, Indiranagar, Bengaluru, 560038',
      lat: 12.9716,
      lng: 77.6412,
      deliveryMinutes: 18,
      isActive: true,
    },
    {
      id: 'hub-2',
      name: 'Koramangala 4th Block Hub',
      locality: 'Koramangala 4th Block',
      address: 'Hub #2, 80ft Road, Sony Signal, Koramangala 4th Block, Bengaluru, 560034',
      lat: 12.9352,
      lng: 77.6245,
      deliveryMinutes: 20,
      isActive: true,
    },
    {
      id: 'hub-3',
      name: 'Whitefield Prestige Tech Pod',
      locality: 'Whitefield',
      address: 'Pod #7, ECC Road, Near ITPL, Whitefield, Bengaluru, 560066',
      lat: 12.9698,
      lng: 77.75,
      deliveryMinutes: 22,
      isActive: true,
    },
  ];
  for (const hub of [...coreHubs, ...INITIAL_DARK_STORES]) {
    await prisma.darkStoreHub.upsert({
      where: { id: hub.id },
      update: {
        name: hub.name,
        locality: hub.locality,
        address: hub.address,
        lat: hub.lat,
        lng: hub.lng,
        deliveryMinutes: hub.deliveryMinutes,
        isActive: hub.isActive,
      },
      create: hub,
    });
  }

  // 4. Vendors
  await prisma.vendor.upsert({
    where: { id: 'vend-affordz-official' },
    update: { storeName: 'Affordz Official Store', commissionRate: 12.5, status: 'ACTIVE' },
    create: {
      id: 'vend-affordz-official',
      userId: 'usr-admin-1',
      storeName: 'Affordz Official Store',
      commissionRate: 12.5,
      status: 'ACTIVE',
      address: 'Central Distribution Pod, Indiranagar, Bengaluru, Karnataka 560038',
      phone: '+91 99999 00000',
      contactPerson: 'Affordz Concierge',
      operatingHub: 'Indiranagar',
      category: 'Curated Official Store',
    },
  });
  await prisma.vendor.upsert({
    where: { id: 'vend-1' },
    update: { storeName: 'Avanya Ethnic Boutique', commissionRate: 15, status: 'ACTIVE' },
    create: {
      id: 'vend-1',
      userId: 'usr-vendor-1',
      storeName: 'Avanya Ethnic Boutique',
      commissionRate: 15,
      status: 'ACTIVE',
      address: '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
      phone: '+91 80 4123 9988',
      contactPerson: 'Meera Deshmukh',
      operatingHub: 'Indiranagar',
      category: 'Ethnic & Handloom',
    },
  });
  await prisma.vendor.upsert({
    where: { id: 'vend-2' },
    update: { storeName: 'Gulabi Studio', commissionRate: 15, status: 'ACTIVE' },
    create: {
      id: 'vend-2',
      userId: 'usr-vendor-2',
      storeName: 'Gulabi Studio',
      commissionRate: 15,
      status: 'ACTIVE',
      address: '14, Koramangala 4th Block, Bengaluru, Karnataka 560034',
      phone: '+91 98203 77192',
      contactPerson: 'Rohan Mehta',
      operatingHub: 'Koramangala',
      category: 'Contemporary Dresses',
    },
  });

  const adminVendorUserMap: Record<string, string> = {
    ven_7821: 'usr-vendor-7821',
    ven_7814: 'usr-vendor-7814',
    ven_7809: 'usr-vendor-7809',
    ven_7792: 'usr-vendor-7792',
  };
  for (const av of INITIAL_ADMIN_VENDORS) {
    const userId = adminVendorUserMap[av.id];
    if (!userId) continue;
    await prisma.vendor.upsert({
      where: { id: av.id },
      update: {
        storeName: av.storeName,
        commissionRate: 15,
        status: av.status,
        address: av.registeredAddress,
        phone: av.phone,
        contactPerson: av.ownerName,
        operatingHub: av.operatingHub,
        category: av.category,
      },
      create: {
        id: av.id,
        userId,
        storeName: av.storeName,
        commissionRate: 15,
        status: av.status,
        address: av.registeredAddress,
        phone: av.phone,
        contactPerson: av.ownerName,
        operatingHub: av.operatingHub,
        category: av.category,
      },
    });
  }

  // 5. Categories (legacy cat-1..cat-6 + full hierarchy)
  const coreCats = [
    { id: 'cat-1', name: 'Atelier Wear', slug: 'atelier-wear', level: 1, icon: 'Sparkles', countText: '148 designs' },
    { id: 'cat-2', name: 'Formal Studio', slug: 'formal-studio', level: 1, icon: 'Briefcase', countText: '86 tailored pieces' },
    { id: 'cat-3', name: 'Evening Gala', slug: 'evening-gala', level: 1, icon: 'Crown', countText: '62 gowns & kurtas' },
    { id: 'cat-4', name: 'Casual Luxe', slug: 'casual-luxe', level: 1, icon: 'Shirt', countText: '112 essentials' },
    { id: 'cat-5', name: 'Vault Accessories', slug: 'vault-accessories', level: 1, icon: 'Gem', countText: '44 statement accents' },
    { id: 'cat-6', name: 'Footwear', slug: 'footwear-studio', level: 1, icon: 'Footprints', countText: '58 handcrafted pairs' },
  ];
  for (const cat of coreCats) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: cat.name, icon: cat.icon, countText: cat.countText, level: cat.level, isActive: true },
      create: cat,
    });
  }

  const orderedHierarchy = [...INITIAL_CATEGORIES_HIERARCHY].sort((a, b) => a.level - b.level);
  for (const cat of orderedHierarchy) {
    const anyCat = cat as any;
    await prisma.category.upsert({
      where: { id: cat.id },
      update: {
        code: anyCat.code ?? null,
        name: cat.name,
        slug: cat.slug,
        description: anyCat.description ?? null,
        level: cat.level,
        parentId: cat.parentId,
        countText: cat.countText,
        icon: cat.icon,
        image: cat.image,
        banner: cat.banner,
        gender: cat.gender,
        displayOrder: cat.displayOrder,
        isActive: cat.isActive,
        isPopular: cat.isPopular,
      },
      create: {
        id: cat.id,
        code: anyCat.code ?? null,
        name: cat.name,
        slug: cat.slug,
        description: anyCat.description ?? null,
        level: cat.level,
        parentId: cat.parentId,
        countText: cat.countText,
        icon: cat.icon,
        image: cat.image,
        banner: cat.banner,
        gender: cat.gender,
        displayOrder: cat.displayOrder,
        isActive: cat.isActive,
        isPopular: cat.isPopular,
      },
    });
  }

  // 6. Products (prd-1..4 + prod-1..10)
  const productsToSeed = [
    {
      id: 'prd-1',
      sku: 'AF-PRD-001',
      vendorId: 'vend-1',
      categoryId: 'cat-1',
      brand: 'Avanya Atelier',
      title: 'Handloom Mulberry Silk Wrap Dress',
      description:
        'Pure Mulberry silk dyed with non-toxic botanical indigo. Features relaxed silhouette with wrap closure and mother-of-pearl buttons.',
      price: 3499,
      originalPrice: 4999,
      discount: '30% OFF',
      rating: 4.8,
      reviewsCount: 38,
      stockQuantity: 12,
      stockBadge: 'DARK STORE STOCK',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['silk', 'wrap dress', 'mulberry', 'women'],
      readyToShip: true,
      sizes: ['XS', 'S', 'M', 'L'],
      fabric: '100% Pure Mulberry Silk',
      origin: 'Bengaluru Atelier, India',
      image: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80',
      altText: 'Mulberry silk wrap dress in indigo hue',
      galleryImages: [
        'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-1',
      tryAndBuyEligible: true,
    },
    {
      id: 'prd-2',
      sku: 'AF-PRD-002',
      vendorId: 'vend-1',
      categoryId: 'cat-1',
      brand: 'Avanya Atelier',
      title: 'Khadi Organic Cotton Trench Jacket',
      description:
        'Handwoven zero-carbon khadi trench with structured raglan sleeves, storm flap, and horn buttons. Wind and shower resistant.',
      price: 4899,
      originalPrice: 6999,
      discount: '30% OFF',
      rating: 4.9,
      reviewsCount: 54,
      stockQuantity: 8,
      stockBadge: 'LOW STOCK',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['khadi', 'trench', 'jacket', 'outerwear'],
      readyToShip: true,
      sizes: ['S', 'M', 'L', 'XL'],
      fabric: '100% Hand-spun Khadi Cotton',
      origin: 'Varanasi Weaving Collective, India',
      image: 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80',
      altText: 'Organic khadi trench jacket on model',
      galleryImages: [
        'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=80',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-1',
      tryAndBuyEligible: true,
    },
    {
      id: 'prd-3',
      sku: 'AF-PRD-003',
      vendorId: 'vend-1',
      categoryId: 'cat-2',
      brand: 'Raw Stitch Studio',
      title: 'Charcoal Wool Flannel Tailored Trousers',
      description:
        'High-rise tapered trousers cut from Italian Super 110s wool flannel. Internal curtain waistband and horn side adjusters.',
      price: 2799,
      originalPrice: 3999,
      discount: '30% OFF',
      rating: 4.7,
      reviewsCount: 29,
      stockQuantity: 15,
      stockBadge: 'DARK STORE STOCK',
      listingStatus: 'ACTIVE',
      gender: 'Men',
      tags: ['trousers', 'wool', 'formal', 'tailored'],
      readyToShip: true,
      sizes: ['28', '30', '32', '34'],
      fabric: 'Super 110s Wool Flannel',
      origin: 'Biella Mill, Finished in Mumbai',
      image: 'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=800&q=80',
      altText: 'Charcoal wool trousers with crisp pleats',
      galleryImages: [
        'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=800&q=80',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-2',
      tryAndBuyEligible: true,
    },
    {
      id: 'prd-4',
      sku: 'AF-PRD-004',
      vendorId: 'vend-1',
      categoryId: 'cat-3',
      brand: 'Avanya Atelier',
      title: 'Zari-Embroidered Chanderi Kurta Set',
      description:
        'Heirloom Chanderi silk kurta with delicate silver zari cord work around neck and cuffs. Paired with tonal silk trousers.',
      price: 5299,
      originalPrice: 7500,
      discount: '29% OFF',
      rating: 4.9,
      reviewsCount: 42,
      stockQuantity: 6,
      stockBadge: 'LOW STOCK',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['chanderi', 'kurta', 'zari', 'festive'],
      readyToShip: true,
      sizes: ['S', 'M', 'L'],
      fabric: 'Chanderi Silk Cotton Blend',
      origin: 'Chanderi, Madhya Pradesh',
      image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80',
      altText: 'Emerald zari embroidered festive kurta',
      galleryImages: [
        'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80',
      ],
      fulfillmentType: FulfillmentType.VENDOR,
      darkStoreHubId: null,
      tryAndBuyEligible: false,
    },
    {
      id: 'prod-1',
      sku: 'AE-0101',
      vendorId: 'vend-1',
      categoryId: 'kurtis',
      brand: 'Avanya Ethnic',
      title: 'Embroidered Anarkali Kurta Set',
      description: '100% Pure Mulmul Silk, breathable drape. Crafted with heirloom zari detailing.',
      price: 1299,
      originalPrice: 2499,
      discount: '48% OFF',
      rating: 4.8,
      reviewsCount: 89,
      stockQuantity: 10,
      stockBadge: '18m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['anarkali', 'kurta', 'silk', 'ethnic', 'zari', 'festive', 'women'],
      readyToShip: true,
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
      fabric: 'Pure Mulmul Silk',
      origin: 'Jaipur, Rajasthan',
      image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
      altText: 'Editorial studio photo of deep berry-red Anarkali kurta set with golden zari embroidery.',
      galleryImages: [
        'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
        'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1200&q=90',
        'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-indiranagar',
      tryAndBuyEligible: true,
    },
    {
      id: 'prod-2',
      sku: 'VL-0202',
      vendorId: 'vend-1',
      categoryId: 'sarees',
      brand: 'Varanasi Looms',
      title: 'Handloom Cotton Saree with Zari',
      description: 'Includes unstitched blouse piece. Woven in soft ivory and rose-berry hues with broad golden zari border.',
      price: 1849,
      originalPrice: 3190,
      discount: '42% OFF',
      rating: 4.9,
      reviewsCount: 142,
      stockQuantity: 15,
      stockBadge: 'Boutique Artisan',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['saree', 'cotton', 'silk', 'handloom', 'zari', 'varanasi', 'women'],
      readyToShip: true,
      sizes: ['Free Size (5.5m + 0.8m)'],
      fabric: 'Fine Cotton Silk',
      origin: 'Varanasi, UP',
      image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
      altText: 'Handloom cotton saree in ivory and rose-berry hues with golden zari border.',
      galleryImages: [
        'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
        'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.VENDOR,
      darkStoreHubId: null,
      tryAndBuyEligible: false,
    },
    {
      id: 'prod-3',
      sku: 'GS-0303',
      vendorId: 'vend-2',
      categoryId: 'dresses',
      brand: 'Gulabi Studio',
      title: 'Tiered Floral Rayon Maxi Dress',
      description: 'Breathable weave with waist tie-up. Hand-printed floral motifs in blush pink, rose berry, and peach tones.',
      price: 999,
      originalPrice: 1999,
      discount: '50% OFF',
      rating: 4.7,
      reviewsCount: 76,
      stockQuantity: 8,
      stockBadge: '20m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['dress', 'maxi', 'floral', 'summer', 'rayon', 'gulabi', 'women'],
      readyToShip: true,
      sizes: ['S', 'M', 'L', 'XL'],
      fabric: 'Premium Rayon Weave',
      origin: 'Sanganer, Jaipur',
      image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=90',
      altText: 'Flowing tiered maxi dress with floral motifs.',
      galleryImages: [
        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=90',
        'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-koramangala',
      tryAndBuyEligible: true,
    },
    {
      id: 'prod-4',
      sku: 'AD-0404',
      vendorId: 'vend-1',
      categoryId: 'kurtis',
      brand: 'Avanya DarkStore Curated',
      title: 'Chanderi Silk Festive Kurti',
      description: '18-Minute Try & Buy Dark Store Express. Pure Chanderi woven with gota patti detailing.',
      price: 1599,
      originalPrice: 2899,
      discount: '45% OFF',
      rating: 4.9,
      reviewsCount: 112,
      stockQuantity: 12,
      stockBadge: '18m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['kurti', 'chanderi', 'silk', 'festive', 'gota patti', 'ethnic', 'women'],
      readyToShip: true,
      sizes: ['S', 'M', 'L', 'XL'],
      fabric: 'Chanderi Silk',
      origin: 'Madhya Pradesh',
      image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80',
      altText: 'Chanderi Silk Festive Kurti',
      galleryImages: [
        'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1200&q=90',
        'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-indiranagar',
      tryAndBuyEligible: true,
    },
    {
      id: 'prod-5',
      sku: 'ST-0505',
      vendorId: 'vend-2',
      categoryId: 'tops',
      brand: 'Studio 04',
      title: 'Structured Linen Cotton Shirt',
      description: 'Crisp tailored fit crafted from breathable French linen blend with mother-of-pearl buttons.',
      price: 2190,
      originalPrice: 3990,
      discount: '45% OFF',
      rating: 4.7,
      reviewsCount: 64,
      stockQuantity: 14,
      stockBadge: '18m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Men',
      tags: ['shirt', 'linen', 'cotton', 'structured', 'casual', 'men', 'tops'],
      readyToShip: true,
      sizes: ['M', 'L', 'XL'],
      fabric: 'French Linen Blend',
      origin: 'Coimbatore, TN',
      image: 'https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=800&q=85',
      altText: 'Structured Linen Cotton Shirt',
      galleryImages: [
        'https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-indiranagar',
      tryAndBuyEligible: true,
    },
    {
      id: 'prod-6',
      sku: 'AU-0606',
      vendorId: 'vend-1',
      categoryId: 'bottoms',
      brand: 'Aurel',
      title: 'Wide Leg Tailored Trousers',
      description: 'Fluid drape high-waist silhouette cut from tropical wool blend. Concealed side zip.',
      price: 2990,
      originalPrice: 5490,
      discount: '45% OFF',
      rating: 4.8,
      reviewsCount: 52,
      stockQuantity: 9,
      stockBadge: '18m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['trousers', 'pants', 'wide leg', 'tailored', 'bottoms', 'women'],
      readyToShip: true,
      sizes: ['S', 'M', 'L'],
      fabric: 'Tropical Wool Blend',
      origin: 'Bengaluru, KA',
      image: 'https://images.unsplash.com/photo-1506629905607-d9e08e2d3e8e?auto=format&fit=crop&w=800&q=85',
      altText: 'Wide Leg Tailored Trousers',
      galleryImages: [
        'https://images.unsplash.com/photo-1506629905607-d9e08e2d3e8e?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-koramangala',
      tryAndBuyEligible: true,
    },
    {
      id: 'prod-7',
      sku: 'NV-0707',
      vendorId: 'vend-2',
      categoryId: 'bottoms',
      brand: 'Novalis',
      title: 'Raw Selvedge Denim Jeans',
      description: 'Japanese shuttle-loom selvedge denim in deep indigo. Custom copper rivets and button fly.',
      price: 3690,
      originalPrice: 5890,
      discount: '37% OFF',
      rating: 4.9,
      reviewsCount: 88,
      stockQuantity: 11,
      stockBadge: 'Boutique Artisan',
      listingStatus: 'ACTIVE',
      gender: 'Men',
      tags: ['denim', 'jeans', 'selvedge', 'raw', 'indigo', 'bottoms', 'men'],
      readyToShip: true,
      sizes: ['30', '32', '34', '36'],
      fabric: '13.5oz Selvedge Denim',
      origin: 'Okayama & Mumbai',
      image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=85',
      altText: 'Raw Selvedge Denim Jeans',
      galleryImages: [
        'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.VENDOR,
      darkStoreHubId: null,
      tryAndBuyEligible: false,
    },
    {
      id: 'prod-8',
      sku: 'ST-0808',
      vendorId: 'vend-1',
      categoryId: 'footwear',
      brand: 'Studio 04',
      title: 'Court Minimal Leather Sneaker',
      description: 'Full-grain Italian calfskin with cushioned ortholite footbed and natural rubber sole.',
      price: 4990,
      originalPrice: 7990,
      discount: '38% OFF',
      rating: 4.8,
      reviewsCount: 94,
      stockQuantity: 7,
      stockBadge: '18m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Men',
      tags: ['sneakers', 'shoes', 'footwear', 'leather', 'court', 'men'],
      readyToShip: true,
      sizes: ['UK 7', 'UK 8', 'UK 9', 'UK 10'],
      fabric: 'Italian Calfskin Leather',
      origin: 'Agra Atelier',
      image: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=85',
      altText: 'Court Minimal Leather Sneaker',
      galleryImages: [
        'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-indiranagar',
      tryAndBuyEligible: true,
    },
    {
      id: 'prod-9',
      sku: 'FM-0909',
      vendorId: 'vend-1',
      categoryId: 'accessories',
      brand: 'Forme',
      title: 'Minimal Leather Everyday Tote',
      description: 'Hand-stitched vegetable-tanned leather tote with brass hardware and detachable pouch.',
      price: 5490,
      originalPrice: 8990,
      discount: '39% OFF',
      rating: 4.9,
      reviewsCount: 110,
      stockQuantity: 6,
      stockBadge: 'Boutique Artisan',
      listingStatus: 'ACTIVE',
      gender: 'Women',
      tags: ['tote', 'bag', 'leather', 'handbag', 'accessories', 'women'],
      readyToShip: true,
      sizes: ['Standard'],
      fabric: 'Vegetable-Tanned Leather',
      origin: 'Puducherry Atelier',
      image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=85',
      altText: 'Minimal Leather Everyday Tote',
      galleryImages: [
        'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.VENDOR,
      darkStoreHubId: null,
      tryAndBuyEligible: false,
    },
    {
      id: 'prod-10',
      sku: 'RY-1010',
      vendorId: 'vend-2',
      categoryId: 'kurtis',
      brand: 'Royal',
      title: 'Men Raw Silk Kurta Set',
      description: 'Classic bandhgala collar in pure raw silk with churidar pyjama. Subtle self-textured sheen.',
      price: 3490,
      originalPrice: 5990,
      discount: '42% OFF',
      rating: 4.8,
      reviewsCount: 45,
      stockQuantity: 8,
      stockBadge: '18m Delivery',
      listingStatus: 'ACTIVE',
      gender: 'Men',
      tags: ['kurta', 'raw silk', 'ethnic', 'men', 'festive', 'kurtis'],
      readyToShip: true,
      sizes: ['38', '40', '42', '44'],
      fabric: 'Pure Raw Silk',
      origin: 'Varanasi, UP',
      image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=800&q=85',
      altText: 'Men Raw Silk Kurta Set',
      galleryImages: [
        'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=90',
      ],
      fulfillmentType: FulfillmentType.DARK_STORE,
      darkStoreHubId: 'hub-koramangala',
      tryAndBuyEligible: true,
    },
  ];

  for (const p of productsToSeed) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {
        sku: p.sku,
        vendorId: p.vendorId,
        categoryId: p.categoryId,
        brand: p.brand,
        title: p.title,
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        discount: p.discount,
        rating: p.rating,
        reviewsCount: p.reviewsCount,
        stockQuantity: p.stockQuantity,
        stockBadge: p.stockBadge,
        listingStatus: p.listingStatus,
        gender: p.gender,
        tags: p.tags,
        readyToShip: p.readyToShip,
        sizes: p.sizes,
        fabric: p.fabric,
        origin: p.origin,
        image: p.image,
        altText: p.altText,
        galleryImages: p.galleryImages,
        fulfillmentType: p.fulfillmentType,
        darkStoreHubId: p.darkStoreHubId,
        tryAndBuyEligible: p.tryAndBuyEligible,
      },
      create: p,
    });
  }

  // 7. Coupons
  const coupons = [
    {
      id: 'cpn-1',
      code: 'AFFORDZ10',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 10,
      minOrderValue: 999,
      maxDiscount: 300,
      usageLimit: 1000,
      isActive: true,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T23:59:59Z'),
    },
    {
      id: 'cpn-2',
      code: 'FIRSTDROP',
      discountType: DiscountType.FLAT,
      discountValue: 200,
      minOrderValue: 799,
      maxDiscount: 200,
      usageLimit: 500,
      isActive: true,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T23:59:59Z'),
    },
    {
      id: 'cpn-3',
      code: 'VAULT50',
      discountType: DiscountType.FLAT,
      discountValue: 50,
      minOrderValue: 299,
      maxDiscount: 50,
      usageLimit: 500,
      isActive: true,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T23:59:59Z'),
    },
  ];
  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: coupon,
      create: coupon,
    });
  }

  // 8. Driver Profiles
  await prisma.driverProfile.upsert({
    where: { id: 'drv-1' },
    update: {
      fullName: 'Rajesh Kumar',
      phone: '+91 98765 43210',
      kycStatus: 'APPROVED',
      isOnline: true,
      vehicleRegistration: 'KA-01-KC-2026',
      vehicleType: '2W Scooter',
      currentLat: 12.9716,
      currentLng: 77.6412,
    },
    create: {
      id: 'drv-1',
      userId: 'usr-driver-1',
      fullName: 'Rajesh Kumar',
      phone: '+91 98765 43210',
      kycStatus: 'APPROVED',
      workPreference: 'PART_TIME',
      tier: 'Silver Tier',
      rating: 4.9,
      completedDeliveries: 342,
      isOnline: true,
      vehicleRegistration: 'KA-01-KC-2026',
      vehicleType: '2W Scooter',
      vehicleMake: 'Ather',
      vehicleModel: '450X',
      rcStatus: 'Verified',
      currentLat: 12.9716,
      currentLng: 77.6412,
    },
  });
  await prisma.driverProfile.upsert({
    where: { id: 'drv-104' },
    update: {
      fullName: 'Deepak Solanki',
      phone: '+91 98202 99310',
      kycStatus: 'APPROVED',
    },
    create: {
      id: 'drv-104',
      userId: 'usr-driver-104',
      fullName: 'Deepak Solanki',
      phone: '+91 98202 99310',
      kycStatus: 'APPROVED',
      workPreference: 'FULL_TIME',
      tier: 'Gold Tier',
      rating: 4.9,
      completedDeliveries: 1412,
      isOnline: true,
      vehicleRegistration: 'MH-01-CZ-7721',
      vehicleType: 'Bike',
      rcStatus: 'Verified',
      currentLat: 12.9352,
      currentLng: 77.6245,
    },
  });
  await prisma.driverProfile.upsert({
    where: { id: 'drv-118' },
    update: {
      fullName: 'Suraj Verma',
      phone: '+91 98201 55412',
      kycStatus: 'PENDING',
    },
    create: {
      id: 'drv-118',
      userId: 'usr-driver-118',
      fullName: 'Suraj Verma',
      phone: '+91 98201 55412',
      kycStatus: 'PENDING',
      workPreference: 'FULL_TIME',
      tier: 'Starter',
      rating: 4.7,
      completedDeliveries: 12,
      isOnline: false,
      vehicleRegistration: 'KA-05-EV-1102',
      vehicleType: 'EV Scooty',
      rcStatus: 'Pending Review',
      currentLat: 12.9121,
      currentLng: 77.6446,
    },
  });

  // 9. Dynamic-Date Shifts, Slots & Surges
  const { byIso, byShort } = getWeekDatesMap();
  for (let idx = 0; idx < INITIAL_SHIFTS.length; idx++) {
    const sh = INITIAL_SHIFTS[idx] as any;
    const mappedDate = byShort[sh.dateStr] || sh.dateStr;
    const dayOfWeek = idx;
    await prisma.driverShift.upsert({
      where: { id: sh.id },
      update: {
        dayOfWeek,
        day: sh.day,
        dateStr: mappedDate,
        timeRange: sh.timeRange,
        duration: sh.duration,
        hub: sh.hub,
        hubAddress: sh.hubAddress,
        status: sh.status,
        statusLabel: sh.statusLabel,
        breakTime: sh.breakTime ?? null,
        attendance: sh.attendance ?? null,
        displayOrder: idx,
      },
      create: {
        id: sh.id,
        dayOfWeek,
        day: sh.day,
        dateStr: mappedDate,
        timeRange: sh.timeRange,
        duration: sh.duration,
        hub: sh.hub,
        hubAddress: sh.hubAddress,
        status: sh.status,
        statusLabel: sh.statusLabel,
        breakTime: sh.breakTime ?? null,
        attendance: sh.attendance ?? null,
        displayOrder: idx,
      },
    });
  }

  for (const slot of INITIAL_SLOTS) {
    const mappedDate = byIso[slot.dateKey] || slot.dateKey;
    await prisma.driverSlot.upsert({
      where: { id: slot.id },
      update: {
        dateKey: mappedDate,
        timeRange: slot.timeRange,
        demand: slot.demand,
        bonusText: slot.bonusText ?? null,
        capacity: slot.capacity,
      },
      create: {
        id: slot.id,
        dateKey: mappedDate,
        timeRange: slot.timeRange,
        demand: slot.demand,
        bonusText: slot.bonusText ?? null,
        capacity: slot.capacity,
      },
    });
  }

  for (const surge of INITIAL_SURGES) {
    await prisma.driverSurge.upsert({
      where: { id: surge.id },
      update: {
        title: surge.headline,
        area: surge.zone,
        timeWindow: surge.timeRemaining,
        bonusAmount: surge.bonusAmount,
        isActive: surge.isActive,
      },
      create: {
        id: surge.id,
        title: surge.headline,
        area: surge.zone,
        timeWindow: surge.timeRemaining,
        bonusAmount: surge.bonusAmount,
        isActive: surge.isActive,
      },
    });
  }

  // 10. Baseline Orders, Review & Support Ticket
  const existingLiveOrder = await prisma.order.findUnique({ where: { id: 'ord-89241' } });
  if (!existingLiveOrder) {
    await prisma.order.create({
      data: {
        id: 'ord-89241',
        orderNumber: 'KC-89241',
        customerId: 'usr-1',
        driverId: 'usr-driver-1',
        driverProfileId: 'drv-1',
        addressId: 'addr-1',
        vendorId: 'vend-1',
        fulfillmentType: FulfillmentType.DARK_STORE,
        status: OrderStatus.OUT_FOR_DELIVERY,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        razorpayOrderId: 'rzp_order_demo892',
        razorpayPaymentId: 'pay_demo89241',
        itemTotal: 1299,
        deliveryFee: 40,
        taxes: 65,
        couponCode: 'AFFORDZ10',
        discountAmount: 129.9,
        grandTotal: 1274.1,
        etaMinutes: 12,
        isTryAndBuy: true,
        items: {
          create: [
            {
              id: 'oi-seed-89241',
              productId: 'prod-1',
              title: 'Embroidered Anarkali Kurta Set',
              brand: 'Avanya Ethnic',
              size: 'M',
              trialSize: 'L',
              price: 1299,
              quantity: 1,
              tryAndBuyDecision: 'PENDING',
              image:
                'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
            },
          ],
        },
        history: {
          create: [
            { status: OrderStatus.PLACED, note: 'Order placed by customer', actorRole: Role.CUSTOMER },
            { status: OrderStatus.ACCEPTED, note: 'Vendor accepted order', actorRole: Role.VENDOR },
            { status: OrderStatus.OUT_FOR_DELIVERY, note: 'Out for express delivery', actorRole: Role.DRIVER },
          ],
        },
      },
    });
  }

  const existingDeliveredOrder = await prisma.order.findUnique({ where: { id: 'ord-seed-del-1' } });
  if (!existingDeliveredOrder) {
    await prisma.order.create({
      data: {
        id: 'ord-seed-del-1',
        orderNumber: 'KC-89200',
        customerId: 'usr-1',
        driverId: 'usr-driver-1',
        driverProfileId: 'drv-1',
        addressId: 'addr-1',
        vendorId: 'vend-1',
        fulfillmentType: FulfillmentType.VENDOR,
        status: OrderStatus.DELIVERED,
        paymentMethod: PaymentMethod.RAZORPAY,
        paymentStatus: PaymentStatus.COMPLETED,
        itemTotal: 3148,
        deliveryFee: 0,
        taxes: 157,
        grandTotal: 3305,
        etaMinutes: 0,
        isTryAndBuy: false,
        deliveredAt: new Date('2026-10-15T12:00:00Z'),
        items: {
          create: [
            {
              id: 'oi-seed-del-1',
              productId: 'prod-1',
              title: 'Embroidered Anarkali Kurta Set',
              brand: 'Avanya Ethnic',
              size: 'M',
              price: 1299,
              quantity: 1,
              tryAndBuyDecision: 'KEEP',
              image:
                'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1200&q=90',
            },
            {
              id: 'oi-seed-del-2',
              productId: 'prod-2',
              title: 'Handloom Cotton Saree with Zari',
              brand: 'Varanasi Looms',
              size: 'Free Size (5.5m + 0.8m)',
              price: 1849,
              quantity: 1,
              tryAndBuyDecision: 'KEEP',
              image:
                'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=90',
            },
          ],
        },
        history: {
          create: [
            { status: OrderStatus.PLACED, note: 'Order placed by customer', actorRole: Role.CUSTOMER },
            { status: OrderStatus.DELIVERED, note: 'Delivered safely to customer', actorRole: Role.DRIVER },
          ],
        },
      },
    });
  }

  await prisma.review.upsert({
    where: { id: 'rev-seed-1' },
    update: { status: 'PUBLISHED' },
    create: {
      id: 'rev-seed-1',
      userId: 'usr-1',
      productId: 'prod-2',
      orderId: 'ord-seed-del-1',
      rating: 5,
      comment: 'Sublime drape and pure handloom elegance. Arrived packaged beautifully with zero creases.',
      status: 'PUBLISHED',
    },
  });

  await prisma.supportTicket.upsert({
    where: { id: 'tkt-seed-1' },
    update: {
      status: SupportTicketStatus.OPEN,
      priority: 'HIGH',
      category: 'DELIVERY',
    },
    create: {
      id: 'tkt-seed-1',
      userId: 'usr-1',
      orderId: 'ord-89241',
      title: 'Need landmark guidance note forwarded to driver',
      description: 'Please instruct the rider to ring the bell twice at Sunrise Heights apt 4B.',
      category: 'DELIVERY',
      priority: 'HIGH',
      status: SupportTicketStatus.OPEN,
      assignee: 'Rahul M.',
    },
  });

  // 11. Workspace Settings (Preferences, Admin Credentials, Role Permissions)
  await prisma.workspaceSetting.upsert({
    where: { key: 'workspacePreferences' },
    update: { value: DEFAULT_WORKSPACE_PREFERENCES as any },
    create: {
      key: 'workspacePreferences',
      value: DEFAULT_WORKSPACE_PREFERENCES as any,
    },
  });

  await prisma.workspaceSetting.upsert({
    where: { key: 'adminCredentials' },
    update: { value: INITIAL_ADMIN_USERS as any },
    create: {
      key: 'adminCredentials',
      value: INITIAL_ADMIN_USERS as any,
    },
  });

  await prisma.workspaceSetting.upsert({
    where: { key: 'rolePermissions' },
    update: {
      value: {
        roles: INITIAL_ADMIN_ROLES,
        permissions: INITIAL_ROLE_PERMISSIONS,
      } as any,
    },
    create: {
      key: 'rolePermissions',
      value: {
        roles: INITIAL_ADMIN_ROLES,
        permissions: INITIAL_ROLE_PERMISSIONS,
      } as any,
    },
  });

  const vendorDossiersValue = Object.fromEntries(
    INITIAL_ADMIN_VENDORS.map((v: any) => [
      v.id,
      {
        vendorNumber: v.vendorNumber,
        legalEntityName: v.legalEntityName,
        ownerName: v.ownerName,
        ownerRole: v.ownerRole,
        email: v.email,
        registeredAddress: v.registeredAddress,
        gstin: v.gstin,
        pan: v.pan,
        documents: v.documents || [],
        bankDetails: v.bankDetails || null,
        assignedReviewer: v.assignedReviewer || null,
        submissionDate: v.submissionDate || null,
        productCount: v.productCount ?? 0,
      },
    ]),
  );
  await prisma.workspaceSetting.upsert({
    where: { key: 'vendorDossiers' },
    update: { value: vendorDossiersValue as any },
    create: { key: 'vendorDossiers', value: vendorDossiersValue as any },
  });

  console.log('Affordz PostgreSQL seeding completed.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
