let apiConfig = null;
let lastRequestTime = 0;
let currentAudioURL = null;

const API_ENDPOINTS = {
    'workers-api': '/api/tts',
    'deno-api': 'https://deno-tts.api.zwei.de.eu.org/tts'
};

async function loadSpeakers() {
    try {
        const response = await fetch('/speakers.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        if (!data || !data['workers-api'] || !data['workers-api'].speakers) {
            throw new Error('无效的讲述人配置数据');
        }
        
        apiConfig = data;
        console.log('成功加载讲述人配置:', apiConfig);
        
        const defaultApi = 'workers-api';
        $('#api').val(defaultApi);
        updateSpeakerOptions(defaultApi);
        
    } catch (error) {
        console.error('加载讲述人失败:', error);
        showError('加载讲述人失败，请刷新页面重试');
        $('#speaker').empty().append(new Option('加载失败，请刷新重试', ''));
    }
}

function updateSpeakerOptions(apiName) {
    console.group('更新讲述人选项');
    console.log('API名称:', apiName);
    console.log('当前配置:', apiConfig);
    
    const speakerSelect = $('#speaker');
    speakerSelect.empty();
    
    try {
        if (!apiConfig || !apiConfig[apiName] || !apiConfig[apiName].speakers) {
            throw new Error(`无效的API配置: ${apiName}`);
        }

        const speakers = apiConfig[apiName].speakers;
        console.log('可用讲述人:', speakers);

        if (Object.keys(speakers).length === 0) {
            speakerSelect.append(new Option('暂无可用讲述人', ''));
            return;
        }

        const sortedSpeakers = Object.entries(speakers)
            .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));

        sortedSpeakers.forEach(([key, value]) => {
            speakerSelect.append(new Option(value, key));
        });

        const defaultSpeaker = sortedSpeakers.find(([key]) => key.startsWith('zh-CN'));
        if (defaultSpeaker) {
            speakerSelect.val(defaultSpeaker[0]);
        }

        console.log('更新完成，当前选项数:', $('#speaker option').length);
    } catch (error) {
        console.error('更新失败:', error);
        speakerSelect.append(new Option('加载失败，请刷新重试', ''));
    }
    
    console.groupEnd();
}

function updateSliderLabel(sliderId, labelId) {
    const slider = $(`#${sliderId}`);
    const label = $(`#${labelId}`);
    label.text(slider.val());
    
    slider.off('input').on('input', function() {
        label.text(this.value);
    });
}

$(document).ready(function() {
    $('#speaker').append(new Option('正在加载讲述人...', ''));
    
    fetch('/speakers.json', { method: 'HEAD' })
        .then(response => {
            if (!response.ok) {
                throw new Error('speakers.json 文件不存在');
            }
            return loadSpeakers();
        })
        .then(() => {
            debugSpeakersConfig();
        })
        .catch(error => {
            console.error('检查 speakers.json 失败:', error);
            showError('讲述人配置文件加载失败，请检查文件是否存在');
        });

    $('#apiTips').text('使用 Workers API，每天限制 100000 次请求');

    $('[data-toggle="tooltip"]').tooltip();

    $('#api').on('change', function() {
        const selectedApi = $(this).val();
        console.log('选择的API:', selectedApi);
        updateSpeakerOptions(selectedApi);
    });

    updateSliderLabel('rate', 'rateValue');
    updateSliderLabel('pitch', 'pitchValue');

    $('#generateButton').on('click', function() {
        if (canMakeRequest()) {
            generateVoice(false);
        } else {
            showError('请稍候再试，每3秒只能请求一次。');
        }
    });

    $('#previewButton').on('click', function() {
        if (canMakeRequest()) {
            generateVoice(true);
        } else {
            showError('请稍候再试，每3秒只能请求一次。');
        }
    });

    $('#text').on('input', function() {
        const currentLength = $(this).val().length;
        $('#charCount').text(`最多3600个字符，目前已输入${currentLength}个字符`);
    });
});

function canMakeRequest() {
    const currentTime = Date.now();
    if (currentTime - lastRequestTime >= 3000) {
        lastRequestTime = currentTime;
        return true;
    }
    return false;
}

function buildRequestUrl(isPreview = false) {
    const api = $('#api').val();
    const text = $('#text').val().trim();
    const voice = $('#speaker').val();
    const rate = $('#rate').val();
    const pitch = $('#pitch').val();
    
    const finalText = isPreview ? text.substring(0, 20) : text;
    
    const params = new URLSearchParams({
        t: finalText,
        v: voice,
        r: rate,
        p: pitch,
        o: 'audio-24khz-48kbitrate-mono-mp3'
    });

    const baseUrl = API_ENDPOINTS[api];
    return `${baseUrl}?${params.toString()}`;
}

async function generateVoice(isPreview = false) {
    try {
        const text = $('#text').val().trim();
        if (!text) {
            showError('请输入要转换的文本');
            return;
        }

        const url = buildRequestUrl(isPreview);
        console.log('请求URL:', url);
        
        $('#loading').show();
        $('#error').hide();
        $('#result').hide();
        $('#generateButton, #previewButton').prop('disabled', true);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'audio/mpeg, */*'
            }
        });

        console.log('响应头:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json();
                throw new Error(errorData.error || `服务器响应错误: ${response.status}`);
            }
            throw new Error(`服务器响应错误: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        console.log('接收到的数据大小:', buffer.byteLength);

        if (buffer.byteLength === 0) {
            throw new Error('接收到的音频数据为空');
        }

        const audioBlob = new Blob([buffer], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(audioBlob);

        const audio = new Audio();
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('音频加载超时'));
            }, 5000);

            audio.onloadeddata = () => {
                clearTimeout(timeout);
                resolve();
            };

            audio.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('音频格式无效'));
            };

            audio.src = audioUrl;
        });

        $('#result').show();
        $('#audio').attr('src', audioUrl);
        $('#download').attr('href', audioUrl);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        $('#download').attr('download', `tts_${timestamp}.mp3`);

        if (!isPreview) {
            const timeStr = new Date().toLocaleTimeString();
            const shortenedText = text.length > 20 ? text.substring(0, 20) + '...' : text;
            addHistoryItem(timeStr, shortenedText, audioUrl);
        }

    } catch (error) {
        console.error('生成语音失败:', error);
        showError(`生成失败：${error.message}`);
        if (window.lastAudioUrl) {
            URL.revokeObjectURL(window.lastAudioUrl);
        }
    } finally {
        $('#loading').hide();
        $('#generateButton, #previewButton').prop('disabled', false);
    }
}

function validateAudio(audioUrl) {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('音频加载超时'));
        }, 5000);

        function cleanup() {
            audio.onloadedmetadata = null;
            audio.onerror = null;
            clearTimeout(timeoutId);
        }

        audio.onloadedmetadata = () => {
            cleanup();
            resolve();
        };

        audio.onerror = () => {
            cleanup();
            reject(new Error('音频加载失败'));
        };

        audio.src = audioUrl;
    });
}

function addHistoryItem(timestamp, text, audioUrl) {
    const historyItem = $(`
        <div class="history-item mb-2 p-2 border rounded">
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">${timestamp}</small>
                <span class="mx-2 text-truncate">${text}</span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary" onclick="playAudio('${audioUrl}')">
                        <i class="fas fa-play"></i>
                    </button>
                    <a class="btn btn-sm btn-outline-success" href="${audioUrl}" download="tts_${timestamp}.mp3">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            </div>
        </div>
    `);
    
    $('#historyItems').prepend(historyItem);
}

const audioCache = new Map();

function cleanupAudioCache() {
    const maxCacheSize = 50;
    if (audioCache.size > maxCacheSize) {
        const oldestUrl = audioCache.keys().next().value;
        URL.revokeObjectURL(oldestUrl);
        audioCache.delete(oldestUrl);
    }
}

function playAudio(audioUrl) {
    const audio = $('#audio')[0];
    audio.src = audioUrl;
    audio.play().catch(error => {
        console.error('播放音频失败:', error);
        showError('播放失败，请重试');
    });
}

window.addEventListener('beforeunload', () => {
    audioCache.forEach(url => URL.revokeObjectURL(url));
    audioCache.clear();
});

const cachedAudio = new Map();

function makeRequest(url, isPreview, text, isDenoApi) {
    try {
        new URL(url);
    } catch (e) {
        showError('无效的请求地址');
        return Promise.reject(e);
    }
    
    const cacheKey = `${url}_${text}`;
    if (cachedAudio.has(cacheKey)) {
        const cachedUrl = cachedAudio.get(cacheKey);
        $('#result').show();
        $('#audio').attr('src', cachedUrl);
        $('#download').attr('href', cachedUrl);
        
        highlightHistoryItem(cachedUrl);
        showMessage('该文本已经生成过语音了哦~', 'info');
        return Promise.resolve(cachedUrl);
    }
    $('#loading').show();
    $('#error').hide();
    $('#result').hide();
    $('#generateButton').prop('disabled', true);
    $('#previewButton').prop('disabled', true);

    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    return fetch(url, { 
        signal: controller.signal,
        headers: {
            'Accept': 'audio/mpeg'
        }
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`服务器响应错误: ${response.status}`);
        }
        if (!response.headers.get('content-type')?.includes('audio/')) {
            throw new Error('响应类型错误');
        }
        return response.blob();
    })
    .then(blob => {
        if (!blob.type.includes('audio/')) {
            throw new Error('返回的不是音频文件');
        }
        
        currentAudioURL = URL.createObjectURL(blob);
        $('#result').show();
        $('#audio').attr('src', currentAudioURL);
        $('#download').attr('href', currentAudioURL);
        cachedAudio.set(cacheKey, currentAudioURL);

        if (!isPreview) {
            const timestamp = new Date().toLocaleTimeString();
            const shortenedText = text.length > 5 ? text.substring(0, 5) + '...' : text;
            addHistoryItem(timestamp, shortenedText, currentAudioURL);
        }
    })
    .catch(error => {
        console.error('请求错误:', error);
        if (error.name === 'AbortError') {
            showError('请求超时，请重试');
        } else {
            showError(`生成失败：${isDenoApi ? 'Deno API 服务暂时不可用，请尝试使用 Workers API' : error.message}`);
        }
    })
    .finally(() => {
        $('#loading').hide();
        $('#generateButton').prop('disabled', false);
        $('#previewButton').prop('disabled', false);
    });
}

function showError(message) {
    const errorDiv = $('#error');
    errorDiv.text(message).show();
    setTimeout(() => errorDiv.fadeOut(), 3000);
}

function clearHistory() {
    $('#historyItems .history-item').each(function() {
        const audioURL = $(this).find('button').first().attr('onclick').match(/'([^']+)'/)[1];
        
        for (let [key, value] of cachedAudio.entries()) {
            if (value === audioURL) {
                cachedAudio.delete(key);
            }
        }
        URL.revokeObjectURL(audioURL);
    });
    
    $('#historyItems').empty();
    alert("历史记录已清除！");
}

function initializeAudioPlayer() {
    const audio = document.getElementById('audio');
    audio.style.borderRadius = '12px';
    audio.style.width = '100%';
    audio.style.marginTop = '20px';
}

function showMessage(message, type = 'error') {
    const errorDiv = $('#error');
    errorDiv.removeClass('alert-danger alert-warning alert-info')
           .addClass(`alert-${type}`)
           .text(message)
           .show();
    
    setTimeout(() => {
        errorDiv.fadeOut();
    }, 3000);
}

let currentHighlightTimer;

function highlightHistoryItem(audioURL) {
    if (currentHighlightTimer) {
        clearTimeout(currentHighlightTimer);
    }
    $('.history-item').removeClass('highlight-history');
    
    const historyItem = $('#historyItems .history-item').filter(function() {
        const onclickAttr = $(this).find('button').first().attr('onclick');
        return onclickAttr && onclickAttr.includes(audioURL);
    });
    
    if (historyItem.length) {
        try {
            void historyItem[0].offsetHeight;
            
            historyItem.addClass('highlight-history');
            
            try {
                historyItem[0].scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center'
                });
            } catch (scrollError) {
                console.warn('Smooth scroll failed, falling back to default:', scrollError);
                historyItem[0].scrollIntoView();
            }
            
            currentHighlightTimer = setTimeout(() => {
                historyItem.removeClass('highlight-history');
                currentHighlightTimer = null;
            }, 3000);
            
        } catch (error) {
            console.error('Highlight animation failed:', error);
            historyItem.removeClass('highlight-history');
        }
    }
}

const MAX_CACHE_SIZE = 50;
function cleanupCache() {
    if (cachedAudio.size > MAX_CACHE_SIZE) {
        const oldestKey = cachedAudio.keys().next().value;
        URL.revokeObjectURL(cachedAudio.get(oldestKey));
        cachedAudio.delete(oldestKey);
    }
}

async function makeRequest(url, retries = 3) {
    try {
        new URL(url);
    } catch (e) {
        showError('无效的请求地址');
        return Promise.reject(e);
    }
    
    const cacheKey = `${url}_${text}`;
    if (cachedAudio.has(cacheKey)) {
        const cachedUrl = cachedAudio.get(cacheKey);
        $('#result').show();
        $('#audio').attr('src', cachedUrl);
        $('#download').attr('href', cachedUrl);
        
        highlightHistoryItem(cachedUrl);
        showMessage('该文本已经生成过语音了哦~', 'info');
        return Promise.resolve(cachedUrl);
    }
    $('#loading').show();
    $('#error').hide();
    $('#result').hide();
    $('#generateButton').prop('disabled', true);
    $('#previewButton').prop('disabled', true);

    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    return fetch(url, { 
        signal: controller.signal,
        headers: {
            'Accept': 'audio/mpeg'
        }
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`服务器响应错误: ${response.status}`);
        }
        if (!response.headers.get('content-type')?.includes('audio/')) {
            throw new Error('响应类型错误');
        }
        return response.blob();
    })
    .then(blob => {
        if (!blob.type.includes('audio/')) {
            throw new Error('返回的不是音频文件');
        }
        
        currentAudioURL = URL.createObjectURL(blob);
        $('#result').show();
        $('#audio').attr('src', currentAudioURL);
        $('#download').attr('href', currentAudioURL);
        cachedAudio.set(cacheKey, currentAudioURL);

        if (!isPreview) {
            const timestamp = new Date().toLocaleTimeString();
            const shortenedText = text.length > 5 ? text.substring(0, 5) + '...' : text;
            addHistoryItem(timestamp, shortenedText, currentAudioURL);
        }
    })
    .catch(error => {
        console.error('请求错误:', error);
        if (error.name === 'AbortError') {
            showError('请求超时，请重试');
        } else {
            showError(`生成失败：${isDenoApi ? 'Deno API 服务暂时不可用，请尝试使用 Workers API' : error.message}`);
        }
    })
    .finally(() => {
        $('#loading').hide();
        $('#generateButton').prop('disabled', false);
        $('#previewButton').prop('disabled', false);
    });
}

function debugSpeakersConfig() {
    console.group('讲述人配置调试信息');
    console.log('API Config:', apiConfig);
    console.log('Speaker Select Element:', $('#speaker')[0]);
    console.log('Speaker Options:', $('#speaker option').length);
    console.log('Current API:', $('#api').val());
    console.groupEnd();
}

function debugResponse(response) {
    console.group('响应调试信息');
    console.log('状态:', response.status);
    console.log('状态文本:', response.statusText);
    console.log('头部:', Object.fromEntries(response.headers.entries()));
    console.groupEnd();
}

async function fetchWithRetry(url, options, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            console.warn(`请求失败，尝试重试 ${i + 1}/${retries}`);
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`请求出错，尝试重试 ${i + 1}/${retries}`, error);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
    throw new Error('请求失败，已达到最大重试次数');
}
