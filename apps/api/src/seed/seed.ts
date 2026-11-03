/* eslint-disable no-console */
/**
 * Development seed. Runs through the REAL services (ProductsService,
 * InventoryService, CartService, OrdersService) so SKUs, barcodes, ledger
 * movements, reservations and embeddings are produced by production code paths.
 *
 * Everything created here is clearly identifiable demo data:
 *   - customer emails end in @demo.vyra.local
 *   - product descriptions are illustrative copy, images are generated art
 * Run: pnpm db:seed   (idempotent guard: refuses to run twice unless SEED_FORCE=true)
 */
import 'reflect-metadata';
import { randomUUID, randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { ProductInput, RoleName } from '@vyra/shared';

process.env.QUEUES_ENABLED = process.env.SEED_USE_QUEUE === 'true' ? 'true' : 'false';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'development';

import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../modules/auth/auth.service';
import { ProductsService } from '../modules/products/products.service';
import { InventoryService } from '../modules/inventory/inventory.service';
import { MediaService } from '../modules/media/media.service';
import { CartService } from '../modules/carts/cart.service';
import { OrdersService } from '../modules/orders/orders.service';
import { EmbeddingService } from '../modules/ai/embedding.service';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../modules/roles/permissions';
import { garmentSvg, type GarmentKind } from './garments';

type Cat = { name: string; slug: string; code: string; description: string; children?: Cat[] };
const CATEGORIES: Cat[] = [
  { name: 'Men', slug: 'men', code: 'MEN', description: 'Everyday staples to statement fits for men.', children: [
    { name: 'T-Shirts', slug: 'men-tshirts', code: 'TSH', description: 'Oversized, regular and graphic tees.' },
    { name: 'Shirts', slug: 'men-shirts', code: 'SHT', description: 'Casual and formal shirts.' },
    { name: 'Jeans', slug: 'men-jeans', code: 'JNS', description: 'Slim, straight and relaxed denim.' },
    { name: 'Trousers', slug: 'men-trousers', code: 'TRS', description: 'Chinos and formal trousers.' },
    { name: 'Ethnic Wear', slug: 'men-ethnic', code: 'ETH', description: 'Kurtas for festive and everyday wear.' },
    { name: 'Sportswear', slug: 'men-sportswear', code: 'SPT', description: 'Performance and athleisure.' },
    { name: 'Jackets & Hoodies', slug: 'men-jackets', code: 'JKT', description: 'Layers for every season.' },
  ] },
  { name: 'Women', slug: 'women', code: 'WMN', description: 'Fresh silhouettes and timeless classics for women.', children: [
    { name: 'Dresses', slug: 'women-dresses', code: 'DRS', description: 'Midi, maxi and mini dresses.' },
    { name: 'Tops', slug: 'women-tops', code: 'TOP', description: 'Tees, crops and blouses.' },
    { name: 'Kurtas & Kurtis', slug: 'women-kurtas', code: 'KRT', description: 'Ethnic wear for every occasion.' },
    { name: 'Jeans & Trousers', slug: 'women-jeans', code: 'WJN', description: 'Denim and tailored bottoms.' },
    { name: 'Activewear', slug: 'women-activewear', code: 'WSP', description: 'Move in comfort.' },
  ] },
  { name: 'Kids', slug: 'kids', code: 'KID', description: 'Playful, comfy clothing for kids.', children: [
    { name: 'Boys', slug: 'kids-boys', code: 'BOY', description: 'Tees, shorts and more for boys.' },
    { name: 'Girls', slug: 'kids-girls', code: 'GRL', description: 'Dresses, tops and more for girls.' },
  ] },
  { name: 'Accessories', slug: 'accessories', code: 'ACC', description: 'Finish the look.', children: [
    { name: 'Caps', slug: 'accessories-caps', code: 'CAP', description: 'Baseball and dad caps.' },
    { name: 'Bags', slug: 'accessories-bags', code: 'BAG', description: 'Totes and backpacks.' },
  ] },
];

const COLORS: Record<string, string> = {
  Black: '#1F1F1F', White: '#F5F5F2', Navy: '#1E2A4A', Olive: '#5B6B3A', Maroon: '#7A1F2B', Beige: '#D9C7A7', Grey: '#8A8D91', Blue: '#2F5DA8',
  Pink: '#F28AA5', Lavender: '#B9A6E0', Mustard: '#D9A21B', Teal: '#16A085', Red: '#C8313B', Green: '#2E7D4F', Cream: '#F1E7D0', Indigo: '#2C3E73', Brown: '#7B5235', Yellow: '#F2C94C',
};

const ALPHA = ['S', 'M', 'L', 'XL'];
const ALPHA_W = ['XS', 'S', 'M', 'L', 'XL'];
const WAIST = ['28', '30', '32', '34', '36'];
const KIDS = ['4', '6', '8', '10', '12'];

interface Def {
  name: string; cat: string; gender: ProductInput['gender']; kind: GarmentKind; colors: string[]; sizes: string[]; mrp: number; price: number;
  fabric: string; fit: string; occasion: string; tags: string[]; desc: string; featured?: boolean; extra?: Record<string, string>;
}

const D: Def[] = [
  { name: 'Oversized Heavyweight Cotton Tee', cat: 'men-tshirts', gender: 'MEN', kind: 'tshirt', colors: ['Black', 'White', 'Olive'], sizes: ALPHA, mrp: 1299, price: 699, fabric: '100% Cotton', fit: 'Oversized', occasion: 'Casual', tags: ['oversized', 'streetwear', 'summer', 'breathable'], desc: 'A 240 GSM combed-cotton tee with dropped shoulders and a boxy, relaxed silhouette. Breathable enough for Indian summers, structured enough to hold its shape wash after wash.', featured: true },
  { name: 'Essential Crew Neck Tee', cat: 'men-tshirts', gender: 'MEN', kind: 'tshirt', colors: ['Navy', 'Grey', 'Maroon', 'White'], sizes: ALPHA, mrp: 799, price: 449, fabric: '100% Cotton', fit: 'Regular', occasion: 'Casual', tags: ['basics', 'everyday', 'soft'], desc: 'Our everyday crew-neck in soft bio-washed cotton. A clean regular fit that works under a shirt or on its own.' },
  { name: 'Graphic Print Relaxed Tee', cat: 'men-tshirts', gender: 'MEN', kind: 'tshirt', colors: ['White', 'Black'], sizes: ALPHA, mrp: 999, price: 599, fabric: '100% Cotton', fit: 'Relaxed', occasion: 'Casual', tags: ['graphic', 'streetwear', 'printed'], desc: 'Relaxed-fit cotton tee with an original VYRA back print. Puff-print ink that stays soft and crack-resistant.', extra: { pattern: 'Graphic' } },
  { name: 'Linen Blend Resort Shirt', cat: 'men-shirts', gender: 'MEN', kind: 'shirt', colors: ['Beige', 'White', 'Blue'], sizes: ALPHA, mrp: 2199, price: 1399, fabric: 'Linen Cotton Blend', fit: 'Relaxed', occasion: 'Vacation', tags: ['linen', 'summer', 'breathable', 'resort'], desc: 'A breezy linen-cotton camp-collar shirt made for hot afternoons and beach evenings. Lightweight, airy and naturally textured.', featured: true },
  { name: 'Oxford Button-Down Shirt', cat: 'men-shirts', gender: 'MEN', kind: 'shirt', colors: ['White', 'Blue', 'Pink'], sizes: ALPHA, mrp: 1999, price: 1199, fabric: '100% Cotton', fit: 'Slim', occasion: 'Office', tags: ['formal', 'office', 'classic'], desc: 'Classic Oxford weave with a button-down collar. Crisp enough for the office, soft enough for the weekend.' },
  { name: 'Slim Fit Stretch Jeans', cat: 'men-jeans', gender: 'MEN', kind: 'jeans', colors: ['Indigo', 'Black'], sizes: WAIST, mrp: 2499, price: 1499, fabric: 'Cotton Elastane Denim', fit: 'Slim', occasion: 'Casual', tags: ['denim', 'stretch', 'everyday'], desc: 'Mid-rise slim jeans in 2% stretch denim that moves with you. Five-pocket styling, durable rivets.' },
  { name: 'Relaxed Straight Jeans', cat: 'men-jeans', gender: 'MEN', kind: 'jeans', colors: ['Blue', 'Grey'], sizes: WAIST, mrp: 2699, price: 1799, fabric: '100% Cotton Denim', fit: 'Relaxed', occasion: 'Casual', tags: ['denim', 'straight', 'vintage wash'], desc: 'A roomy straight leg with a vintage wash. Rigid cotton denim that breaks in beautifully.' },
  { name: 'Stretch Cotton Chinos', cat: 'men-trousers', gender: 'MEN', kind: 'trousers', colors: ['Beige', 'Navy', 'Olive'], sizes: WAIST, mrp: 1999, price: 1199, fabric: 'Cotton Elastane', fit: 'Slim', occasion: 'Office', tags: ['chinos', 'smart casual', 'office'], desc: 'Smart chinos with a hint of stretch. Tapered leg, clean front, ready for meetings and dinners alike.' },
  { name: 'Festive Silk Blend Kurta', cat: 'men-ethnic', gender: 'MEN', kind: 'kurta', colors: ['Maroon', 'Cream', 'Mustard'], sizes: ALPHA, mrp: 2999, price: 1899, fabric: 'Silk Blend', fit: 'Regular', occasion: 'Festive', tags: ['ethnic', 'festive', 'wedding', 'diwali'], desc: 'A lustrous silk-blend kurta with a mandarin collar and concealed placket. Made for Diwali, weddings and every celebration in between.', featured: true },
  { name: 'Everyday Cotton Kurta', cat: 'men-ethnic', gender: 'MEN', kind: 'kurta', colors: ['White', 'Navy'], sizes: ALPHA, mrp: 1599, price: 899, fabric: '100% Cotton', fit: 'Regular', occasion: 'Casual', tags: ['ethnic', 'cotton', 'summer'], desc: 'A breathable cotton kurta for daily wear. Side slits, a relaxed cut and a soft hand-feel.' },
  { name: 'DryFit Training Tee', cat: 'men-sportswear', gender: 'MEN', kind: 'tshirt', colors: ['Black', 'Teal', 'Grey'], sizes: ALPHA, mrp: 1199, price: 649, fabric: 'Polyester', fit: 'Athletic', occasion: 'Sports', tags: ['gym', 'running', 'quick dry', 'sports'], desc: 'Moisture-wicking, quick-dry training tee with mesh ventilation zones. Built for the gym, the track and humid mornings.' },
  { name: 'Tapered Training Joggers', cat: 'men-sportswear', gender: 'MEN', kind: 'joggers', colors: ['Black', 'Navy'], sizes: ALPHA, mrp: 1799, price: 999, fabric: 'Polyester Spandex', fit: 'Tapered', occasion: 'Sports', tags: ['joggers', 'gym', 'athleisure'], desc: 'Four-way stretch joggers with zip pockets and ribbed cuffs. Gym to grocery run.' },
  { name: 'Fleece Pullover Hoodie', cat: 'men-jackets', gender: 'MEN', kind: 'hoodie', colors: ['Grey', 'Black', 'Olive'], sizes: ALPHA, mrp: 2499, price: 1499, fabric: 'Cotton Fleece', fit: 'Relaxed', occasion: 'Casual', tags: ['hoodie', 'winter', 'cozy'], desc: 'Brushed-back fleece hoodie with a double-layer hood and kangaroo pocket. Your winter uniform.' },
  { name: 'Utility Denim Jacket', cat: 'men-jackets', gender: 'MEN', kind: 'jacket', colors: ['Blue', 'Black'], sizes: ALPHA, mrp: 3499, price: 2299, fabric: '100% Cotton Denim', fit: 'Regular', occasion: 'Casual', tags: ['jacket', 'denim', 'layering'], desc: 'A classic trucker jacket with utility pockets. Layers over tees and hoodies through the cooler months.' },
  { name: 'Floral Tiered Midi Dress', cat: 'women-dresses', gender: 'WOMEN', kind: 'dress', colors: ['Pink', 'Lavender', 'Yellow'], sizes: ALPHA_W, mrp: 2499, price: 1499, fabric: 'Viscose Rayon', fit: 'Flared', occasion: 'Party', tags: ['floral', 'midi', 'summer', 'brunch'], desc: 'A flowy tiered midi in soft viscose with a smocked back for an easy fit. Perfect for brunches and summer evenings.', featured: true, extra: { pattern: 'Floral' } },
  { name: 'Ribbed Bodycon Dress', cat: 'women-dresses', gender: 'WOMEN', kind: 'dress', colors: ['Black', 'Maroon'], sizes: ALPHA_W, mrp: 1999, price: 1199, fabric: 'Cotton Spandex Rib', fit: 'Bodycon', occasion: 'Party', tags: ['bodycon', 'evening', 'party'], desc: 'A sculpting ribbed knit dress with a square neckline. Dress it up with heels or down with sneakers.' },
  { name: 'Linen Shirt Dress', cat: 'women-dresses', gender: 'WOMEN', kind: 'dress', colors: ['Beige', 'White', 'Olive'], sizes: ALPHA_W, mrp: 2799, price: 1799, fabric: 'Linen Blend', fit: 'Relaxed', occasion: 'Office', tags: ['linen', 'office', 'breathable'], desc: 'A relaxed belted shirt dress in breathable linen blend. Polished for work, easy for weekends.' },
  { name: 'Boxy Cropped Tee', cat: 'women-tops', gender: 'WOMEN', kind: 'top', colors: ['White', 'Black', 'Lavender', 'Pink'], sizes: ALPHA_W, mrp: 899, price: 499, fabric: '100% Cotton', fit: 'Boxy', occasion: 'Casual', tags: ['crop', 'oversized', 'summer', 'basics'], desc: 'A boxy cropped tee in heavyweight cotton. Pair it with high-rise jeans or a flowy skirt.' },
  { name: 'Satin Wrap Blouse', cat: 'women-tops', gender: 'WOMEN', kind: 'top', colors: ['Cream', 'Maroon', 'Teal'], sizes: ALPHA_W, mrp: 1799, price: 1099, fabric: 'Satin', fit: 'Regular', occasion: 'Office', tags: ['satin', 'office', 'evening'], desc: 'Fluid satin wrap blouse with a tie waist. Transitions effortlessly from desk to dinner.' },
  { name: 'Printed Straight Kurta', cat: 'women-kurtas', gender: 'WOMEN', kind: 'kurta', colors: ['Teal', 'Mustard', 'Pink'], sizes: ALPHA_W, mrp: 1899, price: 999, fabric: '100% Cotton', fit: 'Straight', occasion: 'Casual', tags: ['ethnic', 'printed', 'everyday', 'cotton'], desc: 'A block-print-inspired straight cotton kurta with three-quarter sleeves. Breathable everyday ethnic wear.', featured: true, extra: { pattern: 'Printed' } },
  { name: 'Embroidered Anarkali Kurta', cat: 'women-kurtas', gender: 'WOMEN', kind: 'dress', colors: ['Maroon', 'Navy', 'Green'], sizes: ALPHA_W, mrp: 3999, price: 2499, fabric: 'Georgette', fit: 'Flared', occasion: 'Festive', tags: ['ethnic', 'festive', 'wedding', 'embroidered'], desc: 'A flared georgette Anarkali with thread embroidery at the yoke. Festive-ready with a lightweight drape.', extra: { pattern: 'Embroidered' } },
  { name: 'High Rise Mom Jeans', cat: 'women-jeans', gender: 'WOMEN', kind: 'jeans', colors: ['Blue', 'Black'], sizes: ['26', '28', '30', '32', '34'], mrp: 2299, price: 1399, fabric: '100% Cotton Denim', fit: 'Relaxed', occasion: 'Casual', tags: ['denim', 'high rise', 'mom fit'], desc: 'High-rise mom jeans with a relaxed thigh and tapered ankle. Vintage-inspired rigid denim.' },
  { name: 'Wide Leg Pleated Trousers', cat: 'women-jeans', gender: 'WOMEN', kind: 'trousers', colors: ['Beige', 'Black', 'Brown'], sizes: ['26', '28', '30', '32', '34'], mrp: 2199, price: 1299, fabric: 'Poly Viscose', fit: 'Wide Leg', occasion: 'Office', tags: ['wide leg', 'tailored', 'office'], desc: 'Fluid wide-leg trousers with front pleats and a high waist. Tailored comfort for long days.' },
  { name: 'Seamless Sports Bra Top', cat: 'women-activewear', gender: 'WOMEN', kind: 'top', colors: ['Black', 'Lavender', 'Teal'], sizes: ALPHA_W, mrp: 1299, price: 749, fabric: 'Nylon Spandex', fit: 'Athletic', occasion: 'Sports', tags: ['gym', 'yoga', 'sports', 'seamless'], desc: 'Medium-support seamless sports top with removable pads. Sweat-wicking for yoga, HIIT and runs.' },
  { name: 'High Waist Yoga Joggers', cat: 'women-activewear', gender: 'WOMEN', kind: 'joggers', colors: ['Black', 'Grey', 'Pink'], sizes: ALPHA_W, mrp: 1599, price: 899, fabric: 'Cotton Spandex', fit: 'Tapered', occasion: 'Sports', tags: ['yoga', 'joggers', 'athleisure'], desc: 'A soft, high-waisted jogger with a wide yoga waistband. All-day comfort from studio to sofa.' },
  { name: 'Kids Dino Print Tee', cat: 'kids-boys', gender: 'KIDS', kind: 'tshirt', colors: ['Yellow', 'Blue', 'Green'], sizes: KIDS, mrp: 599, price: 349, fabric: '100% Cotton', fit: 'Regular', occasion: 'Casual', tags: ['kids', 'printed', 'playwear'], desc: 'Super-soft cotton tee with a playful dino print. Tag-free neck for sensitive skin.', extra: { pattern: 'Graphic' } },
  { name: 'Kids Pull-On Cotton Shorts', cat: 'kids-boys', gender: 'KIDS', kind: 'shorts', colors: ['Navy', 'Olive', 'Grey'], sizes: KIDS, mrp: 699, price: 399, fabric: '100% Cotton', fit: 'Regular', occasion: 'Casual', tags: ['kids', 'shorts', 'summer'], desc: 'Easy pull-on shorts with an elasticated waist and drawcord. Built for playgrounds.' },
  { name: 'Kids Festive Kurta', cat: 'kids-boys', gender: 'KIDS', kind: 'kurta', colors: ['Cream', 'Maroon'], sizes: KIDS, mrp: 1299, price: 799, fabric: 'Cotton Silk', fit: 'Regular', occasion: 'Festive', tags: ['kids', 'ethnic', 'festive'], desc: 'A comfortable cotton-silk kurta for little ones on festive days.' },
  { name: 'Girls Twirl Party Dress', cat: 'kids-girls', gender: 'KIDS', kind: 'dress', colors: ['Pink', 'Lavender', 'Yellow'], sizes: KIDS, mrp: 1499, price: 899, fabric: 'Cotton Tulle', fit: 'Flared', occasion: 'Party', tags: ['kids', 'party', 'dress'], desc: 'A twirl-worthy flared dress with a soft cotton lining and tulle overlay.' },
  { name: 'Girls Rainbow Hoodie', cat: 'kids-girls', gender: 'KIDS', kind: 'hoodie', colors: ['Pink', 'Teal'], sizes: KIDS, mrp: 1199, price: 699, fabric: 'Cotton Fleece', fit: 'Regular', occasion: 'Casual', tags: ['kids', 'hoodie', 'winter'], desc: 'Cozy fleece hoodie with a rainbow appliqué. Warm, soft and machine-washable.' },
  { name: 'Classic Cotton Baseball Cap', cat: 'accessories-caps', gender: 'UNISEX', kind: 'cap', colors: ['Black', 'Beige', 'Navy', 'White'], sizes: ['FREE'], mrp: 699, price: 399, fabric: '100% Cotton Twill', fit: 'Adjustable', occasion: 'Casual', tags: ['cap', 'accessories', 'summer'], desc: 'Six-panel cotton twill cap with an adjustable strap and embroidered VYRA mark.' },
  { name: 'Everyday Canvas Tote', cat: 'accessories-bags', gender: 'UNISEX', kind: 'bag', colors: ['Cream', 'Black', 'Olive'], sizes: ['FREE'], mrp: 999, price: 599, fabric: 'Cotton Canvas', fit: 'One Size', occasion: 'Casual', tags: ['tote', 'bag', 'accessories'], desc: 'A sturdy 12oz canvas tote with an inner zip pocket. Fits a laptop, a lunch and then some.' },
  { name: 'Commuter Backpack', cat: 'accessories-bags', gender: 'UNISEX', kind: 'bag', colors: ['Black', 'Grey'], sizes: ['FREE'], mrp: 2999, price: 1899, fabric: 'Recycled Polyester', fit: 'One Size', occasion: 'Travel', tags: ['backpack', 'travel', 'laptop', 'water resistant'], desc: 'Water-resistant 22L backpack with a padded 15-inch laptop sleeve and luggage pass-through.' },
];

const PEOPLE = ['Aarav Sharma', 'Diya Patel', 'Vihaan Reddy', 'Ananya Iyer', 'Arjun Nair', 'Isha Gupta', 'Kabir Singh', 'Meera Joshi', 'Rohan Das', 'Saanvi Kulkarni', 'Aditya Menon', 'Priya Verma'];
const CITIES = [['Bengaluru', 'Karnataka', '560034'], ['Mumbai', 'Maharashtra', '400050'], ['New Delhi', 'Delhi', '110017'], ['Chennai', 'Tamil Nadu', '600040'], ['Hyderabad', 'Telangana', '500081'], ['Pune', 'Maharashtra', '411001'], ['Kolkata', 'West Bengal', '700019'], ['Ahmedabad', 'Gujarat', '380015']] as const;

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(xs: readonly T[]) => xs[rnd(xs.length)]!;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const products = app.get(ProductsService);
  const inventory = app.get(InventoryService);
  const media = app.get(MediaService);
  const carts = app.get(CartService);
  const orders = app.get(OrdersService);
  const embeddings = app.get(EmbeddingService);

  if ((await prisma.product.count()) > 0 && process.env.SEED_FORCE !== 'true') {
    console.log('Database already has products; skipping seed (set SEED_FORCE=true after `pnpm db:reset`).');
    await app.close();
    return;
  }

  console.log('→ roles & permissions');
  for (const [key, description] of Object.entries(PERMISSIONS)) await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  for (const [name, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({ where: { name: name as RoleName }, create: { name: name as RoleName }, update: {} });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const ps = await prisma.permission.findMany({ where: { key: { in: perms } } });
    if (ps.length) await prisma.rolePermission.createMany({ data: ps.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  }

  console.log('→ staff accounts');
  const staffPassword = process.env.SEED_STAFF_PASSWORD ?? `Vyra-${randomBytes(4).toString('hex')}-1`;
  const staff: { email: string; name: string; role: RoleName }[] = [
    { email: 'owner@vyra.local', name: 'Store Owner', role: 'SUPER_ADMIN' },
    { email: 'admin@vyra.local', name: 'Admin User', role: 'ADMIN' },
    { email: 'inventory@vyra.local', name: 'Inventory Manager', role: 'INVENTORY_MANAGER' },
    { email: 'orders@vyra.local', name: 'Order Manager', role: 'ORDER_MANAGER' },
  ];
  const hash = await auth.hash(staffPassword);
  let ownerId = '';
  for (const s of staff) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: s.role } });
    const u = await prisma.user.upsert({ where: { email: s.email }, create: { email: s.email, name: s.name, roleId: role.id, passwordHash: hash, emailVerifiedAt: new Date() }, update: { passwordHash: hash, roleId: role.id } });
    if (s.role === 'SUPER_ADMIN') ownerId = u.id;
  }

  console.log('→ categories');
  const catIds = new Map<string, string>();
  let order = 0;
  for (const root of CATEGORIES) {
    const r = await prisma.category.upsert({ where: { slug: root.slug }, create: { name: root.name, slug: root.slug, code: root.code, description: root.description, sortOrder: order++, seoTitle: `${root.name} Clothing Online | VYRA`, seoDescription: `Shop ${root.name.toLowerCase()} fashion at VYRA. ${root.description}` }, update: {} });
    catIds.set(root.slug, r.id);
    let co = 0;
    for (const c of root.children ?? []) {
      const x = await prisma.category.upsert({ where: { slug: c.slug }, create: { name: c.name, slug: c.slug, code: c.code, description: c.description, parentId: r.id, sortOrder: co++, seoTitle: `${root.name}'s ${c.name} | VYRA`, seoDescription: c.description }, update: {} });
      catIds.set(c.slug, x.id);
    }
  }

  const supplier = await prisma.supplier.create({ data: { name: 'Tiruppur Knit Works (demo supplier)', contactName: 'Demo Contact', email: 'supplier@demo.vyra.local', phone: '9000000000', address: 'Tiruppur, Tamil Nadu' } });

  console.log(`→ ${D.length} products (variants, SKUs, barcodes, images, stock)`);
  const variantIds: string[] = [];
  for (const [i, d] of D.entries()) {
    const variants = d.colors.flatMap((color) => d.sizes.map((size) => ({
      color, colorHex: COLORS[color] ?? null, size, mrp: d.mrp, price: d.price, costPrice: Math.round(d.price * 0.42), weightGrams: d.kind === 'bag' ? 600 : d.kind === 'jacket' || d.kind === 'hoodie' ? 650 : d.kind === 'jeans' ? 550 : 280, lowStockThreshold: 5, isActive: true,
    })));
    const created = await products.create({
      name: d.name, description: d.desc, brand: i % 5 === 3 ? 'VYRA Studio' : i % 7 === 4 ? 'VYRA Active' : 'VYRA', gender: d.gender, categoryId: catIds.get(d.cat)!,
      status: 'ACTIVE', tags: d.tags, hsnCode: d.kind === 'bag' ? '4202' : d.kind === 'cap' ? '6505' : '6109', isFeatured: !!d.featured, seoTitle: null, seoDescription: null,
      attributes: { fabric: d.fabric, fit: d.fit, occasion: d.occasion, care: 'Machine wash cold, inside out. Do not bleach.', ...(d.extra ?? {}) },
      sizeChart: d.sizes[0] === 'FREE' ? null : Object.fromEntries(d.sizes.map((s, k) => [s, { Chest: `${36 + k * 2} in`, Length: `${27 + k} in` }])),
      variants,
    }, ownerId);
    // Two images per colour, tagged with the colour so the PDP gallery can switch.
    let sort = 0;
    for (const color of d.colors) {
      for (const v of [0, 1] as const) {
        const svg = Buffer.from(garmentSvg(d.kind, COLORS[color] ?? '#999999', v, `${color}`));
        const s = await media.storeProductImage(created.id, svg, { allowSvg: true });
        await prisma.productImage.create({ data: { productId: created.id, storageKey: s.key, url: s.url, thumbUrl: s.thumbUrl, width: s.width, height: s.height, mimeType: 'image/webp', bytes: s.bytes, contentHash: s.hash, color, alt: `${d.name} in ${color}${v ? ' (back)' : ''}`, sortOrder: sort++ } });
      }
    }
    // Opening stock through the ledger (STOCK_IN), with some deliberately low / out of stock.
    for (const v of created.variants) {
      variantIds.push(v.id);
      const roll = Math.random();
      const qty = roll < 0.06 ? 0 : roll < 0.16 ? 2 + rnd(3) : 10 + rnd(40);
      if (qty > 0) await inventory.recordManual({ variantId: v.id, type: 'STOCK_IN', quantity: qty, reason: 'Opening stock (demo seed)', reference: 'SEED', supplierId: supplier.id, unitCost: Math.round(d.price * 0.42) }, ownerId);
    }
    process.stdout.write(`  ${i + 1}/${D.length} ${d.name} (${created.variants.length} variants)\n`);
  }

  console.log('→ coupons');
  const now = new Date();
  await prisma.coupon.createMany({ data: [
    { code: 'VIBE10', description: '10% off your order (max ₹300)', type: 'PERCENTAGE', value: 10, maxDiscount: 300, minOrderValue: 999, perUserLimit: 3, isActive: true },
    { code: 'WELCOME200', description: '₹200 off your first order above ₹1,499', type: 'FIXED', value: 200, minOrderValue: 1499, perUserLimit: 1, isActive: true },
    { code: 'ETHNIC15', description: '15% off ethnic wear', type: 'PERCENTAGE', value: 15, maxDiscount: 500, categoryIds: [catIds.get('men-ethnic')!, catIds.get('women-kurtas')!], perUserLimit: 2, isActive: true },
    { code: 'MONSOON25', description: 'Expired seasonal offer (demo)', type: 'PERCENTAGE', value: 25, expiresAt: new Date(now.getTime() - 86400_000), isActive: true },
  ] });

  console.log('→ demo customers & orders (through checkout)');
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const customerPassword = 'Customer@123';
  const custHash = await auth.hash(customerPassword);
  const customers = [];
  for (const [i, name] of PEOPLE.entries()) {
    const email = `${name.split(' ')[0]!.toLowerCase()}@demo.vyra.local`;
    const [city, state, pincode] = pick(CITIES);
    const u = await prisma.user.create({ data: { name, email, phone: `98${String(10000000 + i * 7919).slice(0, 8)}`, passwordHash: custHash, roleId: customerRole.id, emailVerifiedAt: new Date(), customerProfile: { create: {} }, createdAt: new Date(now.getTime() - (60 - i * 3) * 86400_000) } });
    await prisma.address.create({ data: { userId: u.id, fullName: name, phone: u.phone!, line1: `${12 + i}, ${pick(['MG Road', 'Park Street', 'Linking Road', 'Anna Salai', 'Banjara Hills Rd'])}`, city, state, pincode, isDefault: true } });
    customers.push(u);
  }

  const stockable = await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, include: { inventory: true } });
  const fakeRes = { cookie: () => undefined } as never;
  let placed = 0;
  for (let n = 0; n < 48; n++) {
    const u = pick(customers);
    const owner = { userId: u.id };
    const lines = 1 + rnd(3);
    try {
      // Start each demo order from an empty bag (a failed attempt must not leak items into the next).
      await prisma.cartItem.deleteMany({ where: { cart: { userId: u.id } } });
      for (let k = 0; k < lines; k++) {
        const v = pick(stockable.filter((x) => (x.inventory?.onHand ?? 0) - (x.inventory?.reserved ?? 0) > 3));
        await carts.add(owner, fakeRes, v.id, 1 + rnd(2));
      }
      const addr = await prisma.address.findFirstOrThrow({ where: { userId: u.id } });
      const r = await orders.checkout(owner, { id: u.id, email: u.email, name: u.name }, { addressId: addr.id, shippingMethod: 'STANDARD', paymentMethod: 'COD', couponCode: n % 6 === 0 ? 'VIBE10' : null, idempotencyKey: randomUUID() });
      const actor = { id: ownerId, name: 'Store Owner' };
      const fate = Math.random();
      const id = r.order.id;
      if (fate > 0.12) {
        await orders.updateStatus(id, 'PACKED', 'Packed (demo)', actor);
        if (fate > 0.25) {
          await orders.ship(id, { provider: 'MANUAL', courierName: pick(['Delhivery', 'Blue Dart', 'Ekart', 'Xpressbees']), trackingNumber: `DEMO${Date.now().toString().slice(-8)}${n}` }, actor);
          if (fate > 0.35) await orders.updateStatus(id, 'DELIVERED', 'Delivered (demo)', actor);
        }
      } else if (fate < 0.06) {
        await orders.cancel(id, 'Changed my mind', actor);
      }
      // Backdate demo orders across the last 45 days so analytics have history.
      const when = new Date(now.getTime() - rnd(45) * 86400_000 - rnd(86400_000));
      await prisma.order.update({ where: { id }, data: { createdAt: when, placedAt: when, ...(fate > 0.35 ? { deliveredAt: new Date(Math.min(now.getTime(), when.getTime() + 4 * 86400_000)) } : {}) } });
      placed++;
    } catch (e) {
      console.warn(`  order ${n} skipped: ${(e as Error).message}`);
    }
  }
  console.log(`  ${placed} demo orders placed`);

  console.log(`→ embeddings via ${embeddings.provider.textModel}`);
  const all = await prisma.product.findMany({ select: { id: true, name: true } });
  let ok = 0;
  for (const p of all) {
    try {
      await embeddings.processProduct(p.id);
      ok++;
    } catch (e) {
      console.warn(`  embedding failed for ${p.name}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  await prisma.embeddingJob.updateMany({ where: { status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'COMPLETED', completedAt: new Date() } });
  console.log(`  ${ok}/${all.length} products embedded`);

  console.log('\n✔ Seed complete (DEVELOPMENT DATA)');
  console.log(`  Staff login (admin app): owner@vyra.local / admin@vyra.local / inventory@vyra.local / orders@vyra.local`);
  console.log(`  Staff password: ${staffPassword}${process.env.SEED_STAFF_PASSWORD ? ' (from SEED_STAFF_PASSWORD)' : ' (generated; set SEED_STAFF_PASSWORD to choose)'}`);
  console.log(`  Demo customer: aarav@demo.vyra.local / ${customerPassword}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
