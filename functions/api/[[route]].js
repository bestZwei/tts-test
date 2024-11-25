export const config = {
    path: "/api/*"
};

const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

export async function onRequest(context) {
    const { request, env } = context;
    
    if (request.method === "OPTIONS") {
        return handleOptions(request);
    }

    if (env.AUTH_TOKEN) {
        const authToken = request.headers.get("x-auth-token");
        if (authToken !== env.AUTH_TOKEN) {
            return new Response("Unauthorized", {
                status: 401,
                headers: makeCORSHeaders()
            });
        }
    }

    try {
        const url = new URL(request.url);
        const path = url.pathname.replace('/api', '');
        
        switch (path) {
            case "/tts":
                return await handleTTS(url);
            case "/voices":
                return await handleVoices(url);
            default:
                return handleDefault(url);
        }
    } catch (error) {
        console.error('Error handling request:', error);
        return new Response("Internal Server Error", {
            status: 500,
            headers: makeCORSHeaders()
        });
    }
}

function makeCORSHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-auth-token",
        "Access-Control-Max-Age": "86400"
    };
}

function handleOptions(request) {
    return new Response(null, {
        status: 204,
        headers: {
            ...makeCORSHeaders(),
            "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "x-auth-token"
        }
    });
}

// ... 从原 workers.js 复制所有其他函数 ...
// 包括：handleTTS, handleVoices, handleDefault, getVoice, 
// generateSsml, formatVoiceItem, voiceList, refreshEndpoint,
// getEndpoint, generateSignature, 等所有辅助函数 ...