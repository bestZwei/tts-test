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
    try {
        const text = requestUrl.searchParams.get("t") || "";
        const voiceName = requestUrl.searchParams.get("v") || "zh-CN-XiaoxiaoNeural";
        const rate = Number(requestUrl.searchParams.get("r")) || 0;
        const pitch = Number(requestUrl.searchParams.get("p")) || 0;
        const outputFormat = requestUrl.searchParams.get("o") || "audio-24khz-48kbitrate-mono-mp3";

        console.log('TTS请求参数:', { text, voiceName, rate, pitch, outputFormat }); // 调试日志

        if (!text) {
            return new Response(JSON.stringify({ error: "文本不能为空" }), {
                status: 400,
                headers: {
                    "Content-Type": "application/json",
                    ...makeCORSHeaders()
                }
            });
        }

        const audioBuffer = await getVoice(text, voiceName, rate, pitch, outputFormat);
        
        // 验证音频数据
        if (!audioBuffer || audioBuffer.length === 0) {
            throw new Error("生成的音频数据为空");
        }

        console.log('生成的音频大小:', audioBuffer.length); // 调试日志

        return new Response(audioBuffer, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": audioBuffer.length,
                "Cache-Control": "no-cache",
                ...makeCORSHeaders()
            }
        });
    } catch (error) {
        console.error('TTS处理错误:', error);
        return new Response(JSON.stringify({ 
            error: error.message || "生成语音失败",
            details: error.stack
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                ...makeCORSHeaders()
            }
        });
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
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
    };
}

async function getVoice(text, voiceName, rate, pitch, outputFormat) {
    try {
        // 确保 endpoint 是有效的
        if (!endpoint || Date.now() >= expiredAt) {
            await refreshEndpoint();
        }

        // 构建 SSML
        const ssml = buildSSML(text, voiceName, rate, pitch);
        console.log('SSML:', ssml); // 调试日志

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": outputFormat,
                "Authorization": `Bearer ${await getToken()}`,
                "User-Agent": "TTS-Client"
            },
            body: ssml
        });

        if (!response.ok) {
            throw new Error(`语音服务响应错误: ${response.status}`);
        }

        return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
        console.error('获取语音失败:', error);
        throw error;
    }
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