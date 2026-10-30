-- Affordz / KudiCart Initial Seed Data for Supabase PostgreSQL
-- Copy & Paste into Supabase Dashboard -> SQL Editor -> Click 'Run'

-- 1. Dark Store Hubs
INSERT INTO "DarkStoreHub" ("id", "name", "locality", "address", "lat", "lng", "deliveryMinutes", "isActive", "createdAt", "updatedAt")
VALUES
('hub-1', 'Indiranagar Express Pod', 'Indiranagar 100ft Road', 'Pod #4, Metro Pillar 128, 100ft Road, Indiranagar, Bengaluru, 560038', 12.9716, 77.6412, 18, true, NOW(), NOW()),
('hub-2', 'Koramangala 4th Block Hub', 'Koramangala 4th Block', 'Hub #2, 80ft Road, Sony Signal, Koramangala 4th Block, Bengaluru, 560034', 12.9352, 77.6245, 20, true, NOW(), NOW()),
('hub-3', 'Whitefield Prestige Tech Pod', 'Whitefield', 'Pod #7, ECC Road, Near ITPL, Whitefield, Bengaluru, 560066', 12.9698, 77.7500, 22, true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 2. Users
INSERT INTO "User" ("id", "firebaseUid", "phone", "email", "name", "avatar", "role", "createdAt", "updatedAt")
VALUES
('usr-1', 'fb-user-123', '+91 98450 12890', 'customer@affordz.in', 'Ananya Sharma', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', 'CUSTOMER', NOW(), NOW()),
('usr-driver-1', 'fb-driver-123', '+91 98765 43210', 'rajesh.driver@affordz.in', 'Rajesh Kumar', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', 'DRIVER', NOW(), NOW()),
('usr-vendor-1', 'fb-vendor-123', '+91 80 4123 9988', 'vendor.avanya@affordz.in', 'Meera Deshmukh', NULL, 'VENDOR', NOW(), NOW()),
('usr-admin-1', 'fb-admin-123', '+91 99999 00000', 'admin@affordz.in', 'Affordz Operations Admin', NULL, 'ADMIN', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 3. Vendor
INSERT INTO "Vendor" ("id", "userId", "storeName", "createdAt", "updatedAt")
VALUES
('vend-1', 'usr-vendor-1', 'Avanya Haute Atelier', NOW(), NOW()),
('vend-affordz-official', 'usr-admin-1', 'Affordz Official Store', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 4. Customer Address
INSERT INTO "Address" ("id", "userId", "label", "line1", "locality", "city", "isDefault", "createdAt", "updatedAt")
VALUES
('addr-1', 'usr-1', 'Home', 'Apartment 402, Sunrise Heights, 4th Cross Road', 'Indiranagar Stage 2', 'Bengaluru', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 5. Categories
INSERT INTO "Category" ("id", "name", "countText", "icon", "createdAt", "updatedAt")
VALUES
('cat-1', 'Atelier Wear', '148 designs', 'Sparkles', NOW(), NOW()),
('cat-2', 'Formal Studio', '86 tailored pieces', 'Briefcase', NOW(), NOW()),
('cat-3', 'Evening Gala', '62 gowns & kurtas', 'Crown', NOW(), NOW()),
('cat-4', 'Casual Luxe', '112 essentials', 'Shirt', NOW(), NOW()),
('cat-5', 'Vault Accessories', '44 statement accents', 'Gem', NOW(), NOW()),
('cat-6', 'Footwear', '58 handcrafted pairs', 'Footprints', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 6. Products
INSERT INTO "Product" ("id", "vendorId", "categoryId", "brand", "title", "description", "price", "originalPrice", "discount", "rating", "reviewsCount", "stockQuantity", "stockBadge", "readyToShip", "sizes", "fabric", "origin", "image", "altText", "galleryImages", "fulfillmentType", "darkStoreHubId", "tryAndBuyEligible", "createdAt", "updatedAt")
VALUES
('prd-1', 'vend-1', 'cat-1', 'Avanya Atelier', 'Handloom Mulberry Silk Wrap Dress', 'Pure Mulberry silk dyed with non-toxic botanical indigo. Features relaxed silhouette with wrap closure and mother-of-pearl buttons.', 3499, 4999, '30% OFF', 4.8, 38, 12, 'DARK STORE STOCK', true, ARRAY['XS', 'S', 'M', 'L'], '100% Pure Mulberry Silk', 'Bengaluru Atelier, India', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80', 'Mulberry silk wrap dress in indigo hue', ARRAY['https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80'], 'DARK_STORE', 'hub-1', true, NOW(), NOW()),
('prd-2', 'vend-1', 'cat-1', 'Avanya Atelier', 'Khadi Organic Cotton Trench Jacket', 'Handwoven zero-carbon khadi trench with structured raglan sleeves, storm flap, and horn buttons. Wind and shower resistant.', 4899, 6999, '30% OFF', 4.9, 54, 8, 'LOW STOCK', true, ARRAY['S', 'M', 'L', 'XL'], '100% Hand-spun Khadi Cotton', 'Varanasi Weaving Collective, India', 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80', 'Organic khadi trench jacket on model', ARRAY['https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=80'], 'DARK_STORE', 'hub-1', true, NOW(), NOW()),
('prd-3', 'vend-1', 'cat-2', 'Raw Stitch Studio', 'Charcoal Wool Flannel Tailored Trousers', 'High-rise tapered trousers cut from Italian Super 110s wool flannel. Internal curtain waistband and horn side adjusters.', 2799, 3999, '30% OFF', 4.7, 29, 15, 'DARK STORE STOCK', true, ARRAY['28', '30', '32', '34'], 'Super 110s Wool Flannel', 'Biella Mill, Finished in Mumbai', 'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=800&q=80', 'Charcoal wool trousers with crisp pleats', ARRAY['https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=800&q=80'], 'DARK_STORE', 'hub-2', true, NOW(), NOW()),
('prd-4', 'vend-1', 'cat-3', 'Avanya Atelier', 'Zari-Embroidered Chanderi Kurta Set', 'Heirloom Chanderi silk kurta with delicate silver zari cord work around neck and cuffs. Paired with tonal silk trousers.', 5299, 7500, '29% OFF', 4.9, 42, 6, 'LOW STOCK', true, ARRAY['S', 'M', 'L'], 'Chanderi Silk Cotton Blend', 'Chanderi, Madhya Pradesh', 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80', 'Emerald zari embroidered festive kurta', ARRAY['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80'], 'VENDOR', NULL, false, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 7. Active Coupons
INSERT INTO "Coupon" ("id", "code", "discountType", "discountValue", "minOrderValue", "maxDiscount", "usageLimit", "usedCount", "startDate", "endDate", "isActive", "createdAt", "updatedAt")
VALUES
('cpn-1', 'AFFORDZ10', 'PERCENTAGE', 10, 999, 300, NULL, 0, NOW(), NOW() + INTERVAL '365 days', true, NOW(), NOW()),
('cpn-2', 'FIRSTDROP', 'FLAT', 200, 799, 200, NULL, 0, NOW(), NOW() + INTERVAL '365 days', true, NOW(), NOW()),
('cpn-3', 'VAULT50', 'FLAT', 50, 299, 50, NULL, 0, NOW(), NOW() + INTERVAL '365 days', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
