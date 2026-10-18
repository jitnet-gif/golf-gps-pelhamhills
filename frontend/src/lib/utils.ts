/**
 * Utility functions for golf app
 */

/**
 * Format score as string with color indicator
 */
export const formatScore = (
  score: number | undefined,
  par: number
): { text: string; colorClass: string } => {
  if (score === undefined) return { text: '--', colorClass: 'text-muted-foreground' };

  const diff = score - par;

  if (diff < -2) return { text: `${score}`, colorClass: 'text-green-600' }; // Eagle or better
  if (diff === -2) return { text: `${score}`, colorClass: 'text-green-600' }; // Eagle
  if (diff === -1) return { text: `${score}`, colorClass: 'text-blue-600' }; // Birdie
  if (diff === 0) return { text: `${score}`, colorClass: 'text-slate-600' }; // Par
  if (diff === 1) return { text: `${score}`, colorClass: 'text-orange-600' }; // Bogey
  if (diff === 2) return { text: `${score}`, colorClass: 'text-red-600' }; // Double

  return { text: `${score}`, colorClass: 'text-red-600' }; // Triple or worse
};

/**
 * Format distance in yards with proper suffix
 */
export const formatDistance = (yards: number): string => {
  if (yards < 1000) return `${Math.round(yards)} yd`;
  const miles = yards / 1760;
  return `${miles.toFixed(2)} mi`;
};

/**
 * Format bearing as compass direction with degrees
 */
export const formatBearing = (bearing: number): string => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(bearing / 22.5) % 16;
  return `${directions[index]} (${Math.round(bearing)}°)`;
};

/**
 * Calculate GIR (Gross Score to Par ratio)
 */
export const calculateGIR = (
  scores: Map<number, number>,
  coursePar: number
): number => {
  if (scores.size === 0) return 0;
  const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
  return total - coursePar;
};

/**
 * Calculate handicap differential
 */
export const calculateHandicapDifferential = (
  score: number,
  courseRating: number,
  slopeRating: number
): number => {
  return (score - courseRating) * 113 / slopeRating;
};

/**
 * Format date and time
 */
export const formatDateTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Format duration in seconds to readable string
 */
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

/**
 * Check if score is valid (1-13 range for golf)
 */
export const isValidScore = (score: number): boolean => {
  return Number.isInteger(score) && score > 0 && score <= 13;
};

/**
 * Round to nearest yard
 */
export const roundYards = (yards: number): number => {
  return Math.round(yards);
};

/**
 * Check if device is mobile
 */
export const isMobileDevice = (): boolean => {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

/**
 * Check if device supports touch
 */
export const supportsTouchEvent = (): boolean => {
  return typeof window !== 'undefined' &&
    (('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0) ||
      ('msMaxTouchPoints' in navigator && (navigator as any).msMaxTouchPoints > 0));
};

/**
 * Debounce function
 */
export const debounce = <T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
};

/**
 * Throttle function
 */
export const throttle = <T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let lastCall = 0;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
};

/**
 * Safe JSON parse
 */
export const safeJsonParse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

/**
 * Get contrasting text color for background
 */
export const getContrastColor = (hexColor: string): 'black' | 'white' => {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? 'black' : 'white';
};
