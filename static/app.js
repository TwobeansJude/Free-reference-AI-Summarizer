// AI 文献总结器 - 前端交互逻辑

const API_CONFIG_KEY = 'literature_browser_api_config';
let currentFolderPath = '';
let progressInterval = null;
let allResults = [];

// ==================== 工具函数 ====================

function showToast(message, type) {
    type = type || 'success';
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(function () { toast.classList.remove('show'); }, 3000);
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== API 配置 ====================

function getApiConfig() {
    try {
        return JSON.parse(localStorage.getItem(API_CONFIG_KEY));
    } catch (e) {
        return null;
    }
}

function checkApiConfig() {
    var config = getApiConfig();
    var el = document.getElementById('apiStatus');
    if (!el) return !!config;
    if (config && config.apiKey && config.apiUrl) {
        el.className = 'api-status configured';
        el.textContent = '✓ API已配置';
        return true;
    }
    el.className = 'api-status not-configured';
    el.textContent = '⚠️ 请先配置API';
    return false;
}

// ==================== 设置页面 ====================

function initSettingsPage() {
    var config = getApiConfig() || {};
    document.getElementById('apiUrl').value = config.apiUrl || '';
    document.getElementById('apiKey').value = config.apiKey || '';
    document.getElementById('modelName').value = config.modelName || 'deepseek-chat';
    if (config.apiKey) { updateStatus('pending', '⚠️ 已配置（未测试）'); }

    document.getElementById('testBtn').addEventListener('click', testConnection);
    document.getElementById('saveBtn').addEventListener('click', saveConfig);
    document.getElementById('clearBtn').addEventListener('click', clearAll);
}

function showAlert(message, type) {
    var c = document.getElementById('alertContainer');
    c.innerHTML = '<div class="alert alert-' + type + '">' + message + '</div>';
    setTimeout(function () { c.innerHTML = ''; }, 5000);
}

function updateStatus(status, message) {
    var el = document.getElementById('statusDisplay');
    var map = { connected: 'status-connected', disconnected: 'status-disconnected', pending: 'status-pending' };
    var msgs = { connected: '✓ 已连接', disconnected: '✗ 连接失败', pending: '⏳ 等待配置' };
    el.className = 'status-indicator ' + map[status];
    el.innerHTML = message || msgs[status];
}

function saveConfig() {
    var url = document.getElementById('apiUrl').value.trim();
    var key = document.getElementById('apiKey').value.trim();
    var model = document.getElementById('modelName').value.trim();
    if (!url) { showAlert('请输入API地址', 'error'); return; }
    if (!key) { showAlert('请输入API密钥', 'error'); return; }
    if (!model) { showAlert('请输入模型名称', 'error'); return; }
    localStorage.setItem(API_CONFIG_KEY, JSON.stringify({ apiUrl: url, apiKey: key, modelName: model }));
    showAlert('设置已保存', 'success');
}

async function testConnection() {
    var url = document.getElementById('apiUrl').value.trim();
    var key = document.getElementById('apiKey').value.trim();
    var model = document.getElementById('modelName').value.trim();
    if (!url || !key || !model) { showAlert('请先填写完整的API配置', 'error'); return; }

    updateStatus('pending', '🔄 测试中...');
    try {
        var clean = url.endsWith('/') ? url.slice(0, -1) : url;
        var ep = clean.includes('/chat/completions') ? clean : clean + '/chat/completions';
        var r = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: model, messages: [{ role: 'user', content: '请回复“连接成功”' }], max_tokens: 50 })
        });
        if (r.ok) {
            updateStatus('connected', '✓ 连接成功');
            showAlert('API连接测试成功！', 'success');
            saveConfig();
        } else {
            var e = await r.json().catch(function () { return {}; });
            updateStatus('disconnected', '✗ 连接失败');
            showAlert('连接失败: ' + (e.error && e.error.message || 'HTTP ' + r.status), 'error');
        }
    } catch (err) {
        updateStatus('disconnected', '✗ 连接失败');
        showAlert('连接失败: ' + err.message, 'error');
    }
}

function clearAll() {
    if (confirm('确定要清除所有API配置吗？')) {
        localStorage.removeItem(API_CONFIG_KEY);
        document.getElementById('apiUrl').value = '';
        document.getElementById('apiKey').value = '';
        document.getElementById('modelName').value = 'deepseek-chat';
        updateStatus('pending', '⏳ 等待配置');
        showAlert('已清除所有配置', 'info');
    }
}

// ==================== 主页 ====================

function initMainPage() {
    document.getElementById('validatePathBtn').addEventListener('click', validatePath);
    document.getElementById('scanBtn').addEventListener('click', scanFolder);
    document.getElementById('analyzeBtn').addEventListener('click', startAnalysis);
    document.getElementById('exportBtn').addEventListener('click', exportCSV);
    document.getElementById('detailModal').addEventListener('click', function (e) {
        if (e.target === document.getElementById('detailModal')) closeModal();
    });
    checkApiConfig();
}

async function validatePath() {
    var path = document.getElementById('folderPath').value.trim();
    var el = document.getElementById('pathValidation');
    if (!path) { el.innerHTML = '<span style="color:#f56565;">请输入文件夹路径</span>'; return; }
    el.innerHTML = '<span style="color:#718096;">正在验证...</span>';

    try {
        var r = await fetch('/api/validate-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_path: path }) });
        var d = await r.json();
        if (d.valid) {
            el.innerHTML = '<span style="color:#48bb78;">✓ ' + d.message + '</span>';
            document.getElementById('scanBtn').disabled = false;
            currentFolderPath = path;
        } else {
            el.innerHTML = '<span style="color:#f56565;">✗ ' + d.error + '</span>';
            document.getElementById('scanBtn').disabled = true;
        }
    } catch (e) {
        el.innerHTML = '<span style="color:#f56565;">验证失败，请重试</span>';
    }
}

async function scanFolder() {
    if (!checkApiConfig()) { showToast('请先在设置页面配置API密钥', 'error'); return; }
    try {
        var r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_path: currentFolderPath }) });
        var d = await r.json();
        if (d.success) {
            document.getElementById('scanResult').style.display = 'block';
            document.getElementById('scanResult').innerHTML = '<p><strong>✓ 扫描完成！</strong> 找到 <strong>' + d.count + '</strong> 个PDF文件</p><div style="margin-top:12px;font-size:13px;color:#718096;">文件列表: ' + d.files.map(function (f) { return f.name; }).join(', ') + '</div>';
            document.getElementById('analysisCard').classList.remove('hidden');
            document.getElementById('analyzeBtn').disabled = false;
            showToast('找到 ' + d.count + ' 个PDF文件');
        } else {
            showToast(d.error, 'error');
        }
    } catch (e) {
        showToast('扫描失败，请重试', 'error');
    }
}

async function startAnalysis() {
    var config = getApiConfig();
    if (!config || !config.apiKey || !config.apiUrl) {
        showToast('API配置不完整，请重新配置', 'error');
        window.location.href = '/settings';
        return;
    }
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('progressContainer').classList.remove('hidden');
    document.getElementById('previewCard').classList.add('hidden');

    try {
        var r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder_path: currentFolderPath, api_config: config }) });
        var d = await r.json();
        if (d.success) { startProgressMonitoring(); showToast('分析已开始'); }
        else {
            showToast(d.error, 'error');
            document.getElementById('analyzeBtn').disabled = false;
        }
    } catch (e) {
        showToast('启动分析失败', 'error');
        document.getElementById('analyzeBtn').disabled = false;
    }
}

function startProgressMonitoring() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(async function () {
        try {
            var r = await fetch('/api/progress');
            var d = await r.json();
            document.getElementById('progressBar').style.width = d.progress + '%';
            document.getElementById('progressBar').textContent = d.progress + '%';
            document.getElementById('currentFile').textContent = d.current || '准备中...';
            if (!d.analyzing) {
                clearInterval(progressInterval); progressInterval = null;
                if (d.results_count > 0) {
                    document.getElementById('analysisResult').style.display = 'block';
                    document.getElementById('analysisResult').innerHTML = '<p><strong>✓ 分析完成！</strong> 成功处理 <strong>' + d.results_count + '</strong> 篇文献</p>';
                    await loadResults();
                    document.getElementById('previewCard').classList.remove('hidden');
                    showToast('分析完成！成功处理 ' + d.results_count + ' 篇文献');
                } else {
                    showToast('未能提取文献信息', 'error');
                }
                document.getElementById('analyzeBtn').disabled = false;
            }
        } catch (e) {}
    }, 1000);
}

async function loadResults() {
    try {
        var r = await fetch('/api/results');
        var d = await r.json();
        if (d.success) { allResults = d.results; renderPreviewTable(); }
    } catch (e) {}
}

function renderPreviewTable() {
    var tbody = document.getElementById('previewTableBody');
    var errorSummary = document.getElementById('errorSummary');
    var failedFiles = allResults.filter(function (r) { return r['题目'] === '(解析失败)' || !r['题目'] || r['题目'].trim() === ''; });

    tbody.innerHTML = '';

    if (failedFiles.length > 0) {
        errorSummary.classList.remove('hidden');
        errorSummary.innerHTML = '<h4>⚠️ 解析失败文件</h4><ul>' + failedFiles.map(function (f) { return '<li><strong>' + f['文件名'] + '</strong> - ' + (f['错误信息'] || '无法提取内容') + '</li>'; }).join('') + '</ul>';
    } else {
        errorSummary.classList.add('hidden');
    }

    allResults.forEach(function (result, index) {
        var row = document.createElement('tr');
        var isFailed = result['题目'] === '(解析失败)' || !result['题目'] || result['题目'].trim() === '';
        if (isFailed) row.className = 'failed-row';
        row.innerHTML =
            '<td>' + escapeHtml(result['文件名']) + '</td>' +
            '<td class="truncate" title="' + escapeHtml(result['题目'] || '') + '">' + (isFailed ? '<span class="failed-cell">解析失败</span>' : escapeHtml(result['题目'] || '-')) + '</td>' +
            '<td class="truncate" title="' + escapeHtml(result['作者'] || '') + '">' + escapeHtml(result['作者'] || '-') + '</td>' +
            '<td>' + escapeHtml(result['发表年份'] || '-') + '</td>' +
            '<td class="truncate" title="' + escapeHtml(result['发表期刊/会议'] || '') + '">' + escapeHtml(result['发表期刊/会议'] || '-') + '</td>' +
            '<td>' + (isFailed ? '<span style="color:#f56565;">✗ 失败</span>' : '<span style="color:#48bb78;">✓ 成功</span>') + '</td>' +
            '<td><button class="expand-btn" onclick="showDetail(' + index + ')">查看详情</button></td>';
        tbody.appendChild(row);
    });
}

function showDetail(index) {
    var result = allResults[index];
    var modal = document.getElementById('detailModal');
    document.getElementById('modalTitle').textContent = '文献详情 - ' + result['文件名'];

    var fields = ['题目', '作者', '摘要', '研究问题', '使用理论', '研究方法', '研究步骤', '研究结果', '贡献', '关键词', '发表期刊/会议', '发表年份', '研究局限性'];

    var html = '<div style="margin-bottom:20px;"><button onclick="toggleDebugInfo()" style="background:#fcd34d;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;color:#78350f;">🐛 显示/隐藏调试信息</button><div id="debugInfoBox" class="debug-info" style="display:none;margin-top:12px;"><strong>完整对象数据：</strong><br><pre style="margin-top:8px;white-space:pre-wrap;word-break:break-all;">' + escapeHtml(JSON.stringify(result, null, 2)) + '</pre></div></div>';

    fields.forEach(function (f, i) {
        var v = result[f] || '';
        var empty = !v || String(v).trim() === '';
        html += '<div class="detail-item"><label>' + f + '</label><div class="value' + (empty ? ' empty' : '') + '">' + (empty ? '(暂无内容)' : escapeHtml(String(v))) + '</div></div>';
        if (i < fields.length - 1) html += '<div class="detail-divider"></div>';
    });

    document.getElementById('modalBody').innerHTML = html;
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function toggleDebugInfo() {
    var box = document.getElementById('debugInfoBox');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('show');
    document.body.style.overflow = '';
}

function exportCSV() {
    window.open('/api/export-csv', '_blank');
}

// ==================== 页面入口 ====================

document.addEventListener('DOMContentLoaded', function () {
    if (window.location.pathname === '/settings') {
        initSettingsPage();
    } else {
        initMainPage();
    }
});
