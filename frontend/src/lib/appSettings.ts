// Settings an admin picks once and every player's phone follows - the
// `app_settings` table from migration 0007. Read with the publishable key, so
// no sign-in is needed to follow them; written only by an admin account.
//
// The last value read is kept on the phone, because the setting has to hold on
// a fairway with no signal just as the map does.

import { supabase } from './supabase';
import { problemOf, type ServerProblem } from './holePaths';

/**
 * What the Full map button shows:
 * - satellite: 신시스템 지도 - the satellite map with every hole's dashed line
 * - printed:   현시스템 지도 - the club's printed course map
 */
export type FullMapStyle = 'satellite' | 'printed';

const FULL_MAP_KEY = 'full_map';
const CACHE_KEY = 'golf.fullMapStyle';

/**
 * Fired on this page when an admin saves a new style, with the style as its
 * detail - the map editor below the picker previews it (FairwayPathEditor).
 */
export const FULL_MAP_STYLE_EVENT = 'golf:full-map-style';

/** The printed map unless an admin has picked the satellite one - the club's choice of default. */
const asStyle = (value: unknown): FullMapStyle => (value === 'satellite' ? 'satellite' : 'printed');

/** The last style this phone was told, the printed map until it has been told anything. */
export const cachedFullMapStyle = (): FullMapStyle => {
  try {
    return asStyle(localStorage.getItem(CACHE_KEY));
  } catch {
    return 'printed';
  }
};

const remember = (style: FullMapStyle) => {
  try {
    localStorage.setItem(CACHE_KEY, style);
  } catch {
    /* storage blocked - the next open asks the server again */
  }
};

/** The admin's choice, or null when the server could not say (keep what is cached). */
export const fetchFullMapStyle = async (): Promise<FullMapStyle | null> => {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', FULL_MAP_KEY)
      .maybeSingle();
    if (error) return null;
    const style = asStyle(data?.value);
    remember(style);
    return style;
  } catch {
    return null;
  }
};

/** Set the style for every phone. Needs a signed-in admin. */
export const saveFullMapStyle = async (style: FullMapStyle): Promise<ServerProblem | null> => {
  if (!supabase) return 'unavailable';
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return 'signedOut';
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { key: FULL_MAP_KEY, value: style, updated_at: new Date().toISOString() },
        { onConflict: 'key', defaultToNull: false }
      );
    if (error) return problemOf(error);
    remember(style);
    window.dispatchEvent(new CustomEvent<FullMapStyle>(FULL_MAP_STYLE_EVENT, { detail: style }));
    return null;
  } catch (err) {
    return problemOf(err as { message?: string });
  }
};
