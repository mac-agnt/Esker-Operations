/* Structural check for a customised Pulse template.
   Runs three passes over the .dc.html file:
     1. syntax   - the component script parses
     2. render   - renderVals() returns for every page
     3. bindings - every {{ name }} in the markup resolves
   Usage: node tools/check.js "Pulse v4 Glass.dc.html"                       */
const fs = require("fs"), Module = require("module");

const FILE = process.argv[2] || "Pulse v4 Glass.dc.html";
const src = fs.readFileSync(FILE, "utf8");

const tplMatch = src.match(/<x-dc>([\s\S]*)<\/x-dc>/);
const jsMatch  = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*)<\/script>/);
if (!tplMatch || !jsMatch) {
  console.error("FAIL  could not find the <x-dc> template or its script block");
  process.exit(1);
}
const tpl = tplMatch[1], js = jsMatch[1];

/* Minimal stand-ins for the browser globals the component touches on construct. */
global.window = {innerWidth:1440, devicePixelRatio:2, addEventListener(){}, removeEventListener(){}};
global.document = {createElement:()=>({getContext:()=>null, style:{}}), addEventListener(){}, removeEventListener(){}};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const PRELUDE = "class DCLogic{constructor(){this.state={};}" +
  "setState(u){const n=typeof u==='function'?u(this.state):u;Object.assign(this.state,n);}};";

let Component;
try {
  const mod = new Module("dc");
  mod._compile(PRELUDE + js + "\n;module.exports={Component};", "/dc.js");
  Component = mod.exports.Component;
} catch (e) {
  console.error("FAIL  syntax: " + e.message);
  process.exit(1);
}
console.log("  ok  syntax");

const PAGES = ["Home","Agents","Dashboard","Work","Records","Activity","Settings",
               "Organisations","People","Teams","Locations","Site visits"];
const seen = new Set();
let failed = 0;
for (const page of PAGES) {
  const c = new Component();
  c.state.page = page;
  try {
    const vals = c.renderVals();
    if (!vals || typeof vals !== "object") throw new Error("renderVals returned " + typeof vals);
    Object.keys(vals).forEach(k => seen.add(k));
  } catch (e) {
    console.error("FAIL  render " + page + ": " + e.message);
    failed++;
  }
}
if (failed) process.exit(1);
console.log("  ok  render — " + PAGES.length + " pages");

const scoped = new Set();
for (const m of tpl.matchAll(/\bas="([^"]+)"/g)) scoped.add(m[1]);
const names = new Set();
for (const m of tpl.matchAll(/\{\{\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
const missing = [...names]
  .filter(n => !seen.has(n) && !scoped.has(n) && n !== "true" && n !== "false")
  .sort();
if (missing.length) {
  console.error("FAIL  bindings with no value: " + missing.join(", "));
  process.exit(1);
}
console.log("  ok  bindings — " + names.size + " resolve");
