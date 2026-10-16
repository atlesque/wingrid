// Receives layouts from scripts/capture-layout.js and saves them to layout/<name>.json.
// node scripts/capture-server.mjs   (listens on 127.0.0.1:8796)
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('layout', { recursive: true });
createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1)).replace(/[^a-z0-9_-]/gi, '');
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    if (req.method === 'POST' && name) {
      writeFileSync(`layout/${name}.json`, JSON.stringify(JSON.parse(body), null, 1));
      console.log(`saved layout/${name}.json (${body.length} bytes)`);
    }
    res.writeHead(204, { 'access-control-allow-origin': '*' });
    res.end();
  });
}).listen(8796, '127.0.0.1', () => console.log('capture server on http://127.0.0.1:8796'));
