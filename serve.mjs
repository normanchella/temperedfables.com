/* Tiny local preview server for ./dist — run: npm run serve  */
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "dist");
const TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
};

http.createServer(async (req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url.endsWith("/")) url += "index.html";
  let file = path.join(ROOT, url);
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const fallback = await fs.readFile(path.join(ROOT, "404.html"));
      res.writeHead(404, { "content-type": "text/html" });
      res.end(fallback);
    } catch { res.writeHead(404); res.end("404"); }
  }
}).listen(8080, () => console.log("→ Preview at http://localhost:8080"));
