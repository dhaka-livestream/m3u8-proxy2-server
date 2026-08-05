export default {
  async fetch(request, env, ctx) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return new Response("❌ Missing ?url= parameter", { status: 400 });
    }

    try {
      // 🔥 হেডার রুলস (আপনার ডোমেইন যোগ করুন)
      const rules = {
        "itcnbd.live": {
          Origin: "https://itcnbd.live",
          Referer: "https://itcnbd.live/",
        },
        // আরও ডোমেইন যোগ করতে পারেন
        // "example.com": { Origin: "https://example.com", Referer: "https://example.com/" },
      };

      // ডিফল্ট হেডার
      let customHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      };

      // ডোমেইন অনুযায়ী রুলস প্রয়োগ
      const host = new URL(targetUrl).hostname;
      for (const ruleHost in rules) {
        if (host.includes(ruleHost)) {
          Object.assign(customHeaders, rules[ruleHost]);
          break;
        }
      }

      // রিডিরেক্ট ফলো সহ ফেচ
      const resp = await fetch(targetUrl, {
        headers: customHeaders,
        redirect: "follow",
      });

      if (!resp.ok) {
        return new Response(
          `❌ Failed to fetch: ${resp.status} ${resp.statusText}`,
          { status: resp.status }
        );
      }

      // কন্টেন্ট টাইপ চেক
      const contentType = resp.headers.get("Content-Type") || "";
      const isM3U8 = contentType.includes("mpegurl") || targetUrl.includes(".m3u8");
      const isMPD = contentType.includes("dash") || targetUrl.includes(".mpd");

      // প্লেলিস্ট ফাইল (M3U8/MPD) প্রক্রিয়াকরণ
      if (isM3U8 || isMPD) {
        let text = await resp.text();

        const proxyBase = new URL(request.url).origin + request.url.pathname + "?url=";
        const baseUrl = new URL(targetUrl);

        // স্মার্ট রিরাইটিং (সম্পূর্ণ + আপেক্ষিক + শুধু ফাইলনেম)
        text = text.replace(/(https?:\/\/[^\s<>"']+\.(?:ts|m3u8|mpd|key|m4s))/gi, (match) => {
          return proxyBase + encodeURIComponent(match);
        });

        text = text.replace(/(?<=["'\s]|^)([^"'\s<>]+\.(?:ts|m3u8|mpd|key|m4s))(?=["'\s]|$)/gi, (match) => {
          try {
            const absoluteUrl = new URL(match, baseUrl).href;
            return proxyBase + encodeURIComponent(absoluteUrl);
          } catch (e) {
            return match;
          }
        });

        // শুধু ফাইলনেম (যেমন: segment_001.ts)
        text = text.replace(/(?<=["'\s]|^)([a-zA-Z0-9_\-]+\.(?:ts|m3u8|mpd|key|m4s))(?=["'\s]|$)/gi, (match) => {
          try {
            const absoluteUrl = new URL(match, baseUrl).href;
            return proxyBase + encodeURIComponent(absoluteUrl);
          } catch (e) {
            return match;
          }
        });

        const finalContentType = isM3U8
          ? "application/vnd.apple.mpegurl"
          : "application/dash+xml";

        return new Response(text, {
          status: 200,
          headers: {
            "Content-Type": finalContentType,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-store",
          },
        });
      }

      // TS/KEY বা অন্য ফাইল সরাসরি পাস (CORS হেডার যোগ করে)
      const newHeaders = new Headers(resp.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "*");
      newHeaders.set("Cache-Control", "public, max-age=86400");

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response("❌ Worker error: " + err.message, { status: 500 });
    }
  },
};
