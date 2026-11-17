// Where things are on the sample app's screen, as shares of the screen (0 to 1).
// Must match the percentages in spikes/r0/sample-app/App.tsx.

/** Point to tap to press the counter button. */
export const COUNTER_TAP = { x: 0.5, y: 0.55 };

/** Pixels watched for a tap's effect: inside the counter button, away from its edges. */
export const COUNTER_WATCH = { x0: 0.15, x1: 0.85, y0: 0.48, y1: 0.62 };

/** Point to tap to switch the moving bar on or off. */
export const ANIMATE_TAP = { x: 0.5, y: 0.85 };

/** Pixels of the moving bar's track. */
export const BAR_WATCH = { x0: 0.06, x1: 0.94, y0: 0.125, y1: 0.155 };
