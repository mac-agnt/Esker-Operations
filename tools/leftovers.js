/* Leftover check: nothing from the shipped fixture should survive a
   customisation pass. Catches the half-renamed demo - the one that still says
   "Ballincollig depot" in front of a client in Manchester.
   Usage: node tools/leftovers.js "Pulse v4 Glass.dc.html"                   */
const fs = require("fs"), path = require("path");

const FILE = process.argv[2] || "Pulse v4 Glass.dc.html";
const src = fs.readFileSync(FILE, "utf8");

/* The injected preview runtime at the top of the file is not ours and is full
   of unrelated words. Scan from the <x-dc> template onward. */
const from = src.indexOf("<x-dc>");
const body = from === -1 ? src : src.slice(from);
const offset = from === -1 ? 0 : src.slice(0, from).split("\n").length - 1;
const lines = body.split("\n");

const terms = fs.readFileSync(path.join(__dirname, "fixture-terms.txt"), "utf8")
  .split("\n").map(l => l.trim())
  .filter(l => l && !l.startsWith("#"));

/* Whole-word match, so "Sage" does not fire on "usage" and "Cork" does not
   fire on "corkboard". Terms with punctuation keep their literal form. */
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rx = (t) => new RegExp(
  (/^[\w]/.test(t) ? "\\b" : "") + esc(t) + (/[\w]$/.test(t) ? "\\b" : ""), "i");

const byTerm = new Map();
terms.forEach(term => {
  const re = rx(term);
  lines.forEach((line, i) => {
    if (re.test(line)) {
      if (!byTerm.has(term)) byTerm.set(term, []);
      byTerm.get(term).push({line: i + 1 + offset, text: line.trim()});
    }
  });
});

if (!byTerm.size) {
  console.log("  ok  leftovers — no fixture names survive");
  process.exit(0);
}

/* If almost everything is still there, this is the shipped template rather
   than a botched customisation. Say so plainly instead of listing 33 failures. */
if (byTerm.size > terms.length * 0.7) {
  console.log("  --  leftovers — this is still the shipped Kilbride fixture.");
  console.log("      Run the customisation prompt in PROMPT.md, then check again.");
  process.exit(0);
}

console.error(`FAIL  ${byTerm.size} fixture name(s) still in the file:\n`);
for (const [term, rows] of [...byTerm].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${term}  —  ${rows.length}×  (first at line ${rows[0].line})`);
  console.error(`      ${rows[0].text.slice(0, 96)}`);
}
console.error("\nRewrite these before showing the demo.");
process.exit(1);
