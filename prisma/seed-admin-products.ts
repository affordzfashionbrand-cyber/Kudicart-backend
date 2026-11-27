import { PrismaClient, FulfillmentType } from '@prisma/client';

const prisma = new PrismaClient();

interface AdminProductSeedItem {
  id: string;
  sku: string;
  title: string;
  brand: string;
  description: string;
  categoryId: string;
  price: number;
  originalPrice: number;
  stockQuantity: number;
  gender: 'Women' | 'Men' | 'Kids' | 'Unisex';
  sizes: string[];
  fabric: string;
  origin: string;
  certification: string;
  image: string;
  galleryImages: string[];
  colorName: string;
  colorHex: string;
  colors: Array<{ name: string; hex: string; image?: string }>;
  tags: string[];
  specifications: Record<string, string>;
  hubId: string;
}

const PRODUCTS_DATA: AdminProductSeedItem[] = [
  // ==========================================
  // WOMEN'S ETHNIC WEAR
  // ==========================================
  {
    id: 'prod-admin-01',
    sku: 'AF-DS-WEM-001',
    title: 'Banarasi Katan Pure Silk Saree with Antique Zari',
    brand: 'Affordz Official Store',
    description:
      'Woven on handloom jacquards in Varanasi using 100% pure katan silk yarn. Features intricate antique gold zari floral jaal, heavy pallu, and matching unstitched blouse piece.',
    categoryId: 'sarees',
    price: 3899,
    originalPrice: 6999,
    stockQuantity: 30,
    gender: 'Women',
    sizes: ['Free Size (5.5m + 0.8m)'],
    fabric: '100% Pure Katan Silk',
    origin: 'Varanasi Atelier, Uttar Pradesh',
    certification: 'Silk Mark Certified',
    image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Royal Carmine Red',
    colorHex: '#991B1B',
    colors: [
      { name: 'Royal Carmine Red', hex: '#991B1B', image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1000&q=85' },
      { name: 'Peacock Emerald Green', hex: '#065F46', image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85' },
      { name: 'Temple Saffron Gold', hex: '#D97706', image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85' },
    ],
    tags: ['saree', 'silk', 'banarasi', 'zari', 'festive', 'wedding', 'women', 'ethnic', 'silk saree', 'dark-store'],
    specifications: {
      'Weave Technique': 'Handloom Kadhwa Weave',
      'Zari Quality': 'Electroplated Gold Tested Zari',
      'Blouse Length': '0.8 Metres Attached',
      'Care Protocol': 'Dry Clean Only',
      Occasion: 'Weddings & Royal Celebrations',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-02',
    sku: 'AF-DS-WEM-002',
    title: 'Handcrafted Chanderi Silk Kurta & Palazzo Set',
    brand: 'Affordz Official Store',
    description:
      'Lightweight festive luxury tailored from handspun Chanderi silk with subtle metallic sheen. Features hand-embroidered gota patti neckline, flared palazzo pants, and sheer organza dupatta.',
    categoryId: 'leaf-women-kurtasets',
    price: 2499,
    originalPrice: 4499,
    stockQuantity: 40,
    gender: 'Women',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    fabric: 'Chanderi Silk Cotton Blend with Cotton Mulmul Lining',
    origin: 'Chanderi Heritage Cluster, Madhya Pradesh',
    certification: 'Handloom Mark Certified',
    image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Pale Blush Rose',
    colorHex: '#F472B6',
    colors: [
      { name: 'Pale Blush Rose', hex: '#F472B6' },
      { name: 'Pistachio Sage', hex: '#A7F3D0' },
      { name: 'Ivory Pearl', hex: '#F5F2EB' },
    ],
    tags: ['kurta set', 'chanderi', 'ethnic', 'festive', 'women', 'palazzo', 'dupatta', 'dark-store'],
    specifications: {
      'Set Composition': 'Kurta, Palazzo Pants, and Dupatta',
      'Kurta Length': 'Calf Length (44 inches)',
      'Sleeve Length': 'Three-Quarter Sleeves',
      Lining: '100% Breathable Cotton Mulmul',
      'Care Protocol': 'Mild Hand Wash with Silk Detergent',
      Occasion: 'Festive Gatherings & Haldi Ceremonies',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-03',
    sku: 'AF-DS-WEM-003',
    title: 'Lucknowi Hand-Embroidered Chikankari Anarkali Kurti',
    brand: 'Affordz Official Store',
    description:
      'Intricate 32-stitch shadow and tepchi embroidery worked by master artisans in Lucknow on sheer georgette. Comes with matching slip, round neckline with potli buttons, and graceful flared silhouette.',
    categoryId: 'kurtis',
    price: 1699,
    originalPrice: 2999,
    stockQuantity: 35,
    gender: 'Women',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    fabric: 'Fine Viscose Georgette with Modal Slip',
    origin: 'Lucknow Craft Guild, Uttar Pradesh',
    certification: 'Geographical Indication (GI) Certified',
    image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Breeze Mint Green',
    colorHex: '#6EE7B7',
    colors: [
      { name: 'Breeze Mint Green', hex: '#6EE7B7' },
      { name: 'Powder Lavender', hex: '#DDD6FE' },
      { name: 'Pure Chalk White', hex: '#FFFFFF' },
    ],
    tags: ['kurti', 'chikankari', 'anarkali', 'lucknowi', 'cotton', 'women', 'ethnic', 'summer', 'dark-store'],
    specifications: {
      Embroidery: 'Handmade Bakhiya, Phanda & Murri Work',
      Silhouette: 'Flared Kalidar Anarkali',
      'Slip Included': 'Yes, matching tonal cotton slip',
      'Care Protocol': 'Gentle Cold Water Hand Wash',
      Occasion: 'Day Events, Festive Pooja & Office Ethnic',
    },
    hubId: 'hub-tambaram',
  },
  {
    id: 'prod-admin-04',
    sku: 'AF-DS-WEM-004',
    title: 'Midnight Velvet Zardozi Flared Anarkali Gown',
    brand: 'Affordz Official Store',
    description:
      'Regal evening couture in micro-velvet fabric adorned with dabka, french knots, and metallic zardozi threads. Designed with a structured bodice, sweeping 4-meter flare, and sheer netted dupatta.',
    categoryId: 'leaf-women-anarkali',
    price: 5499,
    originalPrice: 8999,
    stockQuantity: 20,
    gender: 'Women',
    sizes: ['S', 'M', 'L', 'XL'],
    fabric: 'Heavy Silk Micro-Velvet',
    origin: 'Surat Textile Studio, Gujarat',
    certification: 'Atelier Couture Certified',
    image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Royal Midnight Navy',
    colorHex: '#1E1B4B',
    colors: [
      { name: 'Royal Midnight Navy', hex: '#1E1B4B' },
      { name: 'Deep Wine Plum', hex: '#4C0519' },
      { name: 'Forest Bottle Green', hex: '#064E3B' },
    ],
    tags: ['anarkali', 'gown', 'velvet', 'zardozi', 'evening', 'party', 'women', 'ethnic', 'wedding', 'dark-store'],
    specifications: {
      FlaredGirth: '3.8 Metre Circumference',
      Neckline: 'Sweetheart Neck with Zardozi Trim',
      Padding: 'Built-in Tailored Bust Padding',
      'Care Protocol': 'Specialist Dry Clean Only',
      Occasion: 'Reception, Sangeet & Winter Galas',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-05',
    sku: 'AF-DS-WEM-005',
    title: 'Kanjivaram Bridal Brocade Silk Saree with Korvai Border',
    brand: 'Affordz Official Store',
    description:
      'Heirloom quality South Indian pure mulberry silk saree hand-loomed with solid contrast Korvai borders and rich Mayil (peacock) motifs woven in tested gold zari.',
    categoryId: 'sarees',
    price: 4799,
    originalPrice: 7999,
    stockQuantity: 25,
    gender: 'Women',
    sizes: ['Free Size (5.5m + 0.8m)'],
    fabric: '100% Kanchipuram Mulberry Silk',
    origin: 'Kanchipuram Master Weavers, Tamil Nadu',
    certification: 'Silk Mark & GI Certified',
    image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Sindoor Crimson & Mustard',
    colorHex: '#B91C1C',
    colors: [
      { name: 'Sindoor Crimson & Mustard', hex: '#B91C1C' },
      { name: 'Emerald & Royal Purple', hex: '#047857' },
    ],
    tags: ['saree', 'kanjivaram', 'silk', 'temple border', 'bridal', 'women', 'ethnic', 'silk saree', 'dark-store'],
    specifications: {
      Weave: 'Double Warp Pure Silk Korvai',
      Weight: '780 grams of Pure Mulberry Silk',
      BlousePiece: 'Contrast Brocade Blouse Included',
      'Care Protocol': 'Dry Clean & Air Dry in Shade',
      Occasion: 'Bridal, Muhurtham & Classical Festivities',
    },
    hubId: 'hub-tambaram',
  },

  // ==========================================
  // WOMEN'S WESTERN WEAR
  // ==========================================
  {
    id: 'prod-admin-06',
    sku: 'AF-DS-WW-001',
    title: 'Tiered Botanical Floral Georgette Midi Dress',
    brand: 'Affordz Official Store',
    description:
      'Flowy, feminine midi dress in premium micro-georgette featuring custom painterly botanical prints, square neckline, smocked elasticated waist, and tiered ruffled hemline.',
    categoryId: 'dresses',
    price: 1899,
    originalPrice: 3299,
    stockQuantity: 45,
    gender: 'Women',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    fabric: 'Breathable Georgette with Poly-Cotton Crepe Lining',
    origin: 'Bengaluru Design Studio, India',
    certification: 'OEKO-TEX Certified Eco-Dyes',
    image: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'English Garden Ivory',
    colorHex: '#FEF3C7',
    colors: [
      { name: 'English Garden Ivory', hex: '#FEF3C7' },
      { name: 'Dusty Sage Botanical', hex: '#D1FAE5' },
    ],
    tags: ['dress', 'maxi dress', 'floral', 'summer', 'western', 'women', 'casual', 'brunch', 'dark-store'],
    specifications: {
      Length: 'Midi (46 inches from shoulder)',
      Closure: 'Concealed Side YKK Zipper',
      Neckline: 'Modest Square Neckline',
      'Care Protocol': 'Machine Wash Cold Delicate',
      Occasion: 'Weekend Brunches & Summer Vacations',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-07',
    sku: 'AF-DS-WW-002',
    title: 'Fluid Hammered Satin Slip Evening Midi Dress',
    brand: 'Affordz Official Store',
    description:
      'Bias-cut silhouette tailored in heavyweight hammered satin that glides gracefully across body contours. Finished with delicate adjustable rouleau straps and cowl drape neckline.',
    categoryId: 'dresses',
    price: 2199,
    originalPrice: 3999,
    stockQuantity: 30,
    gender: 'Women',
    sizes: ['XS', 'S', 'M', 'L'],
    fabric: '100% Hammered Viscose Satin',
    origin: 'Mumbai Fashion Atelier, India',
    certification: 'Atelier Premium Standard',
    image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Liquid Champagne Gold',
    colorHex: '#D4AF37',
    colors: [
      { name: 'Liquid Champagne Gold', hex: '#D4AF37' },
      { name: 'Obsidian Onyx Black', hex: '#111827' },
    ],
    tags: ['dress', 'satin', 'cocktail', 'party', 'western', 'women', 'evening wear', 'dark-store'],
    specifications: {
      Fit: 'Bias Cut Contoured Drape',
      Neckline: 'Subtle Cowl Neck',
      Lining: 'Self-Faced Bust Lining',
      'Care Protocol': 'Steam Iron & Gentle Hand Wash',
      Occasion: 'Cocktail Evenings & Gala Dinners',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-08',
    sku: 'AF-DS-WW-003',
    title: 'Tailored Cotton Poplin Puff-Sleeve Blouse',
    brand: 'Affordz Official Store',
    description:
      'Sharp, crisp shirting poplin elevated with romantic pleated puff sleeves and Mother-of-Pearl button placket. Pairs effortlessly with tailored trousers or denim.',
    categoryId: 'tops',
    price: 1299,
    originalPrice: 2199,
    stockQuantity: 50,
    gender: 'Women',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    fabric: '100% Combed Compact Cotton Poplin',
    origin: 'Coimbatore Mills, Tamil Nadu',
    certification: 'BCI Better Cotton Initiative',
    image: 'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Crisp Architectural White',
    colorHex: '#FFFFFF',
    colors: [
      { name: 'Crisp Architectural White', hex: '#FFFFFF' },
      { name: 'French Sky Blue', hex: '#BAE6FD' },
    ],
    tags: ['top', 'blouse', 'poplin', 'cotton', 'western', 'women', 'workwear', 'dark-store'],
    specifications: {
      Fit: 'Slim Tailored Fit with Darting',
      Collar: 'Pointed Classic Spread Collar',
      Buttons: 'Genuine Natural Shell Buttons',
      'Care Protocol': 'Machine Wash Warm & Steam Press',
      Occasion: 'Desk to Dinner & Smart Casual',
    },
    hubId: 'hub-tambaram',
  },
  {
    id: 'prod-admin-09',
    sku: 'AF-DS-WW-004',
    title: 'Double-Breasted Pure Linen Relaxed Blazer',
    brand: 'Affordz Official Store',
    description:
      'Impeccably unstructured blazer woven from pure French flax linen. Features peaked lapels, horn-effect buttons, welt flap pockets, and breathable half-lining for breezy summer layering.',
    categoryId: 'leaf-women-jackets',
    price: 3299,
    originalPrice: 5499,
    stockQuantity: 28,
    gender: 'Women',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    fabric: '100% Pure European Flax Linen',
    origin: 'Jaipur Tailoring Atelier, Rajasthan',
    certification: 'Masters of Linen Certified',
    image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Warm Sand Dune',
    colorHex: '#E5DCC5',
    colors: [
      { name: 'Warm Sand Dune', hex: '#E5DCC5' },
      { name: 'Heritage Khaki', hex: '#78716C' },
    ],
    tags: ['blazer', 'jacket', 'linen', 'formal', 'women', 'western', 'quiet luxury', 'old money', 'dark-store'],
    specifications: {
      Construction: 'Unstructured Soft Shoulder Padding',
      Venting: 'Dual Rear Side Vents',
      Pockets: 'Two Flap Pockets and Internal Chest Pocket',
      'Care Protocol': 'Dry Clean Recommended',
      Occasion: 'Executive Boardroom & High-Tea Layering',
    },
    hubId: 'hub-pozhichalur',
  },

  // ==========================================
  // MEN'S ETHNIC & FESTIVE WEAR
  // ==========================================
  {
    id: 'prod-admin-10',
    sku: 'AF-DS-MEM-001',
    title: 'Heritage Matka Raw Silk Bandhgala Jodhpuri Suit',
    brand: 'Affordz Official Store',
    description:
      'Handcrafted royal Jodhpuri jacket tailored in handspun textured Matka raw silk. Embellished with monogrammed brass antique buttons, welted chest pocket, and paired with slim tailored trousers.',
    categoryId: 'sub-men-ethnic',
    price: 5999,
    originalPrice: 9999,
    stockQuantity: 25,
    gender: 'Men',
    sizes: ['38 (S)', '40 (M)', '42 (L)', '44 (XL)', '46 (XXL)'],
    fabric: '100% Handspun Matka Raw Silk with Satin Twill Lining',
    origin: 'Jaipur Royal Tailors, Rajasthan',
    certification: 'Silk Mark Certified',
    image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1597983073493-88cd35cf93b0?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Royal Prussian Blue',
    colorHex: '#1E293B',
    colors: [
      { name: 'Royal Prussian Blue', hex: '#1E293B' },
      { name: 'Charcoal Slate', hex: '#334155' },
    ],
    tags: ['bandhgala', 'jodhpuri', 'men', 'ethnic', 'festive', 'wedding', 'raw silk', 'groom', 'dark-store'],
    specifications: {
      Closure: 'Mandarin Collar Front Button Closure',
      Details: 'Cast Antique Brass Crest Buttons',
      Trousers: 'Matching Flat-Front Trousers Included',
      'Care Protocol': 'Dry Clean Only in Muslin Bag',
      Occasion: 'Bespoke Weddings & Formal Receptions',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-11',
    sku: 'AF-DS-MEM-002',
    title: 'Lucknowi Chikankari Embroidered Cotton Kurta & Churidar',
    brand: 'Affordz Official Store',
    description:
      'Pure organic cambric cotton kurta showcasing delicate tone-on-tone Lucknowi thread needlework on yoke and cuffs. Includes pure white drawstring cotton churidar.',
    categoryId: 'sub-men-ethnic',
    price: 1599,
    originalPrice: 2799,
    stockQuantity: 40,
    gender: 'Men',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    fabric: '100% Organic Long-Staple Cambric Cotton',
    origin: 'Lucknow Master Craftsmen, Uttar Pradesh',
    certification: 'GI Tag Lucknowi Chikankari',
    image: 'https://images.unsplash.com/photo-1597983073493-88cd35cf93b0?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1597983073493-88cd35cf93b0?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Warm Ecru Pearl',
    colorHex: '#FDFBF7',
    colors: [
      { name: 'Warm Ecru Pearl', hex: '#FDFBF7' },
      { name: 'Duck Egg Blue', hex: '#E0F2FE' },
    ],
    tags: ['kurta', 'lucknowi', 'men', 'ethnic', 'festive', 'cotton', 'summer', 'chikankari', 'dark-store'],
    specifications: {
      KurtaLength: 'Knee Length Straight Cut (42 inches)',
      Collar: 'Mandarin Stand Collar',
      Pockets: 'Two Deep Concealed Side Pockets',
      'Care Protocol': 'Machine Wash Gentle Cold',
      Occasion: 'Diwali Pooja, Eid & Mehendi Ceremonies',
    },
    hubId: 'hub-tambaram',
  },
  {
    id: 'prod-admin-12',
    sku: 'AF-DS-MEM-003',
    title: 'Textured Tussar Silk Handcrafted Nehru Jacket',
    brand: 'Affordz Official Store',
    description:
      'Versatile festive waist-coat in slubby Bhagalpuri Tussar silk. Features structured front button placket, five custom brass shank buttons, and tailored ticket pocket.',
    categoryId: 'sub-men-ethnic',
    price: 2299,
    originalPrice: 3999,
    stockQuantity: 35,
    gender: 'Men',
    sizes: ['38 (S)', '40 (M)', '42 (L)', '44 (XL)'],
    fabric: 'Bhagalpuri Pure Tussar Slub Silk',
    origin: 'Bhagalpur Silk Cluster, Bihar',
    certification: 'Silk Mark Certified',
    image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Mustard Turmeric Ochre',
    colorHex: '#D97706',
    colors: [
      { name: 'Mustard Turmeric Ochre', hex: '#D97706' },
      { name: 'Forest Teal Green', hex: '#0F766E' },
    ],
    tags: ['nehru jacket', 'jacket', 'men', 'ethnic', 'festive', 'silk', 'modi jacket', 'dark-store'],
    specifications: {
      Fit: 'Slim Tailored Waistcoat',
      Neck: 'Bandhgala Mandarin Collar',
      Lining: 'Soft Breathable Viscose Twill',
      'Care Protocol': 'Professional Dry Clean',
      Occasion: 'Sangeet, Weddings & Formal Dinners',
    },
    hubId: 'hub-pozhichalur',
  },

  // ==========================================
  // MEN'S WESTERN TOPWEAR & BOTTOMWEAR
  // ==========================================
  {
    id: 'prod-admin-13',
    sku: 'AF-DS-MW-001',
    title: '100% French Flax Relaxed Cuban Collar Linen Shirt',
    brand: 'Affordz Official Store',
    description:
      'Breezy summer silhouette crafted from premium French flax yarn. Pre-washed for velvety hand-feel, featuring retro camp collar, mother-of-pearl buttons, and straight boxy hem.',
    categoryId: 'leaf-men-casualshirts',
    price: 1799,
    originalPrice: 2999,
    stockQuantity: 45,
    gender: 'Men',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    fabric: '100% Pure Normandy French Flax Linen',
    origin: 'Puducherry Artisan Unit, India',
    certification: 'European Flax Certified',
    image: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1000&q=85',
      'https://images.unsplash.com/photo-1620012253295-c15c429f66bf?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Natural Oatmeal Melange',
    colorHex: '#D6CEBE',
    colors: [
      { name: 'Natural Oatmeal Melange', hex: '#D6CEBE' },
      { name: 'Navy Marine', hex: '#1E3A8A' },
      { name: 'Olive Drab', hex: '#3F6212' },
    ],
    tags: ['shirt', 'linen', 'casual shirt', 'cuban collar', 'men', 'western', 'summer', 'old money', 'dark-store'],
    specifications: {
      Collar: 'Camp / Cuban Open Spread Collar',
      Hem: 'Straight Casual Hem with Side Slits',
      Weave: 'Medium-Weight Airy Basketweave',
      'Care Protocol': 'Machine Wash Cold & Hang Dry',
      Occasion: 'Resort Holidays, Summer Days & Weekend Lounging',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-14',
    sku: 'AF-DS-MW-002',
    title: 'Egyptian Giza 88 Long-Staple Tailored Formal Shirt',
    brand: 'Affordz Official Store',
    description:
      'Woven from rare 120s two-ply extra-long staple Egyptian Giza cotton with subtle micro-twill texture. Features semi-spread collar, French front placket, and double mitered cuffs.',
    categoryId: 'leaf-men-formalshirts',
    price: 2199,
    originalPrice: 3699,
    stockQuantity: 40,
    gender: 'Men',
    sizes: ['38 (S)', '39', '40 (M)', '42 (L)', '44 (XL)'],
    fabric: '100% Giza 88 Extra-Long Staple Cotton (120s 2-Ply)',
    origin: 'Ahmedabad Master Looms, Gujarat',
    certification: 'Egyptian Cotton Authentic DNA Tested',
    image: 'https://images.unsplash.com/photo-1620012253295-c15c429f66bf?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1620012253295-c15c429f66bf?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Executive Ice Blue',
    colorHex: '#E0F2FE',
    colors: [
      { name: 'Executive Ice Blue', hex: '#E0F2FE' },
      { name: 'Optical Pure White', hex: '#FFFFFF' },
    ],
    tags: ['shirt', 'formal shirt', 'giza cotton', 'office', 'men', 'western', 'executive', 'dark-store'],
    specifications: {
      Fit: 'Contemporary Tailored Fit',
      Collar: 'Structured Semi-Cutaway Collar',
      Cuffs: 'Dual-Button Adjustable Barrel Cuffs',
      'Care Protocol': 'Machine Wash Warm & High Steam Press',
      Occasion: 'Executive Boardroom, Client Pitches & Interviews',
    },
    hubId: 'hub-tambaram',
  },
  {
    id: 'prod-admin-15',
    sku: 'AF-DS-MW-003',
    title: '240 GSM Heavyweight Streetwear Boxy Oversized Tee',
    brand: 'Affordz Official Store',
    description:
      'Ultra-dense 240 GSM combed cotton jersey tailored in an architectural boxy drop-shoulder cut. Features thick 1.25-inch rib-knit neckline that retains structure wash after wash.',
    categoryId: 'leaf-men-tshirts',
    price: 899,
    originalPrice: 1599,
    stockQuantity: 60,
    gender: 'Men',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    fabric: '100% Super-Combed Compact Cotton (240 GSM)',
    origin: 'Tiruppur Knitwear Atelier, Tamil Nadu',
    certification: 'GOTS Certified Organic Bio-Washed',
    image: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Washed Charcoal Mineral',
    colorHex: '#334155',
    colors: [
      { name: 'Washed Charcoal Mineral', hex: '#334155' },
      { name: 'Heavy Bone Ecru', hex: '#F5F5F4' },
      { name: 'Deep Forest Pine', hex: '#14532D' },
    ],
    tags: ['t-shirt', 'tee', 'oversized', 'streetwear', 'men', 'western', 'cotton', 'heavyweight', 'dark-store'],
    specifications: {
      Weight: '240 GSM Heavyweight Jersey',
      Fit: 'Boxy Drop Shoulder Relaxed Fit',
      Finish: 'Enzyme Bio-Washed Anti-Pilling',
      'Care Protocol': 'Cold Machine Wash Inside Out',
      Occasion: 'Streetwear, Casual Weekend & Daily High-Rotation',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-16',
    sku: 'AF-DS-MW-004',
    title: '14oz Kurabo Japanese Selvedge Raw Denim Jeans',
    brand: 'Affordz Official Store',
    description:
      'Woven on vintage Toyoda shuttle looms using rope-dyed indigo yarn with classic red ticker selvedge edge ID. Tailored in clean straight-tapered fit with copper rivets and button fly.',
    categoryId: 'bottoms',
    price: 3499,
    originalPrice: 5999,
    stockQuantity: 30,
    gender: 'Men',
    sizes: ['30', '32', '34', '36', '38'],
    fabric: '100% Ring-Spun Cotton 14oz Red-Line Selvedge Denim',
    origin: 'Kurabo Mills Partnered, Kojima & Bengaluru',
    certification: 'Authentic Shuttle Loom Selvedge',
    image: 'https://images.unsplash.com/photo-1542272604-780c96856592?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1542272604-780c96856592?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Deep Rigid Indigo',
    colorHex: '#1E1B4B',
    colors: [
      { name: 'Deep Rigid Indigo', hex: '#1E1B4B' },
    ],
    tags: ['jeans', 'denim', 'selvedge', 'raw denim', 'men', 'western', 'streetwear', 'dark-store'],
    specifications: {
      DenimWeight: '14oz Stiff Raw Denim (Develops custom fades)',
      Fly: 'Solid Brass Donut Button Fly',
      Hardware: 'Hand-Hammered Solid Copper Rivets',
      'Care Protocol': 'Wear 6 months before first cold soak',
      Occasion: 'Bespoke Everyday Denim Enthusiast',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-17',
    sku: 'AF-DS-MW-005',
    title: 'Pleated Tapered Tailored Chino Trousers',
    brand: 'Affordz Official Store',
    description:
      'Italian Riviera styling tailored in premium high-twist cotton stretch twill. Features single reverse front pleats, extended tab waistband with side adjusters, and cuffed ankles.',
    categoryId: 'leaf-men-trousers',
    price: 2299,
    originalPrice: 3999,
    stockQuantity: 35,
    gender: 'Men',
    sizes: ['30', '32', '34', '36', '38'],
    fabric: '98% Long-Staple Cotton, 2% Lycra High-Twist Twill',
    origin: 'Bengaluru Tailoring Atelier, Karnataka',
    certification: 'OEKO-TEX Standard 100',
    image: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Classic British Khaki',
    colorHex: '#A89F91',
    colors: [
      { name: 'Classic British Khaki', hex: '#A89F91' },
      { name: 'Deep Olive Safari', hex: '#365314' },
    ],
    tags: ['trousers', 'chinos', 'pleated', 'linen', 'men', 'western', 'old money', 'smart casual', 'dark-store'],
    specifications: {
      Waistband: 'Gurkha-Inspired Extended Tab Waistband',
      Rise: 'Mid-to-High Rise',
      AnkleHem: 'Pre-Cuffed 1.5-Inch Turn-Up Hem',
      'Care Protocol': 'Machine Wash Cold & Warm Iron',
      Occasion: 'Smart Casual, Country Club & Travel',
    },
    hubId: 'hub-tambaram',
  },

  // ==========================================
  // FOOTWEAR & LEATHER ACCESSORIES
  // ==========================================
  {
    id: 'prod-admin-18',
    sku: 'AF-DS-FW-001',
    title: 'Minimalist Low-Top Italian Nappa Leather Sneaker',
    brand: 'Affordz Official Store',
    description:
      'Court sneaker crafted from full-grain butter-soft Nappa leather with tonal Margom-style stitched rubber cupsoles and memory-foam anatomical footbed.',
    categoryId: 'footwear',
    price: 3999,
    originalPrice: 6499,
    stockQuantity: 30,
    gender: 'Unisex',
    sizes: ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'],
    fabric: '100% Full-Grain Italian Nappa Leather with Calfskin Lining',
    origin: 'Ambur Footwear Guild, Tamil Nadu',
    certification: 'Leather Working Group (LWG) Gold Standard',
    image: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Porcelain Chalk White',
    colorHex: '#FDFBF7',
    colors: [
      { name: 'Porcelain Chalk White', hex: '#FDFBF7' },
      { name: 'Triple Midnight Black', hex: '#111827' },
    ],
    tags: ['sneakers', 'shoes', 'leather', 'court', 'men', 'women', 'footwear', 'minimalist', 'dark-store'],
    specifications: {
      Sole: 'Non-Marking Vulcanized Stitched Rubber Cupsole',
      Insole: 'Removable Dual-Density Orthotic Cushion',
      Laces: 'Waxed Organic Combed Cotton Flat Laces',
      'Care Protocol': 'Clean with Damp Cloth & Leather Balm',
      Occasion: 'Versatile Styling with Suits or Denim',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-19',
    sku: 'AF-DS-FW-002',
    title: 'Goodyear Welted Antiqued Calfskin Oxford Shoes',
    brand: 'Affordz Official Store',
    description:
      'Classic formal footwear made with centuries-old Goodyear welt construction that allows complete resoling. Hand-burnished museum calfskin with closed five-eyelet lacing.',
    categoryId: 'leaf-men-formalshoes',
    price: 4899,
    originalPrice: 7999,
    stockQuantity: 20,
    gender: 'Men',
    sizes: ['UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'],
    fabric: '100% Full-Grain French Box Calf Leather',
    origin: 'Ranipet Master Cordwainers, Tamil Nadu',
    certification: 'Goodyear Welted Resolable Construction',
    image: 'https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Burnished Espresso Chestnut',
    colorHex: '#451A03',
    colors: [
      { name: 'Burnished Espresso Chestnut', hex: '#451A03' },
      { name: 'Polished Black Patent', hex: '#000000' },
    ],
    tags: ['shoes', 'oxford', 'formal shoes', 'leather', 'men', 'footwear', 'executive', 'goodyear welt', 'dark-store'],
    specifications: {
      Construction: '360-Degree Goodyear Welted Leather Sole',
      ToeCap: 'Crisp Hand-Stitched Plain Toe Cap',
      Heel: 'Stacked Leather Heel with Rubber Quarter Top-Piece',
      'Care Protocol': 'Polish with Carnauba Wax & Insert Cedar Trees',
      Occasion: 'Executive Formal, Black Tie & Wedding Ceremonies',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-20',
    sku: 'AF-DS-FW-003',
    title: 'Hand-Embroidered Velvet Festive Mojari Juttis',
    brand: 'Affordz Official Store',
    description:
      'Traditional handcrafted Indian juttis constructed with soft vegetable-tanned leather soles and royal velvet upper embroidered with tilla and dabka motifs. Padded with double foam for all-night comfort.',
    categoryId: 'sub-footwear-ethnic',
    price: 1699,
    originalPrice: 2799,
    stockQuantity: 35,
    gender: 'Unisex',
    sizes: ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10'],
    fabric: 'Micro-Velvet Upper on Pure Buffalo Leather Sole',
    origin: 'Amritsar Jutti Artisan Cluster, Punjab',
    certification: 'Handmade In India Authenticated',
    image: 'https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Royal Maroon Velvet',
    colorHex: '#881337',
    colors: [
      { name: 'Royal Maroon Velvet', hex: '#881337' },
      { name: 'Antique Gold Zari', hex: '#D4AF37' },
    ],
    tags: ['juttis', 'mojari', 'ethnic', 'shoes', 'footwear', 'handcrafted', 'festive', 'wedding', 'dark-store'],
    specifications: {
      Padding: 'Memory Foam Cushion Footbed',
      Sole: 'Pure Hand-Stitched Leather Sole',
      Toe: 'Traditional Pointed Upturned Khussa Toe',
      'Care Protocol': 'Store in Dry Cotton Dustbag',
      Occasion: 'Sangeet Nights, Festivals & Sherwani Pairings',
    },
    hubId: 'hub-tambaram',
  },
  {
    id: 'prod-admin-21',
    sku: 'AF-DS-ACC-001',
    title: 'Full-Grain Vegetable Tanned Leather Everyday Tote',
    brand: 'Affordz Official Store',
    description:
      'Minimalist leather tote bag structured to hold up to a 15-inch laptop, planner, and daily essentials. Features solid brass hardware, bonded suede lining, and interior zippered zip-pocket.',
    categoryId: 'accessories',
    price: 4299,
    originalPrice: 6999,
    stockQuantity: 25,
    gender: 'Unisex',
    sizes: ['One Size (40cm x 32cm x 14cm)'],
    fabric: '100% Full-Grain Vegetable-Tanned Cowhide Leather',
    origin: 'Kolkata Leather Craftsmen, West Bengal',
    certification: 'LWG Certified Eco-Friendly Tannery',
    image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Saddle Cognac Brown',
    colorHex: '#78350F',
    colors: [
      { name: 'Saddle Cognac Brown', hex: '#78350F' },
      { name: 'Matte Obsidian Black', hex: '#111827' },
    ],
    tags: ['bag', 'tote', 'leather', 'handbag', 'accessories', 'luxury', 'women', 'men', 'laptop bag', 'dark-store'],
    specifications: {
      Compartment: 'Dedicated Padded 15" Laptop Sleeve',
      Hardware: 'Antiqued Solid Milled Brass Fasteners',
      DropLength: 'Generous 9.5-Inch Shoulder Strap Drop',
      'Care Protocol': 'Condition with Organic Beeswax Balm',
      Occasion: 'Workday Commute, Travel & Weekend Escape',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-22',
    sku: 'AF-DS-ACC-002',
    title: '18K Gold Plated Heritage Kundan & Pearl Choker Set',
    brand: 'Affordz Official Store',
    description:
      'Imperial Mughal jewellery set handcrafted in brass alloy with 18k micron gold plating. Encrusted with faceted uncut Kundan stones, green meenakari enameling on reverse, and freshwater pearls.',
    categoryId: 'sub-acc-jewels',
    price: 1999,
    originalPrice: 3499,
    stockQuantity: 40,
    gender: 'Women',
    sizes: ['Adjustable Dori Fit (Includes Matching Earrings)'],
    fabric: '18K Gold Micron Plated Brass with Natural Pearls',
    origin: 'Jaipur Johari Bazaar, Rajasthan',
    certification: 'Nickel & Lead-Free Hypoallergenic',
    image: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Imperial Emerald & Pearl',
    colorHex: '#047857',
    colors: [
      { name: 'Imperial Emerald & Pearl', hex: '#047857' },
      { name: 'Royal Ruby Maroon', hex: '#881337' },
    ],
    tags: ['jewellery', 'kundan', 'choker', 'necklace', 'accessories', 'ethnic', 'gold', 'pearls', 'dark-store'],
    specifications: {
      Includes: 'Choker Necklace with Pair of Matching Danglers',
      Plating: 'High-Durability 1.5 Micron 18 Karat Yellow Gold',
      Closure: 'Traditional Braided Silk Thread Dori',
      'Care Protocol': 'Store in Velvet Box Away from Perfumes',
      Occasion: 'Weddings, Engagements & Grand Celebrations',
    },
    hubId: 'hub-tambaram',
  },

  // ==========================================
  // KIDS' CLOTHING
  // ==========================================
  {
    id: 'prod-admin-23',
    sku: 'AF-DS-KD-001',
    title: 'Girls Tiered Ruffled Chiffon Birthday Frock',
    brand: 'Affordz Official Store',
    description:
      'Charming party frock tailored with multiple cascading tiers of soft poly-chiffon over 100% gentle cotton voile lining. Finished with satin sash bow tie at the back and flutter cap sleeves.',
    categoryId: 'leaf-girls-dresses',
    price: 1199,
    originalPrice: 1999,
    stockQuantity: 50,
    gender: 'Kids',
    sizes: ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-11Y'],
    fabric: 'Soft Chiffon with 100% Anti-Allergic Cotton Voile Lining',
    origin: 'Surat Garment Hub, Gujarat',
    certification: 'Child-Safe Non-Toxic Certified',
    image: 'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Princess Powder Pink',
    colorHex: '#FBCFE8',
    colors: [
      { name: 'Princess Powder Pink', hex: '#FBCFE8' },
      { name: 'Sky Fairy Blue', hex: '#BAE6FD' },
    ],
    tags: ['kids', 'girls', 'dress', 'frock', 'birthday', 'party', 'floral', 'dark-store'],
    specifications: {
      Lining: 'Full Seamless Cotton Voile (No itchy seams)',
      Closure: 'Concealed Smooth-Glide Back Zipper',
      Length: 'Knee-Length Twirl Flare',
      'Care Protocol': 'Gentle Machine Wash Inside Laundry Bag',
      Occasion: 'Birthdays, Family Functions & Celebrations',
    },
    hubId: 'hub-pozhichalur',
  },
  {
    id: 'prod-admin-24',
    sku: 'AF-DS-KD-002',
    title: 'Boys 100% Organic Pique Cotton Nautical Polo',
    brand: 'Affordz Official Store',
    description:
      'Sporty classic polo crafted in durable 220 GSM breathable organic pique cotton. Detailed with contrasting yarn-dyed nautical chest stripes and reinforced twill collar.',
    categoryId: 'leaf-boys-tshirts',
    price: 699,
    originalPrice: 1199,
    stockQuantity: 60,
    gender: 'Kids',
    sizes: ['3-4Y', '5-6Y', '7-8Y', '9-10Y', '11-12Y'],
    fabric: '100% Certified Organic Pique Cotton (220 GSM)',
    origin: 'Tiruppur Kids Apparel Unit, Tamil Nadu',
    certification: 'GOTS Organic Certified',
    image: 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Nautical Navy & Red Stripe',
    colorHex: '#1E3A8A',
    colors: [
      { name: 'Nautical Navy & Red Stripe', hex: '#1E3A8A' },
      { name: 'Heather Grey & Yellow', hex: '#9CA3AF' },
    ],
    tags: ['kids', 'boys', 't-shirt', 'polo', 'cotton', 'striped', 'casual', 'dark-store'],
    specifications: {
      Buttons: 'Wood-Effect Shatterproof Child-Safe Buttons',
      Collar: 'Reinforced Rib-Knit Collar',
      Venting: 'Side Vent Dropped Tennis Tail',
      'Care Protocol': 'Standard Machine Wash Warm',
      Occasion: 'School Casuals, Playdates & Family Outings',
    },
    hubId: 'hub-tambaram',
  },
  {
    id: 'prod-admin-25',
    sku: 'AF-DS-KD-003',
    title: 'Boys Comfort Flex Cotton Denim Jogger Pants',
    brand: 'Affordz Official Store',
    description:
      'Active-comfort denim crafted with 4-way stretch loop-back knit denim. Features soft ribbed elasticated drawstring waistband, ribbed cuffs, and reinforced knee patches.',
    categoryId: 'leaf-boys-jeans',
    price: 899,
    originalPrice: 1499,
    stockQuantity: 45,
    gender: 'Kids',
    sizes: ['3-4Y', '5-6Y', '7-8Y', '9-10Y', '11-12Y'],
    fabric: '85% Cotton, 13% Poly, 2% Spandex Knit Denim',
    origin: 'Bengaluru Kids Garments, Karnataka',
    certification: 'OEKO-TEX Certified Soft Dye',
    image: 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=1000&q=85',
    galleryImages: [
      'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=1000&q=85',
    ],
    colorName: 'Vintage Washed Indigo',
    colorHex: '#3B82F6',
    colors: [
      { name: 'Vintage Washed Indigo', hex: '#3B82F6' },
      { name: 'Urban Carbon Black', hex: '#1F2937' },
    ],
    tags: ['kids', 'boys', 'jeans', 'joggers', 'denim', 'casual', 'dark-store'],
    specifications: {
      Waistband: 'Encased Rib Waistband with Functional Cord',
      Pockets: 'Two Slant Front Pockets & Rear Patch Pocket',
      Cuffs: 'Comfort Ribbed Ankle Cuffs',
      'Care Protocol': 'Machine Wash Cold Inside Out',
      Occasion: 'All-Day Playtime, School Trips & Daily Comfort',
    },
    hubId: 'hub-pozhichalur',
  },
];

async function seedAdminDarkStoreProducts() {
  console.log('🚀 Starting Admin Dark Store Product Seeding...');

  // 1. Ensure Admin User & Official Vendor exist
  let adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });

  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        id: 'usr-admin-1',
        firebaseUid: 'admin-seed-uid',
        email: 'admin@affordz.in',
        phone: '+919999900001',
        name: 'Affordz Operations Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log('✅ Created root Admin user:', adminUser.email);
  }

  let officialVendor = await prisma.vendor.findUnique({
    where: { id: 'vend-affordz-official' },
  });

  if (!officialVendor) {
    officialVendor = await prisma.vendor.create({
      data: {
        id: 'vend-affordz-official',
        userId: adminUser.id,
        storeName: 'Affordz Official Store',
        commissionRate: 12.5,
        status: 'ACTIVE',
      },
    });
    console.log('✅ Created Official Store Vendor record.');
  }

  // 2. Ensure Dark Store Hubs exist
  const existingHubs = await prisma.darkStoreHub.findMany();
  const hubMap = new Map<string, string>();
  for (const h of existingHubs) {
    hubMap.set(h.id, h.id);
  }

  if (!hubMap.has('hub-pozhichalur')) {
    const hub = await prisma.darkStoreHub.create({
      data: {
        id: 'hub-pozhichalur',
        name: 'Pozhichalur Express Hub',
        locality: 'Pozhichalur',
        address: '22, Anna Salai, Pozhichalur, Chennai 600074',
        lat: 12.9815,
        lng: 80.1345,
        deliveryMinutes: 18,
        isActive: true,
      },
    });
    hubMap.set(hub.id, hub.id);
    console.log('✅ Created Pozhichalur hub.');
  }

  if (!hubMap.has('hub-tambaram')) {
    const hub = await prisma.darkStoreHub.create({
      data: {
        id: 'hub-tambaram',
        name: 'Tambaram Central Hub',
        locality: 'Tambaram',
        address: '14, GST Road, Tambaram West, Chennai 600045',
        lat: 12.9249,
        lng: 80.1165,
        deliveryMinutes: 18,
        isActive: true,
      },
    });
    hubMap.set(hub.id, hub.id);
    console.log('✅ Created Tambaram hub.');
  }

  // 3. Category Fallback Resolver
  const allCategories = await prisma.category.findMany();
  const catSet = new Set(allCategories.map((c) => c.id));
  const catSlugMap = new Map(allCategories.map((c) => [c.slug, c.id]));

  function resolveCatId(catIdOrSlug: string, fallbackId = 'kurtis'): string {
    if (catSet.has(catIdOrSlug)) return catIdOrSlug;
    if (catSlugMap.has(catIdOrSlug)) return catSlugMap.get(catIdOrSlug)!;
    return fallbackId;
  }

  // 4. Update Stale Existing Products (prd-1..4) to valid categories in the 3-Tier tree
  const staleCategoryRemaps = [
    { id: 'prd-1', categoryId: 'dresses', gender: 'Women' },
    { id: 'prd-2', categoryId: 'leaf-women-jackets', gender: 'Women' },
    { id: 'prd-3', categoryId: 'leaf-men-trousers', gender: 'Men' },
    { id: 'prd-4', categoryId: 'leaf-women-kurtasets', gender: 'Women' },
    { id: 'om_1795605338656_snws_pA_xi6b', categoryId: 'kurtis', gender: 'Women', image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605338656_snws_pB_xi6b', categoryId: 'leaf-women-anarkali', gender: 'Women', image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605785139_qw17_pA_5q4u', categoryId: 'kurtis', gender: 'Women', image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605785139_qw17_pA_kffg', categoryId: 'kurtis', gender: 'Women', image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605785139_qw17_pA_r15e', categoryId: 'kurtis', gender: 'Women', image: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605785139_qw17_pB_5q4u', categoryId: 'leaf-women-anarkali', gender: 'Women', image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605785139_qw17_pB_kffg', categoryId: 'leaf-women-anarkali', gender: 'Women', image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1000&q=85' },
    { id: 'om_1795605785139_qw17_pB_r15e', categoryId: 'leaf-women-anarkali', gender: 'Women', image: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1000&q=85' },
  ];

  for (const remap of staleCategoryRemaps) {
    const existing = await prisma.product.findUnique({ where: { id: remap.id } });
    if (existing) {
      await prisma.product.update({
        where: { id: remap.id },
        data: {
          categoryId: resolveCatId(remap.categoryId),
          gender: remap.gender,
          image: remap.image || existing.image,
          listingStatus: 'ACTIVE',
          readyToShip: true,
        },
      });
    }
  }
  console.log('✅ Remapped legacy products to active 3-tier hierarchy.');

  // 5. Seed / Upsert the 25 Admin Dark Store Products
  let seededCount = 0;
  for (const p of PRODUCTS_DATA) {
    const resolvedCatId = resolveCatId(p.categoryId, 'kurtis');
    const discountPct = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
    const discount = discountPct > 0 ? `${discountPct}% OFF` : '0% OFF';
    const hubId = hubMap.get(p.hubId) || 'hub-pozhichalur';

    const productRecord = await prisma.product.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        sku: p.sku,
        vendorId: officialVendor.id,
        categoryId: resolvedCatId,
        brand: p.brand,
        title: p.title,
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        discount,
        rating: 4.8,
        reviewsCount: 28,
        stockQuantity: p.stockQuantity,
        stockBadge: 'DARK STORE STOCK',
        listingStatus: 'ACTIVE',
        gender: p.gender,
        tags: p.tags,
        readyToShip: true,
        sizes: p.sizes,
        fabric: p.fabric,
        origin: p.origin,
        certification: p.certification,
        image: p.image,
        altText: `${p.title} in ${p.colorName}`,
        galleryImages: p.galleryImages,
        fulfillmentType: FulfillmentType.DARK_STORE,
        darkStoreHubId: hubId,
        tryAndBuyEligible: true,
        colorGroupId: `grp-${p.id}`,
        colorName: p.colorName,
        colorHex: p.colorHex,
        colors: p.colors as any,
        specifications: p.specifications as any,
      },
      update: {
        sku: p.sku,
        vendorId: officialVendor.id,
        categoryId: resolvedCatId,
        brand: p.brand,
        title: p.title,
        description: p.description,
        price: p.price,
        originalPrice: p.originalPrice,
        discount,
        stockQuantity: p.stockQuantity,
        stockBadge: 'DARK STORE STOCK',
        listingStatus: 'ACTIVE',
        gender: p.gender,
        tags: p.tags,
        readyToShip: true,
        sizes: p.sizes,
        fabric: p.fabric,
        origin: p.origin,
        certification: p.certification,
        image: p.image,
        altText: `${p.title} in ${p.colorName}`,
        galleryImages: p.galleryImages,
        fulfillmentType: FulfillmentType.DARK_STORE,
        darkStoreHubId: hubId,
        tryAndBuyEligible: true,
        colorName: p.colorName,
        colorHex: p.colorHex,
        colors: p.colors as any,
        specifications: p.specifications as any,
      },
    });

    // Upsert Dark Store Stock records for both Pozhichalur and Tambaram
    const targetHubs = ['hub-pozhichalur', 'hub-tambaram'];
    for (const hId of targetHubs) {
      if (hubMap.has(hId)) {
        await prisma.productStock.upsert({
          where: {
            productId_hubId: {
              productId: productRecord.id,
              hubId: hId,
            },
          },
          create: {
            productId: productRecord.id,
            hubId: hId,
            stockQuantity: p.stockQuantity,
          },
          update: {
            stockQuantity: p.stockQuantity,
          },
        });
      }
    }

    // Write audit record for admin product creation
    await prisma.auditLog.create({
      data: {
        userId: adminUser.id,
        userEmail: adminUser.email,
        userRole: 'ADMIN',
        action: 'PRODUCT_CREATED',
        entityType: 'Product',
        entityId: productRecord.id,
        details: JSON.stringify({
          title: productRecord.title,
          sku: productRecord.sku,
          price: productRecord.price,
          hubId,
          stock: productRecord.stockQuantity,
        }),
      },
    });

    seededCount++;
    console.log(`[${seededCount}/${PRODUCTS_DATA.length}] Upserted: ${productRecord.title} (${productRecord.price} INR)`);
  }

  // 6. Summary check
  const totalProducts = await prisma.product.count({ where: { listingStatus: 'ACTIVE' } });
  const darkStoreCount = await prisma.product.count({
    where: { fulfillmentType: 'DARK_STORE', listingStatus: 'ACTIVE' },
  });

  console.log('\n=========================================');
  console.log(`🎉 SUCCESS! Seeded ${seededCount} Admin Dark Store products.`);
  console.log(`📊 Total Active Products in DB: ${totalProducts}`);
  console.log(`⚡ Dark Store Products ready for 18m delivery: ${darkStoreCount}`);
  console.log('=========================================\n');
}

seedAdminDarkStoreProducts()
  .catch((err) => {
    console.error('❌ Seeding failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
