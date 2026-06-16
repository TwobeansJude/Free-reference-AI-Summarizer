// AI 文献总结器 - 前端交互逻辑

// ========== 设置管理 ==========
function loadSettings() {
    return {
        api_key: localStorage.getItem('api_key') || '',
        api_url: localStorage.getItem('api_url') || 'https://api.deepseek.com',
        model_name: localStorage.getItem('model_name') || 'deepseek-chat'
    };
}

function saveSettings(key, url, model) {
    localStorage.setItem('api_key', key);
    localStorage.setItem('api_url', url);
    localStorage.setItem('model_name', model);
}

// ========== 当前页面逻辑 ==========
document.addEventListener('DOMContentLoaded', () => {
    const isSettings = window.location.pathname === '/settings';

    if (isSettings) {
        initSettingsPage();
    } else {
        initMainPage();
    }
});

// ========== 设置页面 ==========
function initSettingsPage() {
    const settings = loadSettings();
    document.getElementById('apiKey').value = settings.api_key;
    document.getElementById('apiUrl').value = settings.api_url;
    document.getElementById('modelName').value = settings.model_name;

    document.getElementById('btnSave').addEventListener('click', () => {
        const key = document.getElementById('apiKey').value.trim();
        const url = document.getElementById('apiUrl').value.trim();
        const model = document.getElementById('modelName').value.trim();

        if (!key) {
            showMsg('saveResult', '请输入 API 密钥', 'error');
            return;
        }
        if (!url) {
            showMsg('saveResult', '请输入 API 地址', 'error');
            return;
        }

        saveSettings(key, url, model);
        showMsg('saveResult', '设置已保存', 'success');
    });
}

// ========== 主页 ==========
let pollTimer = null;

function initMainPage() {
    const btnScan = document.getElementById('btnScan');
    const btnAnalyze = document.getElementById('btnAnalyze');
    const btnExport = document.getElementById('btnExport');

    btnScan.addEventListener('click', scanFolder);
    btnAnalyze.addEventListener('click', startAnalysis);
    btnExport.addEventListener('click', exportCSV);
}

function showMsg(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'result-hint ' + type;
}

async function scanFolder() {
    const folderPath = document.getElementById('folderPath').value.trim();
    if (!folderPath) {
        showMsg('scanResult', '请输入文件夹路径', 'error');
        return;
    }

    showMsg('scanResult', '正在扫描...', '');
    document.getElementById('btnScan').disabled = true;

    try {
        const resp = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_path: folderPath })
        });
        const data = await resp.json();

        if (data.success) {
            showMsg('scanResult', `找到 ${data.count} 个 PDF 文件`, 'success');
            document.getElementById('btnAnalyze').disabled = false;
        } else {
            showMsg('scanResult', data.error || '扫描失败', 'error');
            document.getElementById('btnAnalyze').disabled = true;
        }
    } catch (e) {
        showMsg('scanResult', '请求失败: ' + e.message, 'error');
    }

    document.getElementById('btnScan').disabled = false;
}

async function startAnalysis() {
    const folderPath = document.getElementById('folderPath').value.trim();
    const settings = loadSettings();

    if (!settings.api_key) {
        alert('请先在设置页面配置 API 密钥');
        return;
    }

    document.getElementById('btnAnalyze').disabled = true;
    document.getElementById('progressBar').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';

    try {
        const resp = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folder_path: folderPath,
                api_config: {
                    api_key: settings.api_key,
                    api_url: settings.api_url,
                    model_name: settings.model_name
                }
            })
        });
        const data = await resp.json();

        if (data.success) {
            pollProgress();
        } else {
            showMsg('scanResult', data.error || '启动失败', 'error');
            document.getElementById('btnAnalyze').disabled = false;
            document.getElementById('progressBar').style.display = 'none';
        }
    } catch (e) {
        showMsg('scanResult', '请求失败: ' + e.message, 'error');
        document.getElementById('btnAnalyze').disabled = false;
        document.getElementById('progressBar').style.display = 'none';
    }
}

function pollProgress() {
    if (pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
        try {
            const resp = await fetch('/api/progress');
            const data = await resp.json();

            document.getElementById('progressFill').style.width = data.progress + '%';
            document.getElementById('progressText').textContent =
                data.analyzing
                    ? `正在分析: ${data.current} (${data.results_count} 完成, ${data.progress}%)`
                    : '分析完成!';

            if (!data.analyzing) {
                clearInterval(pollTimer);
                pollTimer = null;
                document.getElementById('progressBar').style.display = 'none';
                document.getElementById('btnAnalyze').disabled = false;
                loadResults();
            }
        } catch (e) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }, 1000);
}

async function loadResults() {
    try {
        const resp = await fetch('/api/results');
        const data = await resp.json();

        if (!data.success || !data.results.length) {
            return;
        }

        document.getElementById('resultsSection').style.display = 'block';
        const tbody = document.querySelector('#resultsTable tbody');
        tbody.innerHTML = '';

        data.results.forEach((r, i) => {
            const isFail = r['题目'] === '(解析失败)';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td title="${esc(r['文件名'])}">${esc(r['文件名'])}</td>
                <td>${esc(r['题目'] || '-')}</td>
                <td>${esc(r['作者'] || '-')}</td>
                <td>${esc(r['发表期刊/会议'] || '-')}</td>
                <td>${esc(r['发表年份'] || '-')}</td>
                <td>${esc(r['关键词'] || '-')}</td>
                <td class="${isFail ? 'status-fail' : 'status-ok'}">${isFail ? '失败' : '成功'}</td>
            `;
            tr.addEventListener('click', () => showDetail(r));
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('加载结果失败:', e);
    }
}

function showDetail(r) {
    const panel = document.getElementById('resultDetail');
    const fields = ['题目', '作者', '摘要', '研究问题', '使用理论', '研究方法',
                    '研究步骤', '研究结果', '贡献', '关键词', '发表期刊/会议',
                    '发表年份', '研究局限性', '错误信息'];

    let html = '<h3>' + esc(r['文件名'] || '详情') + '</h3>';
    fields.forEach(f => {
        const v = r[f];
        if (v && v.trim()) {
            html += `<div class="field">
                <div class="field-label">${f}</div>
                <div class="field-value">${esc(v)}</div>
            </div>`;
        }
    });

    panel.innerHTML = html;
    panel.classList.add('show');
}

function exportCSV() {
    window.open('/api/export-csv', '_blank');
}

function esc(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
