import { PrismaClient, Role, FulfillmentType, DiscountType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Affordz Production Seed...');

  // 1. Dark Store Hubs
  console.log('Seeding Dark Store Hubs...');
  const hubIndiranagar = await prisma.darkStoreHub.upsert({
    where: { id: 'hub-1' },
    update: {},
    create: {
      id: 'hub-1',
      name: 'Indiranagar Express Pod',
      locality: 'Indiranagar 100ft Road',
      address: 'Pod #4, Metro Pillar 128, 100ft Road, Indiranagar, Bengaluru, 560038',
      lat: 12.9716,
      lng: 77.6412,
      deliveryMinutes: 18,
      isActive: true,
    },
  });

  const hubKoramangala = await prisma.darkStoreHub.upsert({
    where: { id: 'hub-2' },
    update: {},
    create: {
      id: 'hub-2',
      name: 'Koramangala 4th Block Hub',
      locality: 'Koramangala 4th Block',
      address: 'Hub #2, 80ft Road, Sony Signal, Koramangala 4th Block, Bengaluru, 560034',
      lat: 12.9352,
      lng: 77.6245,
      deliveryMinutes: 20,
      isActive: true,
    },
  });

  const hubWhitefield = await prisma.darkStoreHub.upsert({
    where: { id: 'hub-3' },
    update: {},
    create: {
      id: 'hub-3',
      name: 'Whitefield Prestige Tech Pod',
      locality: 'Whitefield',
      address: 'Pod #7, ECC Road, Near ITPL, Whitefield, Bengaluru, 560066',
      lat: 12.9698,
      lng: 77.7500,
      deliveryMinutes: 22,
      isActive: true,
    },
  });

  // 2. Users (Admin, Vendor, Driver, Customer)
  console.log('Seeding Users...');
  const customer = await prisma.user.upsert({
    where: { firebaseUid: 'fb-user-123' },
    update: {},
    create: {
      id: 'usr-1',
      firebaseUid: 'fb-user-123',
      phone: '+91 98450 12890',
      email: 'customer@affordz.in',
      name: 'Ananya Sharma',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      role: Role.CUSTOMER,
    },
  });

  const driver = await prisma.user.upsert({
    where: { firebaseUid: 'fb-driver-123' },
    update: {},
    create: {
      id: 'usr-driver-1',
      firebaseUid: 'fb-driver-123',
      phone: '+91 98765 43210',
      email: 'rajesh.driver@affordz.in',
      name: 'Rajesh Kumar',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
      role: Role.DRIVER,
    },
  });

  const vendorUser = await prisma.user.upsert({
    where: { firebaseUid: 'fb-vendor-123' },
    update: {},
    create: {
      id: 'usr-vendor-1',
      firebaseUid: 'fb-vendor-123',
      phone: '+91 80 4123 9988',
      email: 'vendor.avanya@affordz.in',
      name: 'Meera Deshmukh',
      role: Role.VENDOR,
    },
  });

  const admin = await prisma.user.upsert({
    where: { firebaseUid: 'fb-admin-123' },
    update: {},
    create: {
      id: 'usr-admin-1',
      firebaseUid: 'fb-admin-123',
      phone: '+91 99999 00000',
      email: 'admin@affordz.in',
      name: 'Affordz Operations Admin',
      role: Role.ADMIN,
    },
  });

  // 3. Vendor
  console.log('Seeding Vendor...');
  const vendor = await prisma.vendor.upsert({
    where: { userId: vendorUser.id },
    update: {},
    create: {
      id: 'vend-1',
      userId: vendorUser.id,
      storeName: 'Avanya Haute Atelier',
    },
  });

  // 4. Customer Address
  await prisma.vendor.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      id: 'vend-affordz-official',
      userId: admin.id,
      storeName: 'Affordz Official Store',
    },
  });

  // 4. Customer Address
  console.log('Seeding Customer Address...');
  await prisma.address.upsert({
    where: { id: 'addr-1' },
    update: {},
    create: {
      id: 'addr-1',
      userId: customer.id,
      label: 'Home',
      line1: 'Apartment 402, Sunrise Heights, 4th Cross Road',
      locality: 'Indiranagar Stage 2',
      city: 'Bengaluru',
      isDefault: true,
    },
  });

  // 5. Categories
  console.log('Seeding Categories...');
  const categories = [
    { id: 'cat-1', name: 'Atelier Wear', slug: 'atelier-wear', level: 1, countText: '148 designs', icon: 'Sparkles' },
    { id: 'cat-2', name: 'Formal Studio', slug: 'formal-studio', level: 1, countText: '86 tailored pieces', icon: 'Briefcase' },
    { id: 'cat-3', name: 'Evening Gala', slug: 'evening-gala', level: 1, countText: '62 gowns & kurtas', icon: 'Crown' },
    { id: 'cat-4', name: 'Casual Luxe', slug: 'casual-luxe', level: 1, countText: '112 essentials', icon: 'Shirt' },
    { id: 'cat-5', name: 'Vault Accessories', slug: 'vault-accessories', level: 1, countText: '44 statement accents', icon: 'Gem' },
    { id: 'cat-6', name: 'Footwear', slug: 'footwear-studio', level: 1, countText: '58 handcrafted pairs', icon: 'Footprints' },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: cat.name, slug: cat.slug, level: cat.level, countText: cat.countText, icon: cat.icon },
      create: cat,
    });
  }

  // 6. Products
  console.log('Seeding Products...');
  const products = [
    {
      id: 'prd-1',
      vendorId: vendor.id,
      categoryId: 'cat-1',
      brand: 'Avanya Atelier',
      title: 'Handloom Mulberry Silk Wrap Dress',
      description: 'Pure Mulberry silk dyed with non-toxic botanical indigo. Features relaxed silhouette with wrap closure and mother-of-pearl buttons.',
      price: 3499,
      originalPrice: 4999,
      discount: '30% OFF',
      rating: 4.8,
      reviewsCount: 38,
      stockQuantity: 12,
      stockBadge: 'DARK STORE STOCK',
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
      darkStoreHubId: hubIndiranagar.id,
      tryAndBuyEligible: true,
    },
    {
      id: 'prd-2',
      vendorId: vendor.id,
      categoryId: 'cat-1',
      brand: 'Avanya Atelier',
      title: 'Khadi Organic Cotton Trench Jacket',
      description: 'Handwoven zero-carbon khadi trench with structured raglan sleeves, storm flap, and horn buttons. Wind and shower resistant.',
      price: 4899,
      originalPrice: 6999,
      discount: '30% OFF',
      rating: 4.9,
      reviewsCount: 54,
      stockQuantity: 8,
      stockBadge: 'LOW STOCK',
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
      darkStoreHubId: hubIndiranagar.id,
      tryAndBuyEligible: true,
    },
    {
      id: 'prd-3',
      vendorId: vendor.id,
      categoryId: 'cat-2',
      brand: 'Raw Stitch Studio',
      title: 'Charcoal Wool Flannel Tailored Trousers',
      description: 'High-rise tapered trousers cut from Italian Super 110s wool flannel. Internal curtain waistband and horn side adjusters.',
      price: 2799,
      originalPrice: 3999,
      discount: '30% OFF',
      rating: 4.7,
      reviewsCount: 29,
      stockQuantity: 15,
      stockBadge: 'DARK STORE STOCK',
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
      darkStoreHubId: hubKoramangala.id,
      tryAndBuyEligible: true,
    },
    {
      id: 'prd-4',
      vendorId: vendor.id,
      categoryId: 'cat-3',
      brand: 'Avanya Atelier',
      title: 'Zari-Embroidered Chanderi Kurta Set',
      description: 'Heirloom Chanderi silk kurta with delicate silver zari cord work around neck and cuffs. Paired with tonal silk trousers.',
      price: 5299,
      originalPrice: 7500,
      discount: '29% OFF',
      rating: 4.9,
      reviewsCount: 42,
      stockQuantity: 6,
      stockBadge: 'LOW STOCK',
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
  ];

  for (const prd of products) {
    await prisma.product.upsert({
      where: { id: prd.id },
      update: prd,
      create: prd,
    });
  }

  // 7. Active Coupons
  console.log('Seeding Coupons...');
  const coupons = [
    {
      id: 'cpn-1',
      code: 'AFFORDZ10',
      discountType: DiscountType.PERCENTAGE,
      discountValue: 10,
      minOrderValue: 999,
      maxDiscount: 300,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T23:59:59Z'),
      isActive: true,
    },
    {
      id: 'cpn-2',
      code: 'FIRSTDROP',
      discountType: DiscountType.FLAT,
      discountValue: 200,
      minOrderValue: 799,
      maxDiscount: 200,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T23:59:59Z'),
      isActive: true,
    },
    {
      id: 'cpn-3',
      code: 'VAULT50',
      discountType: DiscountType.FLAT,
      discountValue: 50,
      minOrderValue: 299,
      maxDiscount: 50,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2027-12-31T23:59:59Z'),
      isActive: true,
    },
  ];

  for (const cpn of coupons) {
    await prisma.coupon.upsert({
      where: { code: cpn.code },
      update: cpn,
      create: cpn,
    });
  }

  console.log('✅ Affordz Production Seed Completed Successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
