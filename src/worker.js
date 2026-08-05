// ============================================================
//  Cloudflare Worker - HLS Proxy with 60-Second Expiry Token (Universal)
//  Variant m3u8, Key, MAP, Query String সব হ্যান্ডেল করে।
// ============================================================

const CHANNEL_MAP = {
  "starjalshahd-bdx2": "https://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xOS4xNy4yMzA6ODA5MC9obHMvU3RhckphbHNoYUhELm0zdTg.m3u8",
  "zeebanglahd-bdx2": "http://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xNi4yMDAuMjA1OjgwODgvMzAxL3RyYWNrcy12MWExL21vbm8ubTN1OD90b2tlbj00MTNmNjk2N2JjMWVkZmRkZDk2MzJmYzg4NmMwNjcyYTQ4ZDViZDgzLWI5NTkyYjI5OTAzMWZhNTUwMWQxNGJiYWZmN2NiNmI2LTE3ODU4NTMwOTctMTc4NTg0OTQ5Nw.m3u8",
  "starjalshahd-bdx3": "https://footfytv.pro/proxy/direct?url=http://103.151.61.12/Star_Jalsha/tracks-v1a1/mono.m3u8",
  "sonyaath-bdx2": "https://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xNi4yMDAuMjA1OjgwODgvMzA2L3RyYWNrcy12MWExL21vbm8ubTN1OD90b2tlbj02MzgwMWM2ODcyZWMyN2JlOTEyYjAxMTQzMjhlZTdmNWVhZGUyOWQxLThlMjI1YmFjMDM5ZjA4YmJmNzZiZmRkOTU5YzEwNDExLTE3ODU4ODkxNDUtMTc4NTg4NTU0NQ.m3u8",
  "zeebanglasd": "http://27.124.71.27/Zee_Bangla/index.m3u8",
  "somoytv": "https://live.thebosstv.com:30443/dwlive/Somoy-TV/chunks.m3u8",
};

async function generateHmac(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateToken(segmentPath, expiry, token, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (now > expiry) return false;
  const expectedToken = await generateHmac(`${segmentPath}:${expiry}`, secret);
  return token === expectedToken;
}

async function createProxyUrl(originalUrl, baseUrl, channelName, expiry, secret, workerBase) {
  try {
    const fullUrl = new URL(originalUrl, baseUrl);
    const pathname = fullUrl.pathname;
    const query = fullUrl.search;
    const token = await generateHmac(`${pathname}:${expiry}`, secret);
    const encodedQuery = encodeURIComponent(query);
    return `${workerBase}/p/${channelName}${pathname}?expiry=${expiry}&token=${token}&oq=${encodedQuery}`;
  } catch {
    return originalUrl;
  }
}

async function rewriteM3U8Content(text, baseUrl, channelName, secret, workerBase) {
  const lines = text.split('\n');
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 60;

  const rewritten = await Promise.all(lines.map(async (line) => {
    const keyMatch = line.match(/^(#EXT-X-KEY:|#EXT-X-MAP:)(.*?)URI="([^"]*)"/i);
    if (keyMatch) {
      const prefix = keyMatch[1];
      const rest = keyMatch[2];
      const originalUri = keyMatch[3];
      const newUri = await createProxyUrl(originalUri, baseUrl, channelName, expiry, secret, workerBase);
      return `${prefix}${rest}URI="${newUri}"`;
    }

    if (!line.startsWith('#') && line.trim() !== '') {
      return await createProxyUrl(line, baseUrl, channelName, expiry, secret, workerBase);
    }
    return line;
  }));

  return rewritten.join('\n');
}

export default {
  async fetch(request, env, ctx) {
    const SECRET = env.SECRET_KEY;
    if (!SECRET) return new Response('SECRET_KEY missing', { status: 500 });

    const url = new URL(request.url);
    const pathname = url.pathname;
    const workerBase = `https://${request.headers.get('host')}`;

    if (pathname.startsWith('/p/')) {
      const parts = pathname.replace(/^\/p\//, '').split('/');
      if (parts.length < 2) return new Response('Invalid proxy path', { status: 400 });
      
      const channelName = parts[0];
      const relativePath = '/' + parts.slice(1).join('/');
      
      const expiry = parseInt(url.searchParams.get('expiry'));
      const token = url.searchParams.get('token');
      const originalQuery = url.searchParams.get('oq') || '';

      if (!expiry || !token) return new Response('Missing token/expiry', { status: 401 });
      const isValid = await validateToken(relativePath, expiry, token, SECRET);
      if (!isValid) return new Response('Invalid/Expired Token', { status: 403 });

      const originalBase = CHANNEL_MAP[channelName];
      if (!originalBase) return new Response('Channel not found', { status: 404 });
      
      const baseUrl = originalBase.substring(0, originalBase.lastIndexOf('/') + 1);
      const originalUrl = baseUrl + relativePath.slice(1) + decodeURIComponent(originalQuery);

      const resp = await fetch(originalUrl, {
        headers: { 'User-Agent': 'VLC/3.0.0', 'Origin': new URL(originalBase).origin }
      });

      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('mpegurl') || relativePath.endsWith('.m3u8') || relativePath.endsWith('.m3u')) {
        const text = await resp.text();
        const rewritten = await rewriteM3U8Content(text, baseUrl, channelName, SECRET, workerBase);
        return new Response(rewritten, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache, no-store', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const newHeaders = new Headers(resp.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store');
      newHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { status: resp.status, headers: newHeaders });
    }

    if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
      const channelName = pathname.slice(1, -5); 
      if (CHANNEL_MAP[channelName]) {
        const baseUrl = CHANNEL_MAP[channelName].substring(0, CHANNEL_MAP[channelName].lastIndexOf('/') + 1);
        const resp = await fetch(CHANNEL_MAP[channelName], {
          headers: { 'User-Agent': 'VLC/3.0.0', 'Origin': new URL(CHANNEL_MAP[channelName]).origin }
        });
        const text = await resp.text();
        const rewritten = await rewriteM3U8Content(text, baseUrl, channelName, SECRET, workerBase);
        return new Response(rewritten, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache, no-store', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
