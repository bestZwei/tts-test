export const config = {
    path: "/api/*"
};

const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

// 获取环境变量中的 AUTH_TOKEN
const AUTH_TOKEN = process.env.AUTH_TOKEN;

addEventListener("fetch", event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    try {
        if (request.method === "OPTIONS") {
            return handleOptions(request);
        }

        // 验证 Auth Token（如果设置了 AUTH_TOKEN）
        if (AUTH_TOKEN) {
            const authToken = request.headers.get("x-auth-token");
            if (authToken !== AUTH_TOKEN) {
                return new Response("Unauthorized", {
                    status: 401,
                    headers: {
                        "Content-Type": "text/plain",
                        ...makeCORSHeaders()
                    }
                });
            }
        }

        const requestUrl = new URL(request.url);
        const path = requestUrl.pathname.replace('/api', '');

        switch (path) {
            case "/tts":
                return handleTTS(requestUrl);
            case "/voices":
                return handleVoices(requestUrl);
            default:
                return handleDefault(requestUrl);
        }
    } catch (error) {
        console.error('请求处理错误:', error);
        return new Response("Internal Server Error", { 
            status: 500,
            headers: makeCORSHeaders()
        });
    }
}

async function handleOptions(request) {
    return new Response(null, {
        status: 204,
        headers: {
            ...makeCORSHeaders(),
            "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
            "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "x-auth-token"
        }
    });
}

async function handleTTS(requestUrl) {
    const text = requestUrl.searchParams.get("t") || "";
    const voiceName = requestUrl.searchParams.get("v") || "zh-CN-XiaoxiaoNeural";
    const rate = Number(requestUrl.searchParams.get("r")) || 0;
    const pitch = Number(requestUrl.searchParams.get("p")) || 0;
    const outputFormat = requestUrl.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";
    const download = requestUrl.searchParams.get("d") === "true";
    try {
        const response = await getVoice(text, voiceName, rate, pitch, outputFormat, download);
        return addCORSHeaders(response);
    } catch (error) {
        return new Response("Internal Server Error", { status: 500 });
    }
}

async function handleVoices(requestUrl) {
    const localeFilter = (requestUrl.searchParams.get("l") || "").toLowerCase();
    const format = requestUrl.searchParams.get("f");
    try {
        let voices = await voiceList();
        if (localeFilter) {
            voices = voices.filter(item => item.Locale.toLowerCase().includes(localeFilter));
        }
        if (format === "0") {
            const formattedVoices = voices.map(item => formatVoiceItem(item));
            return new Response(formattedVoices.join("\n"), {
                headers: {
                    "Content-Type": "application/html; charset=utf-8",
                    ...makeCORSHeaders()
                }
            });
        } else if (format === "1") {
            const voiceMap = Object.fromEntries(voices.map(item => [item.ShortName, item.LocalName]));
            return new Response(JSON.stringify(voiceMap), {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    ...makeCORSHeaders()
                }
            });
        } else {
            return new Response(JSON.stringify(voices), {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    ...makeCORSHeaders()
                }
            });
        }
    } catch (error) {
        return new Response("Internal Server Error", { status: 500 });
    }
}

function handleDefault(requestUrl) {
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    const htmlContent = `
    <ol>
        <li> /tts?t=[text]&v=[voice]&r=[rate]&p=[pitch]&o=[outputFormat] <a href="${baseUrl}/api/tts?t=hello, world&v=zh-CN-XiaoxiaoNeural&r=0&p=0&o=audio-24khz-48kbitrate-mono-mp3">试试</a> </li>
        <li> /voices?l=[locale, 如 zh|zh-CN]&f=[format, 0/1/空 0(TTS-Server)|1(MultiTTS)] <a href="${baseUrl}/api/voices?l=zh&f=1">试试</a> </li>
    </ol>
    `;
    return new Response(htmlContent, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...makeCORSHeaders()
        }
    });
}

function makeCORSHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-auth-token",
        "Access-Control-Max-Age": "86400"
    };
}

async function getVoice(text, voiceName, rate, pitch, outputFormat, download) {
    await refreshEndpoint();
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const headers = {
        "Authorization": endpoint.t,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": outputFormat,
        "User-Agent": "okhttp/4.5.0"
    };

    // 构建 SSML 请求体
    const ssml = `
    <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voiceName.split('-')[0]}'>
        <voice name='${voiceName}'>
            <prosody rate='${rate}' pitch='${pitch}'>${text}</prosody>
        </voice>
    </speak>`;

    const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: ssml
    });

    if (!response.ok) {
        throw new Error(`TTS 请求失败，状态码：${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const headersResponse = {
        "Content-Type": outputFormat,
        "Access-Control-Allow-Origin": "*"
    };
    if (download) {
        headersResponse["Content-Disposition"] = `attachment; filename="speech_${Date.now()}.mp3"`;
    }

    return new Response(audioBuffer, { headers: headersResponse });
}

async function refreshEndpoint() {
    if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
        endpoint = await getEndpoint();
        const decodedJwt = JSON.parse(atob(endpoint.t.split(".")[1]));
        expiredAt = decodedJwt.exp;
        clientId = uuid();
        console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    } else {
        console.log(`过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    }
}

async function getEndpoint() {
    const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const headers = {
        "Accept-Language": "zh-Hans",
        "X-ClientVersion": "4.0.530a 5fe1dc6c",
        "X-UserId": "0f04d16a175c411e",
        "X-HomeGeographicRegion": "zh-Hans-CN",
        "X-ClientTraceId": clientId,
        "User-Agent": "okhttp/4.5.0",
        "Content-Type": "application/json; charset=utf-8",
        "Accept-Encoding": "gzip"
    };
    const response = await fetch(endpointUrl, {
        method: "POST",
        headers: headers
    });
    if (!response.ok) {
        throw new Error(`获取 Endpoint 失败，状态码 ${response.status}`);
    }
    return response.json();
}

function uuid() {
    return crypto.randomUUID().replace(/-/g, "");
}

const rateLimit = new Map();
async function checkRateLimit(clientIP) {
    const now = Date.now();
    const limit = 100; // 每分钟请求限制
    const window = 60 * 1000; // 1分钟窗口
    
    // ... 实现速率限制逻辑 ...
}

async function voiceList() {
    const cacheKey = "voice-list-cache";
    const cachedData = await caches.match(cacheKey);
    if (cachedData) return cachedData.json();
    
    // ... 获取语音列表的代码 ...
}