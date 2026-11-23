// 로컬 미리보기 서버 — `npm start` 로 실행 (배포는 Vercel 그대로)
// 정적 파일(index.html, style.css, app.js …)을 내주고 /api/places 는 Vercel 함수를 그대로 호출한다.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/places.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
// 서버 전용 파일은 브라우저에 내주지 않는다
const PRIVATE = /^\/(api|node_modules|\.git)(\/|$)|^\/(server\.js|package(-lock)?\.json)$/;

// Vercel 의 res.status().json() 을 흉내 낸다
function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/places') {
    try {
      await handler(req, vercelRes(res));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) vercelRes(res).status(500).json({ places: [], message: '서버 오류' });
    }
    return;
  }

  const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT + path.sep) || PRIVATE.test(rel)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`여의도시락 → http://localhost:${PORT}`);
});
