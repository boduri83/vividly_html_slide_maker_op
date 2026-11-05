import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const requested = decodeURIComponent(url.pathname);
    const relative = requested === '/' ? 'index.html' : requested.slice(1);
    const allowed = ['index.html', 'styles.css', 'src/design-studio-ui.css', 'src/behavior-studio-ui.css', 'src/scene-studio-ui.css', 'src/avatar-ui.css', 'src/data-connector-ui.css', 'examples/document-contract-v0.1.json', 'examples/workbench-showcase.json', 'examples/motion-showcase.json', 'examples/business-showcase.json', 'examples/advanced-showcase.json'].includes(relative)
      || (relative.startsWith('src/') && relative.endsWith('.js'))
      || /^assets\/vendor\/[a-z\d-]+\.js$/i.test(relative)
      || /^assets\/brand\/[a-z\d-]+\.(png|svg|ico)$/i.test(relative);
    const target = path.resolve(root, relative);
    if (!allowed || !target.startsWith(root) || request.method !== 'GET') {
      response.writeHead(404); response.end('Not found'); return;
    }
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src blob:; form-action 'none'" });
    response.end(data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 400);
    response.end('Unable to serve this resource');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`HTML Slide: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
