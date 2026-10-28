-- ============================================================================
-- Affordz / KudiCart Hierarchical Taxonomy Migration & Seed for Supabase
-- Inspired by Ajio & Myntra 3-Tier Category Architecture
-- (L1: Main Category / Department -> L2: Sub-Category -> L3: Sub-Sub-Category)
--
-- Instructions: Run this script directly in the Supabase Dashboard SQL Editor
-- ============================================================================

-- ============================================================================
-- Step 1: Ensure ALL Category Columns Exist (FIRST, before any UPDATE/INSERT)
-- ============================================================================
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "parentId" TEXT REFERENCES "Category"("id") ON DELETE CASCADE;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "countText" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "icon" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "banner" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isPopular" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ============================================================================
-- Step 2: Remove Legacy UNIQUE Constraint on "name"
-- ============================================================================
-- In an e-commerce taxonomy (like Myntra & Ajio), category names naturally repeat
-- across levels (e.g. L1 Footwear vs L2 Footwear; L3 T-Shirts under Men vs Kids).
-- The authoritative unique key is 'slug' and 'id', NOT 'name'.
ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS "Category_name_key" CASCADE;
DROP INDEX IF EXISTS "Category_name_key" CASCADE;

-- Also dynamically drop any other unique constraints on the 'name' column if present
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = '"Category"'::regclass
          AND c.contype = 'u'
          AND a.attname = 'name'
    ) LOOP
        EXECUTE 'ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname) || ' CASCADE;';
    END LOOP;

    FOR r IN (
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'Category'
          AND indexdef LIKE '%(name)%'
          AND indexdef LIKE '%UNIQUE%'
    ) LOOP
        EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(r.indexname) || ' CASCADE;';
    END LOOP;
END $$;

-- Rename legacy cat-6 if it exists to avoid confusion
UPDATE "Category" 
SET "name" = 'Footwear Studio', "slug" = 'legacy-footwear-studio' 
WHERE "id" = 'cat-6';

-- Populate fallback slugs for any existing legacy categories where slug is null
UPDATE "Category" SET "slug" = 'cat-' || "id" WHERE "slug" IS NULL;

-- Create Indexes for blazing-fast category browsing & filtering
CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category"("slug");
CREATE INDEX IF NOT EXISTS "Category_parentId_idx" ON "Category"("parentId");
CREATE INDEX IF NOT EXISTS "Category_level_idx" ON "Category"("level");
CREATE INDEX IF NOT EXISTS "Category_gender_idx" ON "Category"("gender");

-- ============================================================================
-- Step 3: Seed Level 1 (Main Categories / Departments)
-- ============================================================================
INSERT INTO "Category" ("id", "name", "slug", "level", "parentId", "countText", "icon", "image", "banner", "gender", "displayOrder", "isActive", "isPopular", "createdAt", "updatedAt")
VALUES
('cat-women', 'Women', 'women', 1, NULL, '4,850+ styles', 'Sparkles', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1200&q=80', 'Women', 1, true, true, NOW(), NOW()),
('cat-men', 'Men', 'men', 1, NULL, '3,420+ styles', 'Shirt', 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?auto=format&fit=crop&w=1200&q=80', 'Men', 2, true, true, NOW(), NOW()),
('cat-kids', 'Kids', 'kids', 1, NULL, '1,890+ styles', 'Smile', 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1471286174890-9c112ffca564?auto=format&fit=crop&w=1200&q=80', 'Kids', 3, true, false, NOW(), NOW()),
('cat-footwear', 'Footwear', 'footwear', 1, NULL, '2,140+ styles', 'Footprints', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1556906781-9a412961c28c?auto=format&fit=crop&w=1200&q=80', 'Unisex', 4, true, true, NOW(), NOW()),
('cat-beauty', 'Beauty & Grooming', 'beauty', 1, NULL, '920+ essentials', 'Gem', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1200&q=80', 'Women', 5, true, false, NOW(), NOW()),
('cat-accessories', 'Bags & Accessories', 'accessories', 1, NULL, '1,320+ items', 'ShoppingBag', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80', 'Unisex', 6, true, false, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "level" = EXCLUDED."level",
  "countText" = EXCLUDED."countText",
  "icon" = EXCLUDED."icon",
  "image" = EXCLUDED."image",
  "banner" = EXCLUDED."banner",
  "gender" = EXCLUDED."gender",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = NOW();

-- ============================================================================
-- Step 4: Seed Level 2 (Sub-Categories)
-- ============================================================================

-- Under Women
INSERT INTO "Category" ("id", "name", "slug", "level", "parentId", "countText", "icon", "image", "banner", "gender", "displayOrder", "isActive", "isPopular", "createdAt", "updatedAt")
VALUES
('sub-women-ethnic', 'Indian & Fusion Wear', 'women-ethnic', 2, 'cat-women', '1,820+ styles', 'Crown', 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=1000&q=80', 'Women', 1, true, true, NOW(), NOW()),
('sub-women-western', 'Western Wear', 'women-western', 2, 'cat-women', '1,450+ styles', 'Layers', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1485230895905-ec40ba36b9bc?auto=format&fit=crop&w=1000&q=80', 'Women', 2, true, true, NOW(), NOW()),
('sub-women-footwear', 'Women''s Footwear', 'women-footwear', 2, 'cat-women', '680+ styles', 'Footprints', 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=600&q=80', NULL, 'Women', 3, true, false, NOW(), NOW()),
('sub-women-lingerie', 'Lingerie & Loungewear', 'women-lingerie', 2, 'cat-women', '420+ styles', 'Heart', 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=600&q=80', NULL, 'Women', 4, true, false, NOW(), NOW()),
('sub-women-bags', 'Handbags & Clutches', 'women-bags', 2, 'cat-women', '480+ styles', 'ShoppingBag', 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=600&q=80', NULL, 'Women', 5, true, true, NOW(), NOW()),

-- Under Men
('sub-men-topwear', 'Topwear', 'men-topwear', 2, 'cat-men', '1,280+ styles', 'Shirt', 'https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1000&q=80', 'Men', 1, true, true, NOW(), NOW()),
('sub-men-bottomwear', 'Bottomwear', 'men-bottomwear', 2, 'cat-men', '890+ styles', 'Sliders', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=600&q=80', 'https://images.unsplash.com/photo-1475178626620-a4d074967452?auto=format&fit=crop&w=1000&q=80', 'Men', 2, true, true, NOW(), NOW()),
('sub-men-footwear', 'Men''s Footwear', 'men-footwear', 2, 'cat-men', '720+ styles', 'Footprints', 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=600&q=80', NULL, 'Men', 3, true, true, NOW(), NOW()),
('sub-men-ethnic', 'Ethnic & Festive Wear', 'men-ethnic', 2, 'cat-men', '310+ styles', 'Crown', 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=600&q=80', NULL, 'Men', 4, true, false, NOW(), NOW()),
('sub-men-innerwear', 'Innerwear & Loungewear', 'men-innerwear', 2, 'cat-men', '220+ styles', 'Package', 'https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=600&q=80', NULL, 'Men', 5, true, false, NOW(), NOW()),

-- Under Kids
('sub-kids-boys', 'Boys Clothing', 'kids-boys', 2, 'cat-kids', '780+ styles', 'Smile', 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=600&q=80', NULL, 'Kids', 1, true, true, NOW(), NOW()),
('sub-kids-girls', 'Girls Clothing', 'kids-girls', 2, 'cat-kids', '820+ styles', 'Sparkles', 'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=600&q=80', NULL, 'Kids', 2, true, true, NOW(), NOW()),
('sub-kids-infants', 'Infants & Toddlers', 'kids-infants', 2, 'cat-kids', '290+ styles', 'Baby', 'https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=600&q=80', NULL, 'Kids', 3, true, false, NOW(), NOW()),

-- Under Footwear Department
('sub-footwear-sneakers', 'Sneakers & Casuals', 'footwear-sneakers', 2, 'cat-footwear', '940+ styles', 'Footprints', 'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=600&q=80', NULL, 'Unisex', 1, true, true, NOW(), NOW()),
('sub-footwear-formal', 'Formal & Office Shoes', 'footwear-formal', 2, 'cat-footwear', '460+ styles', 'Briefcase', 'https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?auto=format&fit=crop&w=600&q=80', NULL, 'Unisex', 2, true, false, NOW(), NOW()),
('sub-footwear-ethnic', 'Handcrafted Juttis', 'footwear-ethnic', 2, 'cat-footwear', '380+ styles', 'Crown', 'https://images.unsplash.com/photo-1535043934128-cf0b28d52f95?auto=format&fit=crop&w=600&q=80', NULL, 'Unisex', 3, true, true, NOW(), NOW()),

-- Under Beauty Department
('sub-beauty-skincare', 'Skincare Atelier', 'beauty-skincare', 2, 'cat-beauty', '440+ products', 'Sparkles', 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80', NULL, 'Women', 1, true, true, NOW(), NOW()),
('sub-beauty-fragrance', 'Artisan Fragrances', 'beauty-fragrance', 2, 'cat-beauty', '280+ products', 'Gem', 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=600&q=80', NULL, 'Unisex', 2, true, true, NOW(), NOW()),

-- Under Accessories Department
('sub-acc-bags', 'Designer Bags & Totes', 'acc-bags', 2, 'cat-accessories', '640+ items', 'ShoppingBag', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=600&q=80', NULL, 'Unisex', 1, true, true, NOW(), NOW()),
('sub-acc-jewels', 'Minimalist Jewellery', 'acc-jewels', 2, 'cat-accessories', '420+ items', 'Gem', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80', NULL, 'Women', 2, true, true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "level" = EXCLUDED."level",
  "parentId" = EXCLUDED."parentId",
  "countText" = EXCLUDED."countText",
  "icon" = EXCLUDED."icon",
  "image" = EXCLUDED."image",
  "banner" = EXCLUDED."banner",
  "gender" = EXCLUDED."gender",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = NOW();

-- ============================================================================
-- Step 5: Seed Level 3 (Sub-Sub-Categories / Leaf Product Types)
-- ============================================================================

-- Leaf categories under Women > Indian & Fusion Wear
INSERT INTO "Category" ("id", "name", "slug", "level", "parentId", "countText", "icon", "image", "gender", "displayOrder", "isActive", "isPopular", "createdAt", "updatedAt")
VALUES
('leaf-women-kurtas', 'Kurtas & Kurtis', 'women-kurtas', 3, 'sub-women-ethnic', '420+ styles', 'Shirt', 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=400&q=80', 'Women', 1, true, true, NOW(), NOW()),
('leaf-women-kurtasets', 'Kurta Sets & Suits', 'women-kurtasets', 3, 'sub-women-ethnic', '580+ styles', 'Sparkles', 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=80', 'Women', 2, true, true, NOW(), NOW()),
('leaf-women-sarees', 'Handloom Sarees', 'women-sarees', 3, 'sub-women-ethnic', '380+ styles', 'Crown', 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=400&q=80', 'Women', 3, true, true, NOW(), NOW()),
('leaf-women-anarkali', 'Anarkali Sets', 'women-anarkali', 3, 'sub-women-ethnic', '240+ styles', 'Star', 'https://images.unsplash.com/photo-1609357605129-26f69add5d6e?auto=format&fit=crop&w=400&q=80', 'Women', 4, true, false, NOW(), NOW()),
('leaf-women-palazzos', 'Palazzos & Skirts', 'women-palazzos', 3, 'sub-women-ethnic', '180+ styles', 'Layers', 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=400&q=80', 'Women', 5, true, false, NOW(), NOW()),
('leaf-women-dupattas', 'Dupattas & Shawls', 'women-dupattas', 3, 'sub-women-ethnic', '140+ styles', 'Sparkles', 'https://images.unsplash.com/photo-1605289982774-9a6fef564df8?auto=format&fit=crop&w=400&q=80', 'Women', 6, true, false, NOW(), NOW()),

-- Leaf categories under Women > Western Wear
('leaf-women-dresses', 'Dresses & Jumpsuits', 'women-dresses', 3, 'sub-women-western', '490+ styles', 'Heart', 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=400&q=80', 'Women', 1, true, true, NOW(), NOW()),
('leaf-women-tops', 'Tops & Tees', 'women-tops', 3, 'sub-women-western', '360+ styles', 'Shirt', 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=400&q=80', 'Women', 2, true, true, NOW(), NOW()),
('leaf-women-jeans', 'Jeans & Jeggings', 'women-jeans', 3, 'sub-women-western', '280+ styles', 'Sliders', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=400&q=80', 'Women', 3, true, true, NOW(), NOW()),
('leaf-women-trousers', 'Trousers & Chinos', 'women-trousers', 3, 'sub-women-western', '220+ styles', 'Sliders', 'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?auto=format&fit=crop&w=400&q=80', 'Women', 4, true, false, NOW(), NOW()),
('leaf-women-jackets', 'Blazers & Jackets', 'women-jackets', 3, 'sub-women-western', '150+ styles', 'Package', 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=400&q=80', 'Women', 5, true, false, NOW(), NOW()),

-- Leaf categories under Men > Topwear
('leaf-men-tshirts', 'T-Shirts (Crew & Oversized)', 'men-tshirts', 3, 'sub-men-topwear', '520+ styles', 'Shirt', 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=400&q=80', 'Men', 1, true, true, NOW(), NOW()),
('leaf-men-casualshirts', 'Casual Shirts', 'men-casualshirts', 3, 'sub-men-topwear', '390+ styles', 'Shirt', 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=400&q=80', 'Men', 2, true, true, NOW(), NOW()),
('leaf-men-formalshirts', 'Formal Dress Shirts', 'men-formalshirts', 3, 'sub-men-topwear', '210+ styles', 'Briefcase', 'https://images.unsplash.com/photo-1620012253295-c15c429f66bf?auto=format&fit=crop&w=400&q=80', 'Men', 3, true, false, NOW(), NOW()),
('leaf-men-polos', 'Polo T-Shirts', 'men-polos', 3, 'sub-men-topwear', '160+ styles', 'Shirt', 'https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?auto=format&fit=crop&w=400&q=80', 'Men', 4, true, false, NOW(), NOW()),
('leaf-men-hoodies', 'Sweatshirts & Hoodies', 'men-hoodies', 3, 'sub-men-topwear', '180+ styles', 'Layers', 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=400&q=80', 'Men', 5, true, true, NOW(), NOW()),

-- Leaf categories under Men > Bottomwear
('leaf-men-jeans', 'Selvedge Denim Jeans', 'men-jeans', 3, 'sub-men-bottomwear', '340+ styles', 'Sliders', 'https://images.unsplash.com/photo-1542272604-780c96856592?auto=format&fit=crop&w=400&q=80', 'Men', 1, true, true, NOW(), NOW()),
('leaf-men-trousers', 'Casual Trousers & Chinos', 'men-trousers', 3, 'sub-men-bottomwear', '260+ styles', 'Sliders', 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=400&q=80', 'Men', 2, true, true, NOW(), NOW()),
('leaf-men-trackpants', 'Track Pants & Joggers', 'men-trackpants', 3, 'sub-men-bottomwear', '190+ styles', 'Layers', 'https://images.unsplash.com/photo-1552902865-b72c031ac5ea?auto=format&fit=crop&w=400&q=80', 'Men', 3, true, false, NOW(), NOW()),
('leaf-men-shorts', 'Cargo & Casual Shorts', 'men-shorts', 3, 'sub-men-bottomwear', '140+ styles', 'Scissors', 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=400&q=80', 'Men', 4, true, false, NOW(), NOW()),

-- Leaf categories under Men > Footwear
('leaf-men-sneakers', 'Court Leather Sneakers', 'men-sneakers', 3, 'sub-men-footwear', '310+ styles', 'Footprints', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=400&q=80', 'Men', 1, true, true, NOW(), NOW()),
('leaf-men-formalshoes', 'Derby & Oxford Shoes', 'men-formalshoes', 3, 'sub-men-footwear', '180+ styles', 'Briefcase', 'https://images.unsplash.com/photo-1614252235316-8c857d38b5f4?auto=format&fit=crop&w=400&q=80', 'Men', 2, true, false, NOW(), NOW()),
('leaf-men-loafers', 'Loafers & Slip-Ons', 'men-loafers', 3, 'sub-men-footwear', '150+ styles', 'Footprints', 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?auto=format&fit=crop&w=400&q=80', 'Men', 3, true, false, NOW(), NOW()),

-- Leaf categories under Kids > Boys
('leaf-boys-tshirts', 'Boys T-Shirts & Polos', 'boys-tshirts', 3, 'sub-kids-boys', '280+ styles', 'Shirt', 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?auto=format&fit=crop&w=400&q=80', 'Kids', 1, true, true, NOW(), NOW()),
('leaf-boys-jeans', 'Boys Jeans & Joggers', 'boys-jeans', 3, 'sub-kids-boys', '190+ styles', 'Sliders', 'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=400&q=80', 'Kids', 2, true, false, NOW(), NOW()),

-- Leaf categories under Kids > Girls
('leaf-girls-dresses', 'Girls Dresses & Frocks', 'girls-dresses', 3, 'sub-kids-girls', '340+ styles', 'Heart', 'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?auto=format&fit=crop&w=400&q=80', 'Kids', 1, true, true, NOW(), NOW()),
('leaf-girls-tops', 'Girls Tops & Skirts', 'girls-tops', 3, 'sub-kids-girls', '210+ styles', 'Sparkles', 'https://images.unsplash.com/photo-1471286174890-9c112ffca564?auto=format&fit=crop&w=400&q=80', 'Kids', 2, true, false, NOW(), NOW()),

-- Leaf categories under Beauty > Skincare
('leaf-beauty-serums', 'Face Serums & Oils', 'beauty-serums', 3, 'sub-beauty-skincare', '160+ items', 'Sparkles', 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=400&q=80', 'Women', 1, true, true, NOW(), NOW()),
('leaf-beauty-cleansers', 'Gentle Cleansers', 'beauty-cleansers', 3, 'sub-beauty-skincare', '120+ items', 'Droplet', 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80', 'Women', 2, true, false, NOW(), NOW()),
('leaf-beauty-fragrance', 'Artisan Eau de Parfum', 'beauty-fragrances', 3, 'sub-beauty-fragrance', '190+ items', 'Gem', 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=400&q=80', 'Unisex', 1, true, true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "level" = EXCLUDED."level",
  "parentId" = EXCLUDED."parentId",
  "countText" = EXCLUDED."countText",
  "icon" = EXCLUDED."icon",
  "image" = EXCLUDED."image",
  "gender" = EXCLUDED."gender",
  "displayOrder" = EXCLUDED."displayOrder",
  "updatedAt" = NOW();

-- ============================================================================
-- Step 6: Legacy Data Migration (Safely reassign old cat-6 to cat-footwear)
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Product') THEN
        UPDATE "Product" SET "categoryId" = 'cat-footwear' WHERE "categoryId" = 'cat-6';
    END IF;
    -- Remove old duplicate cat-6 now that cat-footwear is seeded and active
    DELETE FROM "Category" WHERE "id" = 'cat-6';
END $$;

-- ============================================================================
-- Step 7: Verification Query
-- ============================================================================
-- Run this query to inspect your 3-tier taxonomy tree:
SELECT 
    c1.name AS "Department (L1)",
    c2.name AS "SubCategory (L2)",
    c3.name AS "SubSubCategory (L3)"
FROM "Category" c1
LEFT JOIN "Category" c2 ON c2."parentId" = c1."id"
LEFT JOIN "Category" c3 ON c3."parentId" = c2."id"
WHERE c1."level" = 1
ORDER BY c1."displayOrder", c2."displayOrder", c3."displayOrder";
