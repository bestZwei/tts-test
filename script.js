let apiConfig;
let lastRequestTime = 0;

function getLanguageList(speakers) {
    const languages = new Set();
    for (const key in speakers) {
        const lang = key.split('-').slice(0, 2).join('-');
        languages.add(lang);
    }
    return Array.from(languages).sort();
}

function getLanguageName(code) {
    const languageNames = {
        'zh-CN': '中文（普通话）',
        'zh-HK': '中文（粤语）',
        'zh-TW': '中文（台湾）',
        'en-US': '英语（美国）',
        'en-GB': '英语（英国）',
        'ja-JP': '日语',
        'ko-KR': '韩语',
        'fr-FR': '法语（法国）',
        'de-DE': '德语（德国）',
        'ru-RU': '俄语',
        'es-ES': '西班牙语（西班牙）',
        'it-IT': '意大利语',
        'default': '未知语言'
    };
    return languageNames[code] || `${code} (${languageNames['default']})`;
}

function updateLanguageOptions(apiName) {
    const speakers = apiConfig[apiName].speakers;
    const languages = getLanguageList(speakers);
    const $language = $('#language');
    
    $language.empty();
    $language.append('<option value="">请选择语言</option>');
    
    languages.forEach(lang => {
        $language.append(`<option value="${lang}">${getLanguageName(lang)}</option>`);
    });
    
    $('#speaker').empty().append('<option value="">请先选择语言</option>');
}

function updateSpeakerOptions(apiName, language) {
    const speakers = apiConfig[apiName].speakers;
    const $speaker = $('#speaker');
    
    $speaker.empty();
    $speaker.append('<option value="">请选择讲述人</option>');
    
    Object.entries(speakers)
        .filter(([key]) => key.startsWith(language))
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([key, value]) => {
            $speaker.append(`<option value="${key}">${value}</option>`);
        });
}

function initializeEventListeners() {
    $('#api').on('change', function() {
        const apiName = $(this).val();
        if (apiName) {
            updateLanguageOptions(apiName);
        } else {
            $('#language').empty().append('<option value="">请先选择API</option>');
            $('#speaker').empty().append('<option value="">请先选择语言</option>');
        }
    });

    $('#language').on('change', function() {
        const apiName = $('#api').val();
        const language = $(this).val();
        if (language) {
            updateSpeakerOptions(apiName, language);
        } else {
            $('#speaker').empty().append('<option value="">请先选择语言</option>');
        }
    });

    updateSliderLabel('rate', 'rateValue');
    updateSliderLabel('pitch', 'pitchValue');

    $('#text').on('input', function () {
        $('#charCount').text(`字符数统计：${this.value.length}/3600`);
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
}

async function initialize() {
    try {
        const response = await fetch('speakers.json');
        apiConfig = await response.json();
        
        const defaultApi = 'workers-api';
        $('#api').val(defaultApi).trigger('change');
        
    } catch (error) {
        console.error('Failed to load speakers:', error);
        alert('加载讲述人列表失败');
    }
}

$(document).ready(function() {
    initialize();
    initializeEventListeners();
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
    const apiUrl = apiConfig[apiName].url;
    const speaker = $('#speaker').val();
    const text = $('#text').val();
    const previewText = isPreview ? text.substring(0, 20) : text;
    let rate = $('#rate').val();
    let pitch = $('#pitch').val();

    if (!text.trim()) {
        alert('请输入要转换的文本');
        return;
    }

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

function makeRequest(url, isPreview, text) {
    $('#loading').show();
    $('#result').hide();
    $('#generateButton').prop('disabled', true);
    $('#previewButton').prop('disabled', true);

    $.ajax({
        url: url,
        method: 'GET',
        headers: {
            'x-api-key': '@ak47'
        },
        xhrFields: {
            responseType: 'blob'
        },
        success: (blob) => handleSuccess(blob, isPreview, text),
        error: handleError
    });
}

function handleSuccess(blob, isPreview, text) {
    console.log('Blob type:', blob.type); // 添加调试信息
    if (blob.type !== "audio/mpeg") {
        console.error('Invalid Blob type:', blob.type);
        alert('请求失败：无效的音频格式');
        $('#loading').hide();
        $('#generateButton').prop('disabled', false);
        $('#previewButton').prop('disabled', false);
        return;
    }

    const voiceUrl = URL.createObjectURL(blob);
    $('#audio').attr('src', voiceUrl);
    $('#audio')[0].load();
    if (!isPreview) {
        $('#download').attr('href', voiceUrl);
        const timestamp = new Date().toLocaleTimeString();
        const shortenedText = text.length > 5 ? text.substring(0, 5) + '...' : text;
        addHistoryItem(timestamp, shortenedText, voiceUrl);
    }
    $('#result').show();
    $('#loading').hide();
    $('#generateButton').prop('disabled', false);
    $('#previewButton').prop('disabled', false);
}

function handleError(jqXHR, textStatus, errorThrown) {
    console.error(`请求失败：${textStatus} - ${errorThrown}`);
    alert(`请求失败：${textStatus} - ${errorThrown}`);
    $('#loading').hide();
    $('#generateButton').prop('disabled', false);
    $('#previewButton').prop('disabled', false);
}

function addHistoryItem(timestamp, text, audioURL) {
    const historyItems = $('#historyItems');
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
    $('#historyItems').empty();
    alert("历史记录已清除！");
}
