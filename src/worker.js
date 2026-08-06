// ============================================================
//  HLS PROXY (MERGED) - /segment/ রাউটিং + 600sec টোকেন + উন্নত হেডার
// ============================================================

const CHANNEL_MAP = {
  "starjalshahd-bdx2": "https://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xOS4xNy4yMzA6ODA5MC9obHMvU3RhckphbHNoYUhELm0zdTg.m3u8",
  "zeebanglahd-bdx2": "http://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xNi4yMDAuMjA1OjgwODgvMzAxL3RyYWNrcy12MWExL21vbm8ubTN1OD90b2tlbj00MTNmNjk2N2JjMWVkZmRkZDk2MzJmYzg4NmMwNjcyYTQ4ZDViZDgzLWI5NTkyYjI5OTAzMWZhNTUwMWQxNGJiYWZmN2NiNmI2LTE3ODU4NTMwOTctMTc4NTg0OTQ5Nw.m3u8",
  "starjalshahd-bdx3": "https://footfytv.pro/proxy/direct?url=http://103.151.61.12/Star_Jalsha/tracks-v1a1/mono.m3u8",
  "sonyaath-bdx2": "https://s3.itcnbd.live/server-4/stream/aHR0cDovLzE3Mi4xNi4yMDAuMjA1OjgwODgvMzA2L3RyYWNrcy12MWExL21vbm8ubTN1OD90b2tlbj02MzgwMWM2ODcyZWMyN2JlOTEyYjAxMTQzMjhlZTdmNWVhZGUyOWQxLThlMjI1YmFjMDM5ZjA4YmJmNzZiZmRkOTU5YzEwNDExLTE3ODU4ODkxNDUtMTc4NTg4NTU0NQ.m3u8",
  "zeebanglasd": "http://27.124.71.27/Zee_Bangla/index.m3u8",
  "somoytv": "https://live.thebosstv.com:30443/dwlive/Somoy-TV/chunks.m3u8",
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

// ------------------ m3u8 রিওরাইটার (আপডেটেড) ------------------
async function rewriteM3U8(originalUrl, channelName, request, secret) {
  const response = await fetch(originalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': new URL(originalUrl).origin,
      'Referer': originalUrl,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    }
  });

  if (!response.ok) {
    return new Response(`Origin fetch failed: ${response.status}`, { status: response.status });
  }

  const text = await response.text();
  const lines = text.split('\n');
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 600; // 🔥 ১০ মিনিট (পুরোনো ৬০-এর বদলে)

  const workerBase = `https://${request.headers.get('host')}`;

  const rewrittenLines = await Promise.all(lines.map(async (line) => {
    // #EXT-X-KEY বা #EXT-X-MAP এর URI="..." রিরাইট
    const keyMatch = line.match(/^(#EXT-X-KEY:|#EXT-X-MAP:)(.*?)URI="([^"]*)"/i);
    if (keyMatch) {
      const prefix = keyMatch[1];
      const rest = keyMatch[2];
      const originalUri = keyMatch[3];
      
      let fullUri;
      try {
        fullUri = new URL(originalUri, baseUrl).href;
      } catch {
        return line;
      }
      
      const urlObj = new URL(fullUri);
      const pathname = urlObj.pathname;
      const query = urlObj.search;
      
      const token = await generateHmac(`${pathname}:${expiry}`, secret);
      const encodedQuery = encodeURIComponent(query);
      const newUri = `${workerBase}/segment/${channelName}${pathname}?expiry=${expiry}&token=${token}&oq=${encodedQuery}`;
      
      return `${prefix}${rest}URI="${newUri}"`;
    }

    // সাধারণ সেগমেন্ট বা সাব-প্লেলিস্ট (যেগুলো # দিয়ে শুরু নয়)
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
      const encodedQuery = encodeURIComponent(query);
      const newSegmentUrl = `${workerBase}/segment/${channelName}${pathname}?expiry=${expiry}&token=${token}&oq=${encodedQuery}`;
      
      return newSegmentUrl;
    }
    
    return line;
  }));

  return new Response(rewrittenLines.join('\n'), {
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
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

    // ------ রুট ১: চ্যানেলের m3u8 লোড করুন (যেমন: /starjalsha.m3u8) ------
    if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
      const channelName = pathname.slice(1, -5);
      
      if (CHANNEL_MAP[channelName]) {
        const originalM3U8 = CHANNEL_MAP[channelName];
        return await rewriteM3U8(originalM3U8, channelName, request, SECRET);
      } else {
        return new Response('Channel not found in map', { status: 404 });
      }
    }

    // ------ রুট ২: টোকেন-সহ সেগমেন্ট লোড করুন (যেমন: /segment/starjalsha/stream/abc.ts) ------
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
        return new Response('403 Forbidden: Token Expired or Invalid', { 
          status: 403,
          headers: { 'X-Error': 'Token expired' }
        });
      }

      const originalBase = CHANNEL_MAP[channelName];
      if (!originalBase) {
        return new Response('Channel not found', { status: 404 });
      }
      
      const baseUrl = originalBase.substring(0, originalBase.lastIndexOf('/') + 1);
      const originalSegmentUrl = baseUrl + segmentRelativePath.slice(1) + decodeURIComponent(originalQuery);

      // 🔥 উন্নত হেডার
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': new URL(originalBase).origin,
        'Referer': originalBase,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      };

      // যদি ক্লায়েন্ট Range হেডার পাঠায়, সেটা ফরোয়ার্ড করি
      if (request.headers.get('range')) {
        headers['Range'] = request.headers.get('range');
      }

      const segmentResponse = await fetch(originalSegmentUrl, { headers });

      const newHeaders = new Headers(segmentResponse.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Headers', '*');
      
      return new Response(segmentResponse.body, {
        status: segmentResponse.status,
        headers: newHeaders
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
