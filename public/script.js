let apiConfig;
let lastRequestTime = 0;
let currentAudioURL = null;

const API_CONFIG = {
    'workers-api': {
        url: '/api/tts',
        speakers: speakers['workers-api']
    },
    'deno-api': {
        url: 'https://deno-tts.api.zwei.de.eu.org/tts',
        speakers: speakers['deno-api']
    }
};

function loadSpeakers() {
    return $.ajax({
        url: 'speakers.json',
        method: 'GET',
        dataType: 'json',
        success: function(data) {
            apiConfig = data;
            updateSpeakerOptions('workers-api');
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.error(`加载讲述者失败：${textStatus} - ${errorThrown}`);
            showError('加载讲述者失败，请刷新页面重试。');
        }
    });
}

function updateSpeakerOptions(apiName) {
    const speakers = apiConfig[apiName].speakers;
    const speakerSelect = $('#speaker');
    speakerSelect.empty();
    
    Object.entries(speakers).forEach(([key, value]) => {
        speakerSelect.append(new Option(value, key));
    });
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
    loadSpeakers().then(() => {
        $('#apiTips').text('使用 Workers API，每天限制 100000 次请求');

        $('[data-toggle="tooltip"]').tooltip();

        $('#api').on('change', function() {
            const apiName = $(this).val();
            updateSpeakerOptions(apiName);
            
            $('#rate, #pitch').val(0);
            updateSliderLabel('rate', 'rateValue');
            updateSliderLabel('pitch', 'pitchValue');
            
            const tips = {
                'workers-api': '使用 Workers API，每天限制 100000 次请求',
                'deno-api': '使用 Deno API，基于 Lobe-TTS，暂不支持语速语调调整'
            };
            $('#apiTips').text(tips[apiName] || '');
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
});

function canMakeRequest() {
    const currentTime = Date.now();
    if (currentTime - lastRequestTime >= 3000) {
        lastRequestTime = currentTime;
        return true;
    }
    return false;
}

function generateVoice(isPreview) {
    const apiName = $('#api').val();
    const apiUrl = API_CONFIG[apiName].url;
    const speaker = $('#speaker').val();
    const text = $('#text').val().trim();
    const maxLength = 3600;
    
    if (!text) {
        showError('请输入要转换的文本');
        return;
    }
    
    if (text.length > maxLength) {
        showError(`文本长度不能超过${maxLength}个字符`);
        return;
    }

    const previewText = isPreview ? text.substring(0, 20) : text;
    let rate = $('#rate').val();
    let pitch = $('#pitch').val();

    if (apiName === 'deno-api') {
        const rateConverted = (parseFloat(rate) / 100).toFixed(2);
        const pitchConverted = (parseFloat(pitch) / 100).toFixed(2);
        
        const params = new URLSearchParams({
            text: previewText,
            voice: speaker,
            rate: rateConverted,
            pitch: pitchConverted
        });
        
        if (!isPreview) {
            params.append('download', 'true');
        }
        
        const url = `${apiUrl}?${params.toString()}`;
        
        makeRequest(url, isPreview, text, true);
    } else {
        let url = `${apiUrl}?t=${encodeURIComponent(previewText)}&v=${encodeURIComponent(speaker)}`;
        url += `&r=${encodeURIComponent(rate)}&p=${encodeURIComponent(pitch)}`;
        if (!isPreview) {
            url += '&d=true';
        }
        
        makeRequest(url, isPreview, text, false);
    }
}

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
    showMessage(message, 'danger');
}

function addHistoryItem(timestamp, text, audioURL) {
    const MAX_HISTORY = 50;
    const historyItems = $('#historyItems');
    
    if (historyItems.children().length >= MAX_HISTORY) {
        const oldestItem = historyItems.children().last();
        const oldUrl = oldestItem.find('button').first().attr('onclick').match(/'([^']+)'/)[1];
        
        for (let [key, value] of cachedAudio.entries()) {
            if (value === oldUrl) {
                cachedAudio.delete(key);
                break;
            }
        }
        
        URL.revokeObjectURL(oldUrl);
        oldestItem.remove();
    }
    const historyItem = $(`
        <div class="history-item list-group-item" style="opacity: 0;">
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-truncate" style="max-width: 60%;">${timestamp} - ${text}</span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary" onclick="playAudio('${audioURL}')">
                        播放
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="downloadAudio('${audioURL}')">
                        下载
                    </button>
                </div>
            </div>
        </div>
    `);
    
    $('#historyItems').prepend(historyItem);
    setTimeout(() => historyItem.animate({ opacity: 1 }, 300), 50);
}

function playAudio(audioURL) {
    const audioElement = $('#audio')[0];
    audioElement.onerror = function() {
        showError('音频播放失败，请重试');
    };
    audioElement.src = audioURL;
    audioElement.load();
    audioElement.play().catch(error => {
        console.error('播放失败:', error);
        showError('音频播放失败，请重试');
    });
}

function downloadAudio(audioURL) {
    const link = document.createElement('a');
    link.href = audioURL;
    link.download = 'audio.mp3';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

// 全局变量用于存储当前高亮的定时器
let currentHighlightTimer;

function highlightHistoryItem(audioURL) {
    // 清除当前正在进行的高亮和定时器
    if (currentHighlightTimer) {
        clearTimeout(currentHighlightTimer);
    }
    $('.history-item').removeClass('highlight-history');
    
    // 找到匹配的历史记录
    const historyItem = $('#historyItems .history-item').filter(function() {
        const onclickAttr = $(this).find('button').first().attr('onclick');
        return onclickAttr && onclickAttr.includes(audioURL);
    });
    
    if (historyItem.length) {
        try {
            // 强制重新触发动画
            void historyItem[0].offsetHeight;
            
            // 添加高亮类
            historyItem.addClass('highlight-history');
            
            // 滚动到高亮项（添加错误处理）
            try {
                historyItem[0].scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center'
                });
            } catch (scrollError) {
                console.warn('Smooth scroll failed, falling back to default:', scrollError);
                historyItem[0].scrollIntoView();
            }
            
            // 设置新的定时器并保存引用
            currentHighlightTimer = setTimeout(() => {
                historyItem.removeClass('highlight-history');
                currentHighlightTimer = null;
            }, 3000);
            
        } catch (error) {
            console.error('Highlight animation failed:', error);
            // 确保在出错时移除高亮状态
            historyItem.removeClass('highlight-history');
        }
    }
}
