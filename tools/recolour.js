/* Print the accent variables for a new brand colour.
   Every palette in this file derives nine variables from one accent hex plus
   the page background. Rather than hand-tuning thirty values, generate the
   nine and paste them over the ones in the theme block you are changing.

   Usage: node tools/recolour.js "#c8f04b" ["#0b0c0b"]
          node tools/recolour.js "#0071e3" "#f4f2ed"                          */

const hex = (process.argv[2] || "").trim();
const bg  = (process.argv[3] || "#0b0c0b").trim();

const parse = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [v >> 16 & 255, v >> 8 & 255, v & 255];
};
const accent = parse(hex), base = parse(bg);
if (!accent || !base) {
  console.error('usage: node tools/recolour.js "#rrggbb" ["#rrggbb" (page background)]');
  process.exit(1);
}

const toHex = (c) => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v)))
  .toString(16).padStart(2, "0")).join("");
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/* Perceived lightness, so we can tell whether text on the accent should be the
   page background or near-white. */
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const light = lum(accent) > 0.45;
const onAccent = light ? base : [255, 255, 255];
const hover = light ? mix(accent, [255, 255, 255], 0.18) : mix(accent, [255, 255, 255], 0.12);
/* Hero ramp: the accent hue carried from near-black up through full strength
   and back down, which is what the existing gradients do. */
const ramp = [0.06, 0.28, 0.5, 0.78, 0.44, 0.1]
  .map(t => toHex(mix(mix(base, [0, 0, 0], 0.15), accent, t)));

console.log(`/* accent ${toHex(accent)} on ${toHex(base)} — paste over the matching lines */`);
console.log(`--accent:${toHex(accent)};`);
console.log(`--accent-hover:${toHex(hover)};`);
console.log(`--accent-soft:${rgba(accent, .12)};`);
console.log(`--accent-faint:${rgba(accent, .05)};`);
console.log(`--accent-line:${rgba(accent, .3)};`);
console.log(`--on-accent:${toHex(onAccent)};`);
console.log(`--on-accent-2:${rgba(onAccent, .66)};`);
console.log(`--on-accent-strong:${rgba(onAccent, .85)};`);
console.log(`--on-accent-soft:${rgba(onAccent, .22)};`);
console.log(`--glow-a:${rgba(accent, .07)};`);
console.log(`--bloom-a:${rgba(accent, .42)};`);
console.log(`--hero-grad:linear-gradient(180deg,${ramp[0]} 0%,${ramp[1]} 18%,${ramp[2]} 40%,${ramp[3]} 60%,${ramp[4]} 82%,${ramp[5]} 100%);`);
console.log(`\n/* and in the THEMES list, set accent:"${toHex(accent)}" on the same theme.
   The hero gradient is a starting point, not a finished ramp - look at it on
   the Dashboard and nudge the middle stops if the hue drifts. */`);
