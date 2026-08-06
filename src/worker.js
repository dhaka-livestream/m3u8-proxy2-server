// ============================================================
//  Merged HLS Proxy - (Your Working Base + Advanced Features)
//  Token Expiry: 600 seconds (10 minutes)
// ============================================================

const CHANNEL_MAP = {
  "starjalshahd-bdx2": "https://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xOS4xNy4yMzA6ODA5MC9obHMvU3RhckphbHNoYUhELm0zdTg.m3u8",
  "zeebanglahd-bdx2": "http://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xNi4yMDAuMjA1OjgwODgvMzAxL3RyYWNrcy12MWExL21vbm8ubTN1OD90b2tlbj00MTNmNjk2N2JjMWVkZmRkZDk2MzJmYzg4NmMwNjcyYTQ4ZDViZDgzLWI5NTkyYjI5OTAzMWZhNTUwMWQxNGJiYWZmN2NiNmI2LTE3ODU4NTMwOTctMTc4NTg0OTQ5Nw.m3u8",
  "starjalshahd-bdx3": "https://footfytv.pro/proxy/direct?url=http://103.151.61.12/Star_Jalsha/tracks-v1a1/mono.m3u8",
  "sonyaath-bdx2": "https://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xNi4yMDAuMjA1OjgwODgvMzA2L3RyYWNrcy12MWExL21vbm8ubTN1OD90b2tlbj02MzgwMWM2ODcyZWMyN2JlOTEyYjAxMTQzMjhlZTdmNWVhZGUyOWQxLThlMjI1YmFjMDM5ZjA4YmJmNzZiZmRkOTU5YzEwNDExLTE3ODU4ODkxNDUtMTc4NTg4NTU0NQ.m3u8",
  "zeebanglasd": "http://27.124.71.27/Zee_Bangla/index.m3u8",
  "somoytv": "https://live.thebosstv.com:30443/dwlive/Somoy-TV/chunks.m3u8",
  "sports": "https://another-server.com/sports/playlist.m3u8",
};

// ------------------ ইউটিলিটি ফাংশন ------------------
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

// ------------------ m3u8 রিওরাইটার (Variant, Key, MAP সহ) ------------------
async function rewriteM3U8(originalUrl, channelName, request, secret) {
  const response = await fetch(originalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': new URL(originalUrl).origin,
      'Referer': originalUrl,
    }
  });

  if (!response.ok) {
    return new Response(`Origin fetch failed: ${response.status}`, { status: response.status });
  }

  const text = await response.text();
  const lines = text.split('\n');
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 600; // ১০ মিনিট মেয়াদ (আপনার চাহিদা অনুযায়ী)

  const workerBase = `https://${request.headers.get('host')}`;

  const rewrittenLines = await Promise.all(lines.map(async (line) => {
    // 1. #EXT-X-KEY বা #EXT-X-MAP URI রিরাইট
    const keyMatch = line.match(/^(#EXT-X-KEY:|#EXT-X-MAP:)(.*?)URI="([^"]*)"/i);
    if (keyMatch) {
      const prefix = keyMatch[1];
      const rest = keyMatch[2];
      const originalUri = keyMatch[3];
      const fullUrl = new URL(originalUri, baseUrl);
      const pathname = fullUrl.pathname;
      const query = fullUrl.search;
      const token = await generateHmac(`${pathname}:${expiry}`, secret);
      const newUri = `${workerBase}/segment/${channelName}${pathname}?expiry=${expiry}&token=${token}&oq=${encodeURIComponent(query)}`;
      return `${prefix}${rest}URI="${newUri}"`;
    }

    // 2. সাধারণ সেগমেন্ট বা variant প্লেলিস্ট (যে লাইন # দিয়ে শুরু না)
    if (!line.startsWith('#') && line.trim() !== '') {
      let segmentUrl;
      try {
        segmentUrl = new URL(line, baseUrl).href;
      } catch {
        return line;
      }
      const urlObj = new URL(segmentUrl);
      const pathname = urlObj.pathname;
      const query = urlObj.search;
      const token = await generateHmac(`${pathname}:${expiry}`, secret);
      return `${workerBase}/segment/${channelName}${pathname}?expiry=${expiry}&token=${token}&oq=${encodeURIComponent(query)}`;
    }

    return line;
  }));

  return new Response(rewrittenLines.join('\n'), {
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

// ------------------ মেইন হ্যান্ডলার ------------------
export default {
  async fetch(request, env, ctx) {
    const SECRET = env.SECRET_KEY;
    if (!SECRET) {
      return new Response('Server configuration error: SECRET_KEY missing', { status: 500 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ------ রুট ১: m3u8 লোড (যেমন /starjalsha.m3u8) ------
    if (pathname.endsWith('.m3u8')) {
      const channelName = pathname.slice(1, -5);
      if (CHANNEL_MAP[channelName]) {
        return await rewriteM3U8(CHANNEL_MAP[channelName], channelName, request, SECRET);
      }
    }

    // ------ রুট ২: সেগমেন্ট লোড (/segment/...) ------
    const pathParts = pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (pathParts.length >= 3 && pathParts[0] === 'segment') {
      const channelName = pathParts[1];
      const segmentRelativePath = '/' + pathParts.slice(2).join('/');

      const expiry = parseInt(url.searchParams.get('expiry'));
      const token = url.searchParams.get('token');
      const originalQuery = url.searchParams.get('oq') || '';

      if (!expiry || !token) {
        return new Response('Missing token or expiry', { status: 401 });
      }

      const isValid = await validateToken(segmentRelativePath, expiry, token, SECRET);
      if (!isValid) {
        return new Response('403 Forbidden: Token Expired or Invalid', { status: 403 });
      }

      const originalBase = CHANNEL_MAP[channelName];
      if (!originalBase) {
        return new Response('Channel not found', { status: 404 });
      }

      const baseUrl = originalBase.substring(0, originalBase.lastIndexOf('/') + 1);
      const originalSegmentUrl = baseUrl + segmentRelativePath.slice(1) + decodeURIComponent(originalQuery);

      const segmentResponse = await fetch(originalSegmentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': new URL(originalBase).origin,
          'Referer': originalBase,
        }
      });

      const newHeaders = new Headers(segmentResponse.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(segmentResponse.body, {
        status: segmentResponse.status,
        headers: newHeaders
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
