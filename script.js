let apiConfig;
let lastRequestTime = 0;

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
    slider.on('input', function () {
        label.text(this.value);
    });
}

$(document).ready(function () {
    loadSpeakers().then(() => {
        $('[data-toggle="tooltip"]').tooltip();

        $('#api').on('change', function () {
            const apiName = $(this).val();
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

    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.blob();
        })
        .then(blob => {
            const audioURL = URL.createObjectURL(blob);
            $('#result').show();
            $('#audio').attr('src', audioURL);
            
            if (!isPreview) {
                addToHistory(text, audioURL);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('生成失败：' + error.message);
        })
        .finally(() => {
            $('#loading').hide();
            $('#generateButton').prop('disabled', false);
            $('#previewButton').prop('disabled', false);
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
    
    alert(errorMessage);
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
