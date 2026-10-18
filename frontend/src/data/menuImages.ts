/**
 * The club's own pictures of what it sells, cut from the printed FOOD/SNACKS
 * board - the same board `proShopMenu.ts` transcribes and 0013 seeds.
 *
 * Keyed by the fixed menu id, not by name. The ids are the ones 0013 puts in
 * `menu_items` and `proShopMenu.ts` carries, so a picture found here belongs to
 * the same row whether that row came off the server or out of the bundle. A
 * name would drift the first time the club renames something in /admin.
 *
 * **These are the fallback, not the record.** A photo the club uploads in
 * /admin (`menu_items.image_url`, migration 0015) wins over anything here:
 * `menuPhoto()` is what every screen calls, and it prefers the server's. That
 * ordering is the whole design - the board is what the club has today, the
 * upload is how they replace one picture without a deploy.
 *
 * They are served from public/menu and cached by the service worker once seen,
 * like the hole pictures (see data/holeImages). Not precached: a player who
 * never opens /food should not spend the bytes.
 *
 * Made by scripts/crop-menu-board.py from the board PNG. Do not edit the files
 * by hand - re-run the script against the current board, because the board is
 * what the pro shop's counter actually shows.
 *
 * The BEER board carries no per-item pictures (it is a price list beside a
 * group shot of cans), so every drink is absent here and shows as text. That is
 * the board's own choice, not a gap.
 */

/** id -> public path. Absent means "no picture on the board for this one". */
export const BOARD_PHOTOS: Record<string, string> = {
  // Written by scripts/crop-menu-board.py - do not edit by hand.
  '00000013-0000-4000-8000-000000000001': '/menu/hot-dog.webp',
  '00000013-0000-4000-8000-000000000002': '/menu/k-hot-dog.webp',
  '00000013-0000-4000-8000-000000000004': '/menu/morning-sandwich.webp',
  '00000013-0000-4000-8000-000000000006': '/menu/morning-wrap.webp',
  '00000013-0000-4000-8000-000000000007': '/menu/french-fries.webp',
  '00000013-0000-4000-8000-000000000008': '/menu/onion-rings.webp',
  '00000013-0000-4000-8000-000000000009': '/menu/dumplings.webp',
  '00000013-0000-4000-8000-000000000012': '/menu/udon.webp',
  '00000013-0000-4000-8000-000000000013': '/menu/slim-noodle.webp',
  '00000013-0000-4000-8000-000000000014': '/menu/rice-noodle-pho.webp',
  '00000013-0000-4000-8000-000000000016': '/menu/chocolate-bar.webp',
  '00000013-0000-4000-8000-000000000017': '/menu/clif-energy-bar.webp',
  '00000013-0000-4000-8000-000000000018': '/menu/chips.webp',
  '00000013-0000-4000-8000-000000000019': '/menu/nuts.webp',
};

/**
 * Rows the board never pictured, filled from the open web - see
 * scripts/fetch-menu-photos.py, which also records where each one came from.
 *
 * Kept apart from BOARD_PHOTOS so that re-cutting the board does not wipe them
 * and re-fetching these does not wipe the board's. The board wins where both
 * have a picture: it is the club's own, and it is what the counter shows.
 */
export const SOURCED_PHOTOS: Record<string, string> = {
  // Written by scripts/fetch-menu-photos.py - do not edit by hand.
  // Nongshim USA product render (nongshimusa.com) - the cup the pro shop sells
  '00000013-0000-4000-8000-000000000011': '/menu/shin-noodle.webp',
  // Evan-Amos, Wikimedia Commons, public domain
  '00000013-0000-4000-8000-000000000005': '/menu/pie.webp',
  // Flickr, CC0 (via Openverse)
  '00000013-0000-4000-8000-000000000010': '/menu/waffle.webp',
};

/**
 * The picture to show for a menu row: the club's upload first, the printed
 * board second, the web third, nothing fourth.
 *
 * Deliberately not folded into `MenuItem.imageUrl`. That field is what gets
 * written back to `menu_items` when the club edits a price, and 0015 checks it
 * begins with `https://` - a bundled path like `/menu/hot-dog.webp` would fail
 * that check and take the price edit down with it.
 */
export const menuPhoto = (id: string, uploaded: string | null): string | null =>
  uploaded || BOARD_PHOTOS[id] || SOURCED_PHOTOS[id] || null;
