import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
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
    drivers: [
      {
        id: 'drv-1',
        userId: 'usr-driver-1',
        name: 'Rajesh Kumar',
        phone: '+91 98765 43210',
        email: 'rajesh.driver@kudicart.in',
        photo:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuB-9n0OJClXNM6d0TX37sDPYy2u14Q2urWrIDrGrcsqp-xeOqvJWO4kLCkJM2p4l8e4m4L2wDCHqTawwJ4RiTjZPrGzg0jToIbTJpMggV8VY-XM8NL1FIq9KmGLwPNEJ_9rmCB4K-W2qmOS5AXnWOrQVPZSlvSNve7Z3L9QAVxRKy5jXEY_LUYbxNPc7m3PZ877qBOS_WWQ8dabL-BBYfbKqFLHaaegb80kVZpY-Z_FPvHZPdgyE2SFDA',
        vehicle: 'KA 03 EV 4821 (Electric Scooter)',
        isOnline: true,
        kycStatus: 'APPROVED',
        kycDocuments: [
          { type: 'Aadhaar Card', status: 'VERIFIED', verifiedAt: '2026-01-11T12:00:00Z' },
          { type: 'Driving License', number: 'DL-04202209418', status: 'VERIFIED', verifiedAt: '2026-01-11T12:00:00Z' },
          { type: 'Vehicle RC', number: 'KA03EV4821', status: 'VERIFIED', verifiedAt: '2026-01-11T12:00:00Z' },
        ],
        rating: 4.9,
        completedDeliveries: 428,
        currentLocation: {
          latitude: 12.9716,
          longitude: 77.5946,
          heading: 45,
          updatedAt: new Date().toISOString(),
        },
      },
    ],
    vendors: [
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
    categories: [
      { id: 'kurtis', name: 'Kurtis', countText: '320+ styles', icon: 'styler' },
      { id: 'sarees', name: 'Sarees', countText: 'Pure Silk', icon: 'dry_cleaning' },
      { id: 'dresses', name: 'Dresses', countText: 'Maxi & Midi', icon: 'woman' },
      { id: 'fabrics', name: 'Fabrics', countText: 'By the Metre', icon: 'texture' },
    ],
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
        stockBadge: 'In Stock',
        readyToShip: true,
        category: 'Kurtis',
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        fabric: 'Pure Mulmul Silk',
        origin: 'Jaipur, Rajasthan',
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
        altText:
          'Editorial studio photo of a female model wearing an opulent deep berry-red Anarkali kurta set with golden zari embroidery.',
        galleryImages: [
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
          'https://lh3.googleusercontent.com/aida-public/AB6AXuD59d0OJClXNM6d0TX37sDPYy2u14Q2urWrIDrGrcsqp-xeOqvJWO4kLCkJM2p4l8e4m4L2wDCHqTawwJ4RiTjZPrGzg0jToIbTJpMggV8VY-XM8NL1FIq9KmGLwPNEJ_9rmCB4K-W2qmOS5AXnWOrQVPZSlvSNve7Z3L9QAVxRKy5jXEY_LUYbxNPc7m3PZ877qBOS_WWQ8dabL-BBYfbKqFLHaaegb80kVZpY-Z_FPvHZPdgyE2SFDA',
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
        stockBadge: 'In Stock',
        readyToShip: true,
        category: 'Sarees',
        sizes: ['Free Size (5.5m + 0.8m)'],
        fabric: 'Fine Cotton Silk',
        origin: 'Varanasi, UP',
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBZmXmAng2VIvmt-e5UoQ1MrsXUMl1p1ftqAD3jjKM_YhlObUmOfd_rwaYD9cuGHuKnJVJBq6kagdOAfjiCSzvvDeVpdrAoGZBOD7YgEfEhdUx85DVetiWSmEdkgQISuSVzZXuSiadjUZUFFvsv0XIZp7_tRq9rvE-Exol7J2LYupakSoB-rwJjs7Y3evVbNoXHjav-QXpye1FUGXeKzjdjw_34arHkcmA3NY6gd6xMd-6DRSq6M5oNfw',
        altText:
          'Elegant studio showcase of handloom cotton saree in ivory and rose-berry hues with golden zari border.',
        galleryImages: [],
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
        stockBadge: 'In Stock',
        readyToShip: true,
        category: 'Dresses',
        sizes: ['S', 'M', 'L', 'XL'],
        fabric: 'Premium Rayon Weave',
        origin: 'Sanganer, Jaipur',
        image:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuChjjRPXtK6wGlAzoX8MBkuhS5YQslHvyJa70gSCTmiApO-Lv00JijbP2efRpHEXOYf7Sb03MXrwmH90rYSHdWR_oiv_PNVMCQPGogU99bT_moi70avCMo2utLRF3l_PH6o7WaUE_ndCaN1oW4g9nWiFuH3yLqZDFknFOazu7KzBYjldvcFKSVuQDqubPby_0bCn0qmp1p5scLFl83Y1KDLoHjsLtaL4FCmrZV4k7E3Zx-u5XYrt3g3KQ',
        altText:
          'Flowing tiered maxi dress with delicate floral motifs in blush pink and rose berry tones.',
        galleryImages: [],
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
        createdAt: new Date('2026-09-24T14:15:00Z').toISOString(),
        updatedAt: new Date('2026-09-24T14:55:00Z').toISOString(),
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            title: 'Embroidered Anarkali Kurta Set',
            brand: 'Avanya Ethnic',
            size: 'Size M',
            price: 1299,
            quantity: 1,
            image:
              'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
          },
        ],
        history: [
          { status: 'PLACED', time: '2:15 PM', note: 'Order placed by customer', actor: 'CUSTOMER' },
          { status: 'ACCEPTED', time: '2:17 PM', note: 'Vendor accepted order', actor: 'VENDOR' },
          { status: 'PREPARING', time: '2:25 PM', note: 'Quality check & gift packaging', actor: 'VENDOR' },
          { status: 'READY_FOR_PICKUP', time: '2:40 PM', note: 'Ready at store counter', actor: 'VENDOR' },
          { status: 'ASSIGNED', time: '2:42 PM', note: 'Admin assigned rider Rajesh Kumar', actor: 'ADMIN' },
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
  };

  async onModuleInit() {}
  async onModuleDestroy() {}

  getStore() {
    return this.store;
  }
}
