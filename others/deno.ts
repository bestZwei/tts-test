import { serve } from "https://deno.land/std/http/server.ts";
import { EdgeSpeechTTS } from "https://esm.sh/@lobehub/tts@1";

const AUTH_TOKEN = Deno.env.get("AUTH_TOKEN");
const VOICES_URL = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";

interface Voice {
  model: string;
  name: string;
  friendlyName: string;
  locale: string;
}

async function fetchVoiceList(): Promise<Voice[]> {
  try {
    const response = await fetch(VOICES_URL);
    if (!response.ok) {
      throw new Error(`无法获取声音列表，状态码：${response.status}`);
    }
    const voices = await response.json();
    return voices.map((voice: any) => ({
      model: voice.ShortName,
      name: voice.ShortName,
      friendlyName: voice.FriendlyName,
      locale: voice.Locale
    }));
  } catch (error) {
    console.error(`获取声音列表时出错：${error.message}`);
    return [];
  }
}

async function synthesizeSpeech(text: string, voice: string, rate: number, pitch: number, format: string, download: boolean): Promise<Response> {
  const tts = new EdgeSpeechTTS();

  const payload = {
    input: text,
    options: { 
      rate: rate,
      pitch: pitch,
      voice: voice
    },
  };
  const response = await tts.create(payload);
  const mp3Buffer = new Uint8Array(await response.arrayBuffer());

  const headers: HeadersInit = {
    "Content-Type": format,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="speech_${Date.now()}.mp3"`;
  }
  return new Response(mp3Buffer, { headers });
}

function unauthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  return AUTH_TOKEN ? authHeader !== `Bearer ${AUTH_TOKEN}` : false;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }

  if (unauthorized(req)) {
    console.log("未授权的请求");
    return new Response("Unauthorized", { status: 401, headers: makeCORSHeaders() });
  }

  switch (path) {
    case "/tts":
      if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: makeCORSHeaders() });
      }
      return await handleTTSRequest(url);
    case "/voices":
      if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: makeCORSHeaders() });
      }
      return await handleVoicesRequest(url);
    default:
      return serveHomepage(url);
  }
}

async function handleTTSRequest(url: URL): Promise<Response> {
  const text = url.searchParams.get("text");
  const voice = url.searchParams.get("voice");
  const rate = Number(url.searchParams.get("rate") || "0");
  const pitch = Number(url.searchParams.get("pitch") || "0");
  const format = url.searchParams.get("format") || "audio/mpeg";
  const download = url.searchParams.get("download") === "true";

  if (!text || !voice) {
    return new Response("Bad Request: Missing required parameters", { status: 400, headers: makeCORSHeaders() });
  }

  console.log(`TTS 请求 - text=${text}, voice=${voice}, rate=${rate}, pitch=${pitch}, format=${format}, download=${download}`);
  return await synthesizeSpeech(text, voice, rate, pitch, format, download);
}

async function handleVoicesRequest(url: URL): Promise<Response> {
  const locale = url.searchParams.get("locale")?.toLowerCase();
  const format = url.searchParams.get("format") || "json";
  const detail = url.searchParams.get("detail") === "true";

  let voices: Voice[] = await fetchVoiceList();

  if (locale) {
    voices = voices.filter(item => item.locale.toLowerCase().includes(locale));
  }

  switch (format) {
    case "yaml":
      return formatVoicesAsYAML(voices, detail);
    case "json_map":
      return formatVoicesAsMapJSON(voices);
    default:
      return new Response(JSON.stringify(voices), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...makeCORSHeaders()
        }
      });
  }
}

function formatVoicesAsYAML(voices: Voice[], detail: boolean): Response {
  const grouped: Record<string, Voice[]> = voices.reduce((acc, voice) => {
    const locale = voice.locale;
    if (!acc[locale]) acc[locale] = [];
    acc[locale].push(voice);
    return acc;
  }, {} as Record<string, Voice[]>);

  const formatted = Object.entries(grouped).map(([locale, voiceList]) => `
${locale}:
  ${voiceList.map(item => detail ? `
  - !!org.nobody.multitts.tts.speaker.Speaker
    avatar: ''
    code: ${item.model}
    desc: ''
    extendUI: ''
    gender: ${item.name.includes("女") ? "0" : "1"}
    name: ${item.friendlyName}
    note: 'wpm: 150'
    param: ''
    sampleRate: 24000
    speed: 1.5
    type: 1
    volume: 1` : `
  - model: ${item.model}
    name: ${item.name}
    friendlyName: ${item.friendlyName}
    locale: ${item.locale}`).join("\n")}`).join("\n");

  return new Response(formatted, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      ...makeCORSHeaders()
    }
  });
}

function formatVoicesAsMapJSON(voices: Voice[]): Response {
  const map = new Map(voices.map(item => [item.model, item.name]));
  return new Response(JSON.stringify(Object.fromEntries(map)), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...makeCORSHeaders()
    }
  });
}

function serveHomepage(url: URL): Response {
  const baseUrl = `${url.protocol}//${url.host}`;
  const htmlContent = `
  <html>
    <head>
      <title>TTS API 使用示例</title>
    </head>
    <body>
      <h1>API 使用示例</h1>
      <ol>
        <li>
          <strong>/tts</strong> 接口:
          <pre>GET /tts?text=你好&voice=zh-CN-XiaoxiaoNeural&rate=0&pitch=0&format=audio/mpeg&download=true</pre>
          <a href="${baseUrl}/tts?text=你好&voice=zh-CN-XiaoxiaoNeural&rate=0&pitch=0&format=audio/mpeg&download=true">试试</a>
        </li>
        <li>
          <strong>/voices</strong> 接口:
          <ul>
            <li>获取所有语音列表：<pre>GET /voices</pre>
              <a href="${baseUrl}/voices">试试</a>
            </li>
            <li>按地区过滤：<pre>GET /voices?locale=zh</pre>
              <a href="${baseUrl}/voices?locale=zh">试试</a>
            </li>
            <li>YAML格式（详细信息）：<pre>GET /voices?format=yaml&detail=true</pre>
              <a href="${baseUrl}/voices?format=yaml&detail=true">试试</a>
            </li>
            <li>JSON Map格式：<pre>GET /voices?format=json_map</pre>
              <a href="${baseUrl}/voices?format=json_map">试试</a>
            </li>
          </ul>
        </li>
      </ol>
    </body>
  </html>
  `;
  return new Response(htmlContent, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...makeCORSHeaders()
    }
  });
}

function makeCORSHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

serve(async (req) => {
  try {
    return await handleRequest(req);
  } catch (err) {
    console.error(`处理请求时出错：${err.message}`);
    return new Response(`Internal Server Error\n${err.message}`, {
      status: 500,
      headers: makeCORSHeaders()
    });
  }
});