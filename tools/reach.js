/* Reachability check: every list in the edit zone should actually show up on a
   screen. For each block it picks a distinctive phrase out of the block's own
   contents, renders every page and panel, and reports any block whose phrase
   never appeared.

   This is what catches "I rewrote that block beautifully and it renders
   nowhere". Nothing is mutated and no fixture strings are hardcoded, so it
   keeps working after a customisation pass.

   Usage: node tools/reach.js "Pulse v4 Glass.dc.html"                       */
const fs = require("fs"), Module = require("module");

const FILE = process.argv[2] || "Pulse v4 Glass.dc.html";
const src = fs.readFileSync(FILE, "utf8");
const js = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*)<\/script>/)[1];

/* Blocks that render nowhere. REVENUE_SPLIT feeds `metricGroups`, a second
   dashboard view that was never given markup - the Dashboard renders
   ASPECT_DEFS instead. Delete a name from here if its consumer comes back. */
const KNOWN_UNREACHABLE = new Set(["REVENUE_SPLIT"]);

const BLOCKS = [
  "ORGS","TEAMS","LOCATIONS","CONTACTS","FILE_TREE","PEOPLE","INTEGRATIONS",
  "DATA_EVENTS","PEOPLE_EVENTS","AI_EVENTS","ITEMS","ANSWERS",
  "AGENT_DEFS","KPI_DEFS","ASPECT_DEFS","OPS_DEFS","WORK_TASKS","WORKFLOWS","SCHEDULES",
  "WORK_WIDGETS","ADMIN_CARDS","QUEUE_TASKS","APPROVAL_ROWS","REVENUE_SPLIT","ADMIN_URGENT",
  "AUTOMATION_ROWS","HEALTH_TILES","HEALTH_FAILURES","HEALTH_CALLS","NOTIFICATION_FEED",
  "MODULE_ROWS","HOME_SUGGESTIONS","HOME_ACTIVITY","MINI_SUGGESTIONS","VISIT_WIDGET",
  "SCHEDULE_NEXT","ROLES","ACTIVITY_KPIS","BUILDER_BLOCKS","PALETTE_RECENT",
  "CONTACT_SEARCH","EVENT_DIFF","PALETTE_FREQUENT","MINI_NOTIFICATIONS"
];

global.window = {innerWidth:1440, devicePixelRatio:2, addEventListener(){}, removeEventListener(){}};
global.document = {createElement:()=>({getContext:()=>null, style:{}}), addEventListener(){}, removeEventListener(){}};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

let mod;
try {
  mod = new Module("dc");
  mod._compile('class DCLogic{constructor(){this.state={};}setState(u){' +
    'const n=typeof u==="function"?u(this.state):u;Object.assign(this.state,n);}};' +
    js + ";module.exports={Component," + BLOCKS.join(",") + "};", "/dc.js");
} catch (e) {
  console.error("FAIL  reach: " + e.message);
  process.exit(1);
}
const Component = mod.exports.Component;

/* Something worth probing with. Prose first - a sentence is unmistakable in the
   rendered output. Some blocks hold nothing but identifiers (a list of tool
   names, say), so fall back to the longest plain string rather than skipping
   the block entirely. Colours and SVG paths are never useful probes. */
const usable = (v) => typeof v === "string" && v.length > 6 &&
  !v.includes("var(--") && !/^#[0-9a-f]{3,8}$/i.test(v) &&
  !/^[MmLlHhVvCcZzAaQqSsTt][\d\s.,-]/.test(v);

const collect = (v, out = []) => {
  if (typeof v === "string") { if (usable(v)) out.push(v); }
  else if (v && typeof v === "object") { for (const k of Object.keys(v)) collect(v[k], out); }
  return out;
};

const phrases = (v) => {
  const all = collect(v);
  const prose = all.filter(x => x.length > 12 && x.includes(" ") && !/^[a-z]+[:.]/.test(x));
  return prose.length ? prose : all.sort((a, b) => b.length - a.length).slice(0, 5);
};

const out = [];
const render = (patch) => {
  const c = new Component();
  if (c.seedActivity) { try { c.seedActivity(); } catch {} }
  Object.assign(c.state, patch);
  try { out.push(JSON.stringify(c.renderVals(), (k, v) => typeof v === "function" ? undefined : v)); }
  catch { /* a state combination that will not render is not this check's problem */ }
};

["Home","Agents","Dashboard","Work","Records","Activity","Settings",
 "Automations","System health","Installed modules"].forEach(p => render({page:p}));
["people","teams","structure","agents","wf","notif","integrations","modules","health",
 "security","audit","datamgmt","brand","appearance"].forEach(a => render({page:"Settings", adminOpen:a}));
["tasks","approvals","workflows","schedules"].forEach(w => render({page:"Work", workSection:w}));
["Awaiting you","Awaiting others","Decided"].forEach(v =>
  render({page:"Work", workSection:"approvals", workViews:{approvals:v}}));
["contacts","files","ontology"].forEach(r => render({page:"Records", recSection:r}));
["7d","30d","90d"].forEach(r => render({page:"Dashboard", range:r}));
["sales","cash","operations"].forEach(a => render({page:"Dashboard", aspect:a}));
["all","people","ai","attention"].forEach(k => render({page:"Activity", actKpi:k}));
render({page:"Home", miniOpen:true});
render({page:"Home", paletteOpen:true});
render({page:"Agents", builderGenerated:true});
render({page:"Records", newRecOpen:true});
{ const c = new Component();
  try { c.seedActivity();
    const ev = (c.feeds && c.feeds.people || [])[0];
    if (ev) render({page:"Activity", actOpen:ev.id});
  } catch {} }

const all = out.join("\n");
const missing = [], unprobed = [];
for (const name of BLOCKS) {
  if (KNOWN_UNREACHABLE.has(name)) continue;
  const block = mod.exports[name];
  if (block === undefined) { unprobed.push(name + " (not found)"); continue; }
  const probes = phrases(block);
  if (!probes.length) { unprobed.push(name + " (no prose to probe)"); continue; }
  if (!probes.some(p => all.includes(p))) missing.push(name);
}

if (unprobed.length) console.log("  --  reach — not probed: " + unprobed.join(", "));
if (missing.length) {
  console.error("FAIL  these blocks render nowhere: " + missing.join(", "));
  console.error("      Either they lost their consumer, or a page stopped rendering.");
  process.exit(1);
}
console.log("  ok  reach — every live block appears on a screen (" +
  KNOWN_UNREACHABLE.size + " known-dead skipped)");
