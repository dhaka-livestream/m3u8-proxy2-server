// ============================================================
//  HLS PROXY - FULLY WORKING WITH TEST CHANNEL
// ============================================================

const CHANNEL_MAP = {
  // 🔥 টেস্ট চ্যানেল (সর্বদা কাজ করে - Mux demo stream)
  "test": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  
  // আপনার চ্যানেলগুলো (হয়তো হেডার বা টোকেন ইস্যু আছে)
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
  const expiry = now + 600; // 10 minutes

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
    if (!SECRET) {
      return new Response('SECRET_KEY missing. Please add SECRET_KEY in Cloudflare Worker Environment Variables.', { status: 500 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const workerBase = `https://${request.headers.get('host')}`;

    // --- PROXY ROUTE ---
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

      // 🟢 স্মার্ট হেডার
      const sourceDomain = new URL(originalBase).hostname;
      
      const resp = await fetch(originalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': `https://${sourceDomain}`,
          'Referer': `https://${sourceDomain}/`,
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache'
        }
      });

      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('mpegurl') || relativePath.endsWith('.m3u8') || relativePath.endsWith('.m3u')) {
        const text = await resp.text();
        const rewritten = await rewriteM3U8Content(text, baseUrl, channelName, SECRET, workerBase);
        return new Response(rewritten, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        });
      }

      const newHeaders = new Headers(resp.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { status: resp.status, headers: newHeaders });
    }

    // --- MAIN M3U8 ROUTE ---
    if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
      const channelName = pathname.slice(1, -5); 
      if (CHANNEL_MAP[channelName]) {
        const originalUrl = CHANNEL_MAP[channelName];
        const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
        const sourceDomain = new URL(originalUrl).hostname;

        const resp = await fetch(originalUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin': `https://${sourceDomain}`,
            'Referer': `https://${sourceDomain}/`,
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
          }
        });
        
        const text = await resp.text();
        const rewritten = await rewriteM3U8Content(text, baseUrl, channelName, SECRET, workerBase);
        return new Response(rewritten, {
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        });
      }
    }

    return new Response('Channel not found. Available channels: ' + Object.keys(CHANNEL_MAP).join(', '), { status: 404 });
  }
};
