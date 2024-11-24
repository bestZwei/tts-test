let apiConfig;
let lastRequestTime = 0;
let currentAudioURL = null;

const API_CONFIG = {
    'workers-api': {
        url: 'https://worker-tts.api.zwei.de.eu.org/tts'
    },
    'deno-api': {
        url: 'https://deno-tts.api.zwei.de.eu.org/tts'
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
    $.each(speakers, function(key, value) {
        speakerSelect.append(new Option(value, key));
    });
}

function updateSliderLabel(sliderId, labelId) {
    const slider = $(`#${sliderId}`);
    const label = $(`#${labelId}`);
    label.text(slider.val());
    
    // 先解绑之前的事件
    slider.off('input');
    
    slider.on('input', function () {
        label.text(this.value);
    });
}

$(document).ready(function () {
    loadSpeakers().then(() => {
        $('[data-toggle="tooltip"]').tooltip();

        $('#api').on('change', function () {
            const apiName = $(this).val();
            $('#speaker').prop('disabled', true).empty().append('<option>加载中...</option>');
            
            updateSpeakerOptions(apiName);
            
            // 重置滑块值
            $('#rate').val(0);
            $('#pitch').val(0);
            updateSliderLabel('rate', 'rateValue');
            updateSliderLabel('pitch', 'pitchValue');
            
            // 显示 API 相关提示
            const tips = {
                'workers-api': '使用 Workers API，支持简单参数',
                'deno-api': '使用 Deno API，支持完整参数'
            };
            
            $('#apiTips').text(tips[apiName] || '');
            
            $('#speaker').prop('disabled', false);
        });

        updateSliderLabel('rate', 'rateValue');
        updateSliderLabel('pitch', 'pitchValue');

        // 防抖处理
        let debounceTimer;
        $('#text').on('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                $('#charCount').text(`字符数统计：${this.value.length}/3600`);
            }, 300);
        });

        $('#text2voice-form').on('submit', function (event) {
            event.preventDefault();
            if (canMakeRequest()) {
                generateVoice(false);
            } else {
                alert('请稍候再试，每5秒只能请求一次。');
            }
        });

        $('#previewButton').on('click', function () {
            if (canMakeRequest()) {
                generateVoice(true);
            } else {
                alert('请稍候再试，每5秒只能请求一次。');
            }
        });

        $('#clearHistoryButton').on('click', function () {
            clearHistory();
        });
    });

    // 初始化音频播放器外观
    initializeAudioPlayer();
});

function canMakeRequest() {
    const currentTime = Date.now();
    if (currentTime - lastRequestTime >= 5000) {
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
    const cacheKey = `${url}_${text}`;
    if (cachedAudio.has(cacheKey)) {
        return Promise.resolve(cachedAudio.get(cacheKey));
    }
    $('#loading').show();
    $('#error').hide();
    $('#result').hide();
    $('#generateButton').prop('disabled', true);
    $('#previewButton').prop('disabled', true);

    // 释放之前的 URL
    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }

    // 添加请求超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    fetch(url, { 
        signal: controller.signal,
        headers: {
            'Accept': 'audio/mpeg'
        }
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
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
}

function addHistoryItem(timestamp, text, audioURL) {
    const MAX_HISTORY = 10;
    const historyItems = $('#historyItems');
    if (historyItems.children().length >= MAX_HISTORY) {
        const oldestItem = historyItems.children().last();
        const oldUrl = oldestItem.find('button').first().attr('onclick').match(/'([^']+)'/)[1];
        URL.revokeObjectURL(oldUrl);
        oldestItem.remove();
    }
    const historyItem = $(`
        <div class="history-item list-group-item" style="opacity: 0;">
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-truncate" style="max-width: 60%;">${timestamp} - ${text}</span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary" onclick="playAudio('${audioURL}')">
                        <i class="fas fa-play"></i> 播放
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="downloadAudio('${audioURL}')">
                        <i class="fas fa-download"></i> 下载
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
    audioElement.src = audioURL;
    audioElement.load();
    audioElement.play();
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
    // 清理所有历史记录的 Blob URLs
    $('#historyItems .history-item').each(function() {
        const audioURL = $(this).find('button').first().attr('onclick').match(/'([^']+)'/)[1];
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
