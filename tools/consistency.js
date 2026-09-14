/* Consistency check: the things a customisation pass half-finishes.
   CONFIG says one thing and the data still says another - the currency is
   pounds but the inbox quotes euros, the owner is renamed but the avatar still
   carries the old initials, the email domain moved but the addresses did not.

   Usage: node tools/consistency.js "Pulse v4 Glass.dc.html"                 */
const fs = require("fs"), Module = require("module");

const FILE = process.argv[2] || "Pulse v4 Glass.dc.html";
const src = fs.readFileSync(FILE, "utf8");
const js = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*)<\/script>/)[1];

global.window = {innerWidth:1440, devicePixelRatio:2, addEventListener(){}, removeEventListener(){}};
global.document = {createElement:()=>({getContext:()=>null, style:{}}), addEventListener(){}, removeEventListener(){}};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const mod = new Module("dc");
mod._compile('class DCLogic{constructor(){this.state={};}setState(){}};' + js +
  ";module.exports={CONFIG,CONTACTS,PEOPLE,ORGS,TEAMS,LOCATIONS};", "/dc.js");
const {CONFIG, CONTACTS, PEOPLE, ORGS, TEAMS, LOCATIONS} = mod.exports;

/* Only look at the component's own source, not the injected preview runtime. */
const from = src.indexOf("<x-dc>");
const body = from === -1 ? src : src.slice(from);

const problems = [];

/* 1. currency symbols in the data that disagree with CONFIG.currency */
const SYMBOLS = ["€", "$", "£", "¥"];
const stray = SYMBOLS.filter(sym => sym !== CONFIG.currency)
  .map(sym => [sym, (body.match(new RegExp("\\" + sym + "[\\d]", "g")) || []).length])
  .filter(([, n]) => n > 0);
if (stray.length) {
  problems.push(`CONFIG.currency is "${CONFIG.currency}" but the data still uses ` +
    stray.map(([s, n]) => `${s} (${n}×)`).join(", ") +
    `.\n      Currency in the data is written by hand; money() only formats the dashboard.`);
}

/* 2. owner initials should be derivable from the owner's name */
const initialsOf = (name) => name.split(/\s+/).filter(Boolean)
  .map(w => w[0]).join("").toUpperCase().slice(0, 2);
const want = initialsOf(CONFIG.owner.name);
if (CONFIG.owner.initials.toUpperCase() !== want) {
  problems.push(`CONFIG.owner is "${CONFIG.owner.name}" but initials are ` +
    `"${CONFIG.owner.initials}" — expected "${want}". The avatar shows the initials.`);
}

/* 3. owner first name should be the first word of the owner's name */
if (CONFIG.owner.firstName && !CONFIG.owner.name.startsWith(CONFIG.owner.firstName)) {
  problems.push(`CONFIG.owner.firstName "${CONFIG.owner.firstName}" is not part of ` +
    `"${CONFIG.owner.name}". The home screen greets them by it.`);
}

/* 4. staff email addresses should sit on CONFIG.domain */
/* PEOPLE carries status at [4] and permission level at [5]; anyone External or
   inactive is not staff and keeps their own employer's address. */
const staffRows = [...(CONTACTS || []).filter(r => r[4] === "staff"),
                   ...(PEOPLE || []).filter(r =>
                     !/external|inactive/i.test((r[4] || "") + " " + (r[5] || "")))];
const offDomain = [...new Set(staffRows.map(r => r[2])
  .filter(e => typeof e === "string" && e.includes("@") && !e.endsWith("@" + CONFIG.domain)))];
if (offDomain.length) {
  problems.push(`CONFIG.domain is "${CONFIG.domain}" but these staff addresses are ` +
    `elsewhere: ${offDomain.join(", ")}`);
}

/* 5. names referenced across lists should exist in the cast */
const cast = new Set((CONTACTS || []).map(r => r[0]));
const leads = (TEAMS || []).map(r => r[2]).filter(n => n && n !== "—");
const unknownLeads = leads.filter(n => !cast.has(n) && n !== CONFIG.owner.name);
if (unknownLeads.length) {
  problems.push(`TEAMS names a lead who is not in CONTACTS: ${unknownLeads.join(", ")}`);
}

if (problems.length) {
  console.error("FAIL  " + problems.length + " inconsistenc" +
    (problems.length === 1 ? "y" : "ies") + " between CONFIG and the data:\n");
  problems.forEach(p => console.error("  - " + p + "\n"));
  process.exit(1);
}
console.log("  ok  consistency — CONFIG and the data agree");
