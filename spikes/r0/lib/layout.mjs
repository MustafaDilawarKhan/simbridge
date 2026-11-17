// Default tap points for the R0 test app, expo-rsc-movies: two native tabs at
// the bottom of the screen. Values are shares of the screen (0 to 1). Every one
// can be overridden on the measure command line, after reading the real tab
// positions from the viewer (it shows x and y of every click).

/** First tab (Search). */
export const DEFAULT_TAP_A = { x: 0.3, y: 0.94 };

/** Second tab. */
export const DEFAULT_TAP_B = { x: 0.7, y: 0.94 };

/** Pixels watched for a tap's effect: everything below the status bar, whose clock would count as a change. */
export const DEFAULT_WATCH = { x0: 0, x1: 1, y0: 0.07, y1: 1 };

/** Drag used to scroll the list during the frame-rate test. */
export const SCROLL_FROM = { x: 0.5, y: 0.7 };
export const SCROLL_TO = { x: 0.5, y: 0.35 };

/** Parses "x,y" into a point, or returns the fallback. */
export function parsePoint(text, fallback) {
  if (!text) return fallback;
  const [x, y] = text.split(',').map(Number);
  if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
    throw new Error(
      `"${text}" is not a point; use x,y with numbers from 0 to 1, for example 0.3,0.94`,
    );
  }
  return { x, y };
}

/** Parses "x0,y0,x1,y1" into a rectangle, or returns the fallback. */
export function parseRect(text, fallback) {
  if (!text) return fallback;
  const [x0, y0, x1, y1] = text.split(',').map(Number);
  const valid = [x0, y0, x1, y1].every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  if (!valid || x1 <= x0 || y1 <= y0) {
    throw new Error(`"${text}" is not an area; use x0,y0,x1,y1 with numbers from 0 to 1`);
  }
  return { x0, y0, x1, y1 };
}
