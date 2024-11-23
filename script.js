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
    });
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

    if (apiName === 'workers-api') {
        let url = `${apiUrl}?t=${encodeURIComponent(previewText)}&v=${encodeURIComponent(speaker)}`;
        url += `&r=${encodeURIComponent(rate)}&p=${encodeURIComponent(pitch)}`;
        if (!isPreview) {
            url += '&d=true';
        }
        
        makeRequest(url, isPreview, text);
    } else if (apiName === 'deno-api') {
        const rateConverted = (parseFloat(rate) / 100).toFixed(2);
        const pitchConverted = (parseFloat(pitch) / 100).toFixed(2);
        
        let url = `${apiUrl}?text=${encodeURIComponent(previewText)}&voice=${encodeURIComponent(speaker)}`;
        url += `&rate=${rateConverted}&pitch=${pitchConverted}`;
        if (!isPreview) {
            url += '&download=true';
        }
        
        makeRequest(url, isPreview, text);
    }
}

// 建议添加缓存机制
const cachedAudio = new Map();

function makeRequest(url, isPreview, text) {
    const cacheKey = `${url}_${text}`;
    if (cachedAudio.has(cacheKey)) {
        return Promise.resolve(cachedAudio.get(cacheKey));
    }
    $('#loading').show();
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

    fetch(url, { signal: controller.signal })
        .then(response => {
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.blob();
        })
        .then(blob => {
            currentAudioURL = URL.createObjectURL(blob);
            $('#result').show();
            $('#audio').attr('src', currentAudioURL);
            $('#download').attr('href', currentAudioURL);
            
            if (!isPreview) {
                const timestamp = new Date().toLocaleTimeString();
                const shortenedText = text.length > 5 ? text.substring(0, 5) + '...' : text;
                addHistoryItem(timestamp, shortenedText, currentAudioURL);
            }
        })
        .catch(error => {
            if (error.name === 'AbortError') {
                showError('请求超时，请重试');
            } else {
                showError('生成失败：' + error.message);
            }
        })
        .finally(() => {
            $('#loading').hide();
            $('#generateButton').prop('disabled', false);
            $('#previewButton').prop('disabled', false);
        });
}

function handleError(jqXHR, textStatus, errorThrown) {
    console.error('请求失败:', {
        status: jqXHR?.status,
        textStatus: textStatus,
        error: errorThrown
    });
    
    let errorMessage = '请求失败';
    if (jqXHR?.status === 401) {
        errorMessage = '认证失败，请检查认证信息';
    } else if (jqXHR?.status === 429) {
        errorMessage = '请求过于频繁，请稍后再试';
    } else {
        errorMessage = `${textStatus}: ${errorThrown}`;
    }
    
    showError(errorMessage);
}

function addHistoryItem(timestamp, text, audioURL) {
    const MAX_HISTORY = 10;
    const historyItems = $('#historyItems');
    if (historyItems.children().length >= MAX_HISTORY) {
        const oldestItem = historyItems.children().first();
        const oldUrl = oldestItem.find('button').attr('onclick').match(/'([^']+)'/)[1];
        URL.revokeObjectURL(oldUrl);
        oldestItem.remove();
    }
    const historyItem = $(`
        <div class="history-item">
            <span>${timestamp} - ${text}</span>
            <div>
                <button class="btn btn-secondary" onclick="playAudio('${audioURL}')">播放</button>
                <button class="btn btn-info" onclick="downloadAudio('${audioURL}')">下载</button>
            </div>
        </div>
    `);
    historyItems.append(historyItem);
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
    link.click();
}

function clearHistory() {
    // 清理所有历史记录的 Blob URLs
    $('#historyItems .history-item').each(function() {
        const audioURL = $(this).find('button').attr('onclick').match(/'([^']+)'/)[1];
        URL.revokeObjectURL(audioURL);
    });
    
    $('#historyItems').empty();
    alert("历史记录已清除！");
}

// 添加错误处理
$.ajaxSetup({
    timeout: 30000,  // 30秒超时
    error: function(xhr, status, error) {
        $('#loading').hide();
        $('#generateButton').prop('disabled', false);
        $('#previewButton').prop('disabled', false);
        
        let message = '请求失败';
        if (status === 'timeout') {
            message = '请求超时，请重试';
        } else if (xhr.status === 429) {
            message = '请求过于频繁，请稍后再试';
        } else if (xhr.status === 401) {
            message = '认证失败';
        }
        alert(message);
    }
});

function showError(message) {
    const errorDiv = $('#error');
    errorDiv.text(message).show();
    setTimeout(() => errorDiv.fadeOut(), 5000); // 5秒后自动隐藏
}

// 缓存 DOM 选择器
const $audio = $('#audio');
const $loading = $('#loading');
const $result = $('#result');
const $generateButton = $('#generateButton');
const $previewButton = $('#previewButton');

// 添加页面卸载时的清理
window.addEventListener('beforeunload', function() {
    // 清理所有历史记录的 Blob URLs
    $('#historyItems .history-item').each(function() {
        const audioURL = $(this).find('button').attr('onclick').match(/'([^']+)'/)[1];
        URL.revokeObjectURL(audioURL);
    });
    
    // 清理当前的音频 URL
    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }
});

// 使用防抖优化字符计数
const updateCharCount = _.debounce(function(length) {
    $('#charCount').text(`字符数统计：${length}/3600`);
}, 300);
