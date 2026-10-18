import type { MenuItem } from '@/lib/foodOrders';

/**
 * The pro shop's two printed boards, as the app carries them.
 *
 * The menu lives in the database (`menu_items`, migration 0012, seeded by 0013)
 * and that copy is the one that counts - the club edits it in /admin and an
 * order is priced from it. This is the same list bundled into the app so the
 * screen is never blank: the first frame before any fetch, a fairway with no
 * signal, and the days before the club has run 0013.
 *
 * The ids are fixed and 0013 seeds these exact ones, so an item tapped from this
 * copy names the same database row once the seed has run. Where they ever
 * disagree the server wins - one successful fetch replaces this list entirely.
 *
 * Seeing this list is not being able to order from it. An order is priced by
 * `place_food_order` against the database, so until 0012 and 0013 have both been
 * run there is nothing behind these rows. Food.tsx says so on screen rather than
 * letting the order fail at the counter.
 *
 * This file and the 0013 seed are generated from one source, so the ids cannot
 * drift. Edit the club's menu in /admin, never here.
 */
export const BUNDLED_MENU: MenuItem[] = [
  { id: '00000013-0000-4000-8000-000000000001', name: 'Hot Dog',                   category: 'Food',              priceCents: 700,   sortOrder: 1 },
  { id: '00000013-0000-4000-8000-000000000002', name: 'K Hot Dog',                 category: 'Food',              priceCents: 900,   sortOrder: 2 },
  { id: '00000013-0000-4000-8000-000000000003', name: 'Italian Hot Dog',           category: 'Food',              priceCents: 1000,  sortOrder: 3 },
  { id: '00000013-0000-4000-8000-000000000004', name: 'Morning Sandwich',          category: 'Food',              priceCents: 900,   sortOrder: 4 },
  { id: '00000013-0000-4000-8000-000000000005', name: 'Pie',                       category: 'Food',              priceCents: 1100,  sortOrder: 5 },
  { id: '00000013-0000-4000-8000-000000000006', name: 'Morning Wrap',              category: 'Food',              priceCents: 999,   sortOrder: 6 },
  { id: '00000013-0000-4000-8000-000000000007', name: 'French Fries',              category: 'Food',              priceCents: 600,   sortOrder: 7 },
  { id: '00000013-0000-4000-8000-000000000008', name: 'Onion Rings',               category: 'Food',              priceCents: 600,   sortOrder: 8 },
  { id: '00000013-0000-4000-8000-000000000009', name: 'Dumplings',                 category: 'Food',              priceCents: 600,   sortOrder: 9 },
  { id: '00000013-0000-4000-8000-000000000010', name: 'Waffle',                    category: 'Food',              priceCents: 600,   sortOrder: 10 },
  { id: '00000013-0000-4000-8000-000000000011', name: 'Shin Noodle',               category: 'Food',              priceCents: 400,   sortOrder: 11 },
  { id: '00000013-0000-4000-8000-000000000012', name: 'Udon',                      category: 'Food',              priceCents: 899,   sortOrder: 12 },
  { id: '00000013-0000-4000-8000-000000000013', name: 'Slim Noodle',               category: 'Food',              priceCents: 300,   sortOrder: 13 },
  { id: '00000013-0000-4000-8000-000000000014', name: 'Rice Noodle Pho',           category: 'Food',              priceCents: 899,   sortOrder: 14 },
  { id: '00000013-0000-4000-8000-000000000015', name: 'Rice Noodle Tom Yum',       category: 'Food',              priceCents: 899,   sortOrder: 15 },
  { id: '00000013-0000-4000-8000-000000000016', name: 'Chocolate Bar',             category: 'Snacks',            priceCents: 300,   sortOrder: 1 },
  { id: '00000013-0000-4000-8000-000000000017', name: 'Clif Energy Bar',           category: 'Snacks',            priceCents: 300,   sortOrder: 2 },
  { id: '00000013-0000-4000-8000-000000000018', name: 'Chips',                     category: 'Snacks',            priceCents: 300,   sortOrder: 3 },
  { id: '00000013-0000-4000-8000-000000000019', name: 'Nuts',                      category: 'Snacks',            priceCents: 400,   sortOrder: 4 },
  { id: '00000013-0000-4000-8000-000000000020', name: 'Bud Light',                 category: 'Beer',              priceCents: 799,   sortOrder: 1 },
  { id: '00000013-0000-4000-8000-000000000021', name: 'Canadian',                  category: 'Beer',              priceCents: 799,   sortOrder: 2 },
  { id: '00000013-0000-4000-8000-000000000022', name: 'Budweiser',                 category: 'Beer',              priceCents: 799,   sortOrder: 3 },
  { id: '00000013-0000-4000-8000-000000000023', name: 'Moosehead',                 category: 'Beer',              priceCents: 799,   sortOrder: 4 },
  { id: '00000013-0000-4000-8000-000000000024', name: 'Coors Original',            category: 'Beer',              priceCents: 799,   sortOrder: 5 },
  { id: '00000013-0000-4000-8000-000000000025', name: 'Corona',                    category: 'Beer',              priceCents: 850,   sortOrder: 6 },
  { id: '00000013-0000-4000-8000-000000000026', name: 'Triple Bogey Lager',        category: 'Beer',              priceCents: 899,   sortOrder: 7 },
  { id: '00000013-0000-4000-8000-000000000027', name: 'Triple Bogey Ultra',        category: 'Beer',              priceCents: 999,   sortOrder: 8 },
  { id: '00000013-0000-4000-8000-000000000028', name: 'Black Burn Burn',           category: 'Beer',              priceCents: 899,   sortOrder: 9 },
  { id: '00000013-0000-4000-8000-000000000029', name: 'Silversmith Molecka Pils',  category: 'Beer',              priceCents: 699,   sortOrder: 10 },
  { id: '00000013-0000-4000-8000-000000000030', name: 'Silversmith Alter',         category: 'Beer',              priceCents: 690,   sortOrder: 11 },
  { id: '00000013-0000-4000-8000-000000000031', name: 'Silversmith Nita',          category: 'Beer',              priceCents: 690,   sortOrder: 12 },
  { id: '00000013-0000-4000-8000-000000000032', name: 'Silversmith Black',         category: 'Beer',              priceCents: 699,   sortOrder: 13 },
  { id: '00000013-0000-4000-8000-000000000033', name: 'Silversmith Lager',         category: 'Beer',              priceCents: 699,   sortOrder: 14 },
  { id: '00000013-0000-4000-8000-000000000034', name: 'Dive Drive Cherry',         category: 'Beer',              priceCents: 799,   sortOrder: 15 },
  { id: '00000013-0000-4000-8000-000000000035', name: 'Triple Bogey Half',         category: 'Beer',              priceCents: 799,   sortOrder: 16 },
  { id: '00000013-0000-4000-8000-000000000036', name: 'Triple Bogey Cluc',         category: 'Beer',              priceCents: 799,   sortOrder: 17 },
  { id: '00000013-0000-4000-8000-000000000037', name: 'Triple Bogey Floor',        category: 'Beer',              priceCents: 799,   sortOrder: 18 },
  { id: '00000013-0000-4000-8000-000000000038', name: 'Triple Bogey Cnnnp',        category: 'Beer',              priceCents: 799,   sortOrder: 19 },
  { id: '00000013-0000-4000-8000-000000000039', name: 'Triple Bogey Bom',          category: 'Beer',              priceCents: 799,   sortOrder: 20 },
  { id: '00000013-0000-4000-8000-000000000040', name: 'White (Ice Cider)',         category: 'Cider & Seltzer',   priceCents: 799,   sortOrder: 1 },
  { id: '00000013-0000-4000-8000-000000000041', name: 'White Claw',                category: 'Cider & Seltzer',   priceCents: 799,   sortOrder: 2 },
  { id: '00000013-0000-4000-8000-000000000042', name: 'Caeser',                    category: 'Cider & Seltzer',   priceCents: 850,   sortOrder: 3 },
  { id: '00000013-0000-4000-8000-000000000043', name: 'Spicy Caeser',              category: 'Cider & Seltzer',   priceCents: 850,   sortOrder: 4 },
  { id: '00000013-0000-4000-8000-000000000044', name: 'Strawblaw',                 category: 'Cider & Seltzer',   priceCents: 850,   sortOrder: 5 },
  { id: '00000013-0000-4000-8000-000000000045', name: 'Corona Zero',               category: 'Cider & Seltzer',   priceCents: 800,   sortOrder: 6 },
  // imageUrl null throughout: the pictures are the club's own, taken in the pro
  // shop and uploaded in /admin > 메뉴 (migration 0015). None of them can be
  // bundled here, and a menu read from the server brings them with it.
].map((item) => ({ ...item, description: '', isAvailable: true, imageUrl: null }));
