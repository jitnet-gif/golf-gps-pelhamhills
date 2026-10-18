/**
 * Photographing the menu: the pro shop's camera to the order screen.
 *
 * Migration 0015 adds `menu_items.image_url` and a public `menu-photos` bucket.
 * The club takes the pictures - the printed boards have none - so this is built
 * around a phone in the pro shop holding up a hot dog, not around a designer
 * with a folder of assets.
 *
 * Every upload is shrunk here first. A modern phone camera hands over 4 MB and
 * 4000 px for a picture that is shown 72 px wide on a fairway with one bar of
 * signal; sending that as-is would make the order screen the slowest thing in
 * the app. A thousand pixels of JPEG is about 150 KB and more than the screen
 * can use.
 */

import { supabase } from './supabase';

const BUCKET = 'menu-photos';

/** Longest side after shrinking. The menu row shows it at 72 px, the tap-to-open view at full width. */
const MAX_EDGE = 1000;
const JPEG_QUALITY = 0.82;

export type PhotoProblem = 'unavailable' | 'tooBig' | 'notImage' | 'denied' | 'network' | 'other';

/** Refuse before the camera roll picture is even decoded. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export const PHOTO_PROBLEM_TEXT: Record<PhotoProblem, string> = {
  unavailable: '이 빌드에는 서버 연결이 없습니다.',
  tooBig: '사진이 너무 큽니다 (25MB 넘음).',
  notImage: '사진 파일이 아닙니다.',
  denied:
    '사진을 올릴 권한이 없습니다. 관리자 계정으로 로그인했는지, 0015_menu_photos.sql 을 실행했는지 확인해 주세요.',
  network: '인터넷 연결이 없어 올리지 못했습니다.',
  other: '사진을 올리지 못했습니다.',
};

/**
 * Shrink to a JPEG no wider or taller than MAX_EDGE.
 *
 * A picture smaller than that is still re-encoded rather than passed through:
 * a 900 px PNG off a laptop is often larger than a 1000 px JPEG, and one code
 * path is worth more here than the handful of bytes the shortcut would save.
 */
const shrink = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('canvas'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('encode'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };

    image.src = url;
  });

/**
 * Upload a photo for one menu item and give back its public address.
 *
 * The file is named after the item and the moment, never after the item alone:
 * a fixed name would be cached by every phone that already has the old picture,
 * and the club would swap a photo and see the old one for a week.
 */
export const uploadMenuPhoto = async (
  itemId: string,
  file: File
): Promise<{ url: string | null; problem: PhotoProblem | null }> => {
  if (!supabase) return { url: null, problem: 'unavailable' };
  if (!file.type.startsWith('image/')) return { url: null, problem: 'notImage' };
  if (file.size > MAX_SOURCE_BYTES) return { url: null, problem: 'tooBig' };

  let blob: Blob;
  try {
    blob = await shrink(file);
  } catch {
    return { url: null, problem: 'notImage' };
  }

  const path = `${itemId}/${Date.now()}.jpg`;

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('row-level security') || message.includes('unauthorized')) {
        return { url: null, problem: 'denied' };
      }
      if (message.includes('bucket not found')) return { url: null, problem: 'denied' };
      if (message.includes('fetch') || message.includes('network')) {
        return { url: null, problem: 'network' };
      }
      return { url: null, problem: 'other' };
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, problem: null };
  } catch {
    return { url: null, problem: 'network' };
  }
};

/**
 * Delete a photo this app uploaded, by the address stored on the row.
 *
 * Best effort: a picture nobody points at any more costs the club nothing, and
 * a failure here must not stop the row being saved without it. Anything not
 * from our own bucket is left alone - a URL the club typed in by hand belongs
 * to somebody else.
 */
export const deleteMenuPhoto = async (url: string | null): Promise<void> => {
  if (!supabase || !url) return;
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return;
  const path = url.slice(at + marker.length).split('?')[0];
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* an orphan in the bucket is cheaper than a save that fails */
  }
};
