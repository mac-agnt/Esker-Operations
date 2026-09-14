/* Tiny static server so you can look at the template in a browser.
   The page pulls React from a CDN at runtime, so it needs http rather than
   file://, but nothing has to be installed.

     node tools/serve.js          then open http://localhost:8731
     node tools/serve.js 3000     to use another port                        */
const http = require("http"), fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 8731;
const TYPES = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
               ".json":"application/json", ".css":"text/css", ".svg":"image/svg+xml"};

/* Default to the largest .dc.html in the root: the app rather than one of the
   small imported components, and it keeps working if the file is renamed. */
const landing = fs.readdirSync(ROOT)
  .filter(f => f.endsWith(".dc.html"))
  .map(f => [f, fs.statSync(path.join(ROOT, f)).size])
  .sort((a, b) => b[1] - a[1])
  .map(([f]) => f)[0];

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (p === "/") p = "/" + (landing || "index.html");
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found: " + p); return; }
    res.writeHead(200, {"Content-Type": TYPES[path.extname(file)] || "application/octet-stream"});
    res.end(data);
  });
}).listen(PORT, () => {
  console.log("serving " + (landing || "this folder") + " at http://localhost:" + PORT);
});
