/* Count check: the layouts are built around these list lengths.
   A customisation pass that adds a seventh organisation or drops an inbox item
   breaks a grid somewhere, so the counts are asserted rather than trusted.
   Usage: node tools/counts.js "Pulse v4 Glass.dc.html"                      */
const fs = require("fs"), Module = require("module");

const FILE = process.argv[2] || "Pulse v4 Glass.dc.html";
const src = fs.readFileSync(FILE, "utf8");
const js = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*)<\/script>/)[1];

global.window = {innerWidth:1440, devicePixelRatio:2, addEventListener(){}, removeEventListener(){}};
global.document = {createElement:()=>({getContext:()=>null, style:{}}), addEventListener(){}, removeEventListener(){}};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

/* Every list the layouts depend on, and the length they must keep. */
const EXPECTED = {
  CONTACTS:9, ORGS:6, LOCATIONS:3, TEAMS:4, PEOPLE:6, INTEGRATIONS:7,
  NAV:6, THEMES:8, ROLE_LEVELS:4, PERM_KEYS:3,
  ITEMS:5, ORDER:5, HOME_SUGGESTIONS:3, HOME_ACTIVITY:5, MINI_SUGGESTIONS:3,
  VISIT_WIDGET:3, MINI_NOTIFICATIONS:3, PALETTE_RECENT:2, PALETTE_FREQUENT:6,
  QUEUE_TASKS:8, WORK_TASKS:6, WORK_WIDGETS:4, APPROVAL_ROWS:3,
  WORKFLOWS:4, SCHEDULES:5, SCHEDULE_NEXT:3, WORK_SECTIONS:4,
  KPI_DEFS:8, REVENUE_SPLIT:3,
  DATA_EVENTS:9, PEOPLE_EVENTS:8, AI_EVENTS:8, STREAM_DEFS:3, ACTIVITY_KPIS:4,
  ADMIN_CARDS:14, ADMIN_URGENT:4, ROLES:4, EVENT_DIFF:3,
  AUTOMATION_ROWS:4, HEALTH_TILES:4, HEALTH_FAILURES:3, HEALTH_CALLS:5,
  NOTIFICATION_FEED:6, MODULE_ROWS:4, BUILDER_BLOCKS:8,
  ONTO_NODES:15, REC_SECTIONS:3, FILE_TREE:9,
  SKILL_DEFS:6, CONTEXT_SOURCES:6, PERSONALITIES:4, ANSWER_STYLES:3
};

const mod = new Module("dc");
mod._compile(
  "class DCLogic{constructor(){this.state={};}setState(){}};" + js +
  "\n;module.exports={" + Object.keys(EXPECTED).join(",") + "};", "/dc.js");

const size = (v) => Array.isArray(v) ? v.length
  : (v && typeof v === "object") ? Object.keys(v).length : null;

let bad = 0;
for (const [name, want] of Object.entries(EXPECTED)) {
  const got = size(mod.exports[name]);
  if (got === null) { console.error(`FAIL  ${name} is missing`); bad++; }
  else if (got !== want) { console.error(`FAIL  ${name} has ${got}, layout needs ${want}`); bad++; }
}
if (bad) { console.error(`\n${bad} list(s) changed length. Restore the counts or the layouts break.`); process.exit(1); }
console.log("  ok  counts — " + Object.keys(EXPECTED).length + " lists at their expected length");
