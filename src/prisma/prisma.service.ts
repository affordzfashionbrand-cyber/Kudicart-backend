import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // Mock Data Store fallback for instant zero-dependency execution
  private store = {
    users: [
      {
        id: 'usr-1',
        firebaseUid: 'fb-user-123',
        phone: '+91 98450 12890',
        email: 's.vishwa8999@gmail.com',
        name: 'Ananya Sharma',
        avatar: 'https://lh3.googleusercontent.com/aida/AEtjO1VWtKT1o8SeNnSo4l3FyyDwDHs_2VrqMmxcyY66IrRg9rL8LkbbnuL2TffL_CyEaqzkwfMMb8tXKb4wQTNtgTrqXO9l2Yi8Pq4du2CXnP7lmY5vWpGHBTWfweA4JAHjIOXuFa59STYjuuXipREO_RT3mGzoprfKCWe-WrMubapxuDZ2B7UA-MwnQfHcf1AtMn-UkuyrLssuYf_YUriU8q2jFN8qIrperLt43xS0h1vE3Hgb0dCyrts8bMA',
        role: 'CUSTOMER',
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
        description: 'Pure Mulmul Silk with Chiffon Dupatta. Features intricate golden zari work along the neckline and cuffs with flowy flair.',
        price: 1299,
        originalPrice: 2499,
        discount: '48% OFF',
        rating: 4.8,
        reviewsCount: 89,
        stockQuantity: 2,
        stockBadge: 'Only 2 Left',
        readyToShip: true,
        category: 'Kurtis',
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        fabric: 'Pure Mulmul Silk',
        origin: 'Jaipur, Rajasthan',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
        altText: 'Editorial studio photo of a female model wearing an opulent deep berry-red Anarkali kurta set with golden zari embroidery.',
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
        description: 'Includes unstitched blouse piece. Woven in soft ivory and rose-berry hues with broad golden zari border.',
        price: 1849,
        originalPrice: 3190,
        discount: '42% OFF',
        rating: 4.9,
        reviewsCount: 142,
        stockQuantity: 15,
        readyToShip: true,
        category: 'Sarees',
        sizes: ['Free Size (5.5m + 0.8m)'],
        fabric: 'Fine Cotton Silk',
        origin: 'Varanasi, UP',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBZmXmAng2VIvmt-e5UoQ1MrsXUMl1p1ftqAD3jjKM_YhlObUmOfd_rwaYD9cuGHuKnJVJBq6kagdOAfjiCSzvvDeVpdrAoGZBOD7YgEfEhdUx85DVetiWSmEdkgQISuSVzZXuSiadjUZUFFvsv0XIZp7_tRq9rvE-Exol7J2LYupakSoB-rwJjs7Y3evVbNoXHjav-QXpye1FUGXeKzjdjw_34arHkcmA3NY6gd6xMd-6DRSq6M5oNfw',
        altText: 'Elegant studio showcase of handloom cotton saree in ivory and rose-berry hues with golden zari border.',
      },
      {
        id: 'prod-3',
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
        readyToShip: true,
        category: 'Dresses',
        sizes: ['S', 'M', 'L', 'XL'],
        fabric: 'Premium Rayon Weave',
        origin: 'Sanganer, Jaipur',
        image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuChjjRPXtK6wGlAzoX8MBkuhS5YQslHvyJa70gSCTmiApO-Lv00JijbP2efRpHEXOYf7Sb03MXrwmH90rYSHdWR_oiv_PNVMCQPGogU99bT_moi70avCMo2utLRF3l_PH6o7WaUE_ndCaN1oW4g9nWiFuH3yLqZDFknFOazu7KzBYjldvcFKSVuQDqubPby_0bCn0qmp1p5scLFl83Y1KDLoHjsLtaL4FCmrZV4k7E3Zx-u5XYrt3g3KQ',
        altText: 'Flowing tiered maxi dress with delicate floral motifs in blush pink and rose berry tones.',
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
        isDefault: true,
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
        status: 'OUT_FOR_DELIVERY',
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'COMPLETED',
        razorpayOrderId: 'rzp_order_demo892',
        razorpayPaymentId: 'pay_demo89241',
        itemTotal: 1299,
        deliveryFee: 40,
        taxes: 114,
        grandTotal: 1453,
        etaMinutes: 12,
        createdAt: new Date().toISOString(),
        driver: {
          name: 'Rajesh Kumar',
          phone: '+91 98765 43210',
          vehicle: 'KA 03 EV 4821 (Electric Scooter)',
          photo: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB-9n0OJClXNM6d0TX37sDPYy2u14Q2urWrIDrGrcsqp-xeOqvJWO4kLCkJM2p4l8e4m4L2wDCHqTawwJ4RiTjZPrGzg0jToIbTJpMggV8VY-XM8NL1FIq9KmGLwPNEJ_9rmCB4K-W2qmOS5AXnWOrQVPZSlvSNve7Z3L9QAVxRKy5jXEY_LUYbxNPc7m3PZ877qBOS_WWQ8dabL-BBYfbKqFLHaaegb80kVZpY-Z_FPvHZPdgyE2SFDA',
        },
        items: [
          {
            id: 'oi-1',
            productId: 'prod-1',
            title: 'Embroidered Anarkali Kurta Set',
            brand: 'Avanya Ethnic',
            size: 'Size M',
            price: 1299,
            quantity: 1,
            image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBTs6-ZqrlCWEJVbPDPREz0wpb5KSte4RfbM_CFWtYByj1Qc_k44_GCyF1iH4BGfJnWitJDsFkbG5QdTkr1lWbmeRjm4Sjw1-H24gH-93XY9maRVKsweEwf47isp-cXHwTuC01nyYYwhghENAssQln3RbbqPdr5ZU7vbKVIAZzaBN3nCBPzrEWX99MdjRBISiVH6LhmgYy1UufvPL6FavGOUabgo-pl4fxAqy5IIErLKuy3XyzrqnSLzg',
          },
        ],
        history: [
          { status: 'PLACED', time: '2:15 PM', note: 'Order placed by customer' },
          { status: 'ACCEPTED', time: '2:17 PM', note: 'Vendor accepted order' },
          { status: 'PREPARING', time: '2:25 PM', note: 'Quality check & gift packaging' },
          { status: 'READY_FOR_PICKUP', time: '2:40 PM', note: 'Ready at store counter' },
          { status: 'ASSIGNED', time: '2:42 PM', note: 'Rider Rajesh Kumar assigned' },
          { status: 'PICKED_UP', time: '2:50 PM', note: 'Picked up from vendor' },
          { status: 'OUT_FOR_DELIVERY', time: '2:55 PM', note: 'Out for express delivery' },
        ],
      },
    ],
    tickets: [],
  };

  async onModuleInit() {}
  async onModuleDestroy() {}

  // Service accessors
  getStore() {
    return this.store;
  }
}
