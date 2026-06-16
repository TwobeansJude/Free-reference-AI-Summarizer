from flask import Flask, render_template, request, jsonify, send_file
import os
import threading
from pathlib import Path
import requests
import json
from datetime import datetime
from pdf_reader import PDFReader

app = Flask(__name__)

analysis_results = []
is_analyzing = False
analysis_progress = 0
total_files = 0
current_file_name = ""
pdf_files_list = []

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = 'http://localhost:5000'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/settings')
def settings():
    return render_template('settings.html')

def call_ai_api(text, api_config):
    """调用AI API提取文献信息"""
    try:
        # 支持两种命名格式：下划线和驼峰命名
        api_key = api_config.get('api_key') or api_config.get('apiKey')
        api_url_val = api_config.get('api_url') or api_config.get('apiUrl')
        model_name = api_config.get('model_name') or api_config.get('modelName') or 'deepseek-chat'
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }

        prompt = f"""请从以下学术文献中提取结构化信息，以JSON格式返回。只返回JSON，不要包含其他文字。

重要要求：
- 题目、作者、发表期刊/会议：保持原文（英文或中文）
- 其他所有字段（摘要、研究问题、使用理论、研究方法、研究步骤、研究结果、贡献、关键词、研究局限性）：全部翻译成中文

提取字段：
- 题目：文献的标题（保持原文）
- 作者：作者列表（多个作者用逗号分隔，保持原文）
- 摘要：文献的摘要内容（用中文）
- 研究问题：文献要解决的问题（用中文）
- 使用理论：使用的理论基础（用中文）
- 研究方法：采用的研究方法（用中文）
- 研究步骤：具体的研究步骤（用中文）
- 研究结果：主要研究结果和发现（用中文）
- 贡献：本文的创新点和贡献（用中文）
- 关键词：3-5个关键词（用中文）
- 发表期刊/会议：发表的期刊或会议名称（保持原文）
- 发表年份：发表年份（如果能提取到）
- 研究局限性：研究的局限性（用中文）

文献内容：
{text[:8000]}
"""

        api_url = api_url_val.rstrip('/')
        if not api_url.endswith('/chat/completions'):
            api_url = api_url + '/chat/completions'

        data = {
            'model': model_name,
            'messages': [
                {'role': 'system', 'content': '你是一个专业的学术文献分析助手，擅长从PDF文本中提取结构化信息。只返回JSON格式的结果。'},
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.3,
            'max_tokens': 6000
        }

        response = requests.post(api_url, headers=headers, json=data, timeout=90)
        response.raise_for_status()

        result = response.json()
        
        # 检查是否有截断标记
        choice = result['choices'][0]
        if choice.get('finish_reason') == 'length':
            print(f"  [警告] AI返回被截断了！")
        
        ai_response = choice['message']['content']
        
        # 立即保存完整内容
        raw_ai = ai_response
        
        print("\n" + "="*80)
        print(f"  [AI返回] 完整内容 (长度={len(raw_ai)}, finish_reason={choice.get('finish_reason')}):")
        print("-"*80)
        print(raw_ai)
        print("="*80 + "\n")

        # ==================== 全面的JSON解析和字段映射 ====================
        
        # 函数：标准化字段名（小写、去下划线、去空格）
        def normalize_key(k):
            if not isinstance(k, str):
                return str(k)
            return k.lower().replace('_', '').replace(' ', '').replace('-', '')
        
        # 完整的字段映射表（所有可能的变体）
        field_mapping = {
            '题目': ['题目', 'title', 'Title', 'TITTLE', 'tittle', 'paper title', 'papertitle', '标题'],
            '作者': ['作者', 'authors', 'author', 'Authors', 'Author', 'AUTHORS', 'AUTHOR', 'writer', 'writers', 'Writer', 'Writers', 'by', 'by:', '作者信息', '作者名单'],
            '摘要': ['摘要', 'abstract', 'Abstract', 'ABSTRACT', 'summary', 'Summary', 'SUMMARY', 'abstracts', 'Abstracts', '概要', '内容摘要'],
            '研究问题': ['研究问题', 'research_question', 'research_questions', 'ResearchQuestion', 'ResearchQuestions', 'problem', 'Problem', 'PROBLEM', 'problems', 'Problems', 'researchproblem', 'research problems', '研究问题', '研究问题与目标', '问题', '研究目标', 'purpose', 'Purpose', 'objective', 'Objectives'],
            '使用理论': ['使用理论', 'theory', 'theories', 'Theory', 'Theories', 'THEORY', 'theoretical_basis', 'TheoreticalBasis', 'theoretical framework', 'theoreticalframework', 'theoretical', 'theoretical basis', '理论基础', '理论'],
            '研究方法': ['研究方法', 'method', 'methods', 'Method', 'Methods', 'METHODOLOGY', 'methodology', 'Methodology', 'research_method', 'research_methods', 'ResearchMethod', 'ResearchMethods', 'methodological approach', 'approach', 'Approach', '方法', '研究方法', '研究设计', 'research design', 'researchdesign'],
            '研究步骤': ['研究步骤', 'procedure', 'procedures', 'Procedure', 'Procedures', 'research_step', 'research_steps', 'ResearchStep', 'ResearchSteps', 'process', 'Process', 'processes', 'research process', '流程', '研究流程', '步骤', '研究方案', 'implementation', 'Implementation'],
            '研究结果': ['研究结果', 'results', 'result', 'Results', 'Result', 'findings', 'Findings', 'research_result', 'research_results', 'ResearchResult', 'ResearchResults', 'outcomes', 'Outcomes', 'results and findings', '结果', '研究发现', '发现', '主要结果', '主要发现'],
            '贡献': ['贡献', 'contribution', 'contributions', 'Contribution', 'Contributions', 'significance', 'Significance', 'value', 'Value', 'contribution of the paper', '创新点', '论文贡献', '主要贡献', 'contributions and implications', '意义'],
            '关键词': ['关键词', 'keywords', 'keyword', 'Keywords', 'Keyword', 'KEYWORDS', 'KEYWORD', 'KeyWords', 'key words', 'Keywords:', 'Keywords,', '关键词列表', '主题词'],
            '发表期刊/会议': ['发表期刊/会议', 'journal', 'conference', 'Journal', 'Conference', 'journal_conference', 'JournalConference', 'publication', 'Publication', 'venue', 'Venue', 'published in', '期刊', '会议', '发表期刊', '会议论文集'],
            '发表年份': ['发表年份', 'year', 'Year', 'YEAR', 'publication_year', 'PublicationYear', 'publish_year', 'PublishYear', 'publication year', 'publication date', 'date', 'Date', '年份', '发表时间', '出版年份'],
            '研究局限性': ['研究局限性', 'limitations', 'limitation', 'Limitations', 'Limitation', 'LIMITATIONS', 'research_limitations', 'ResearchLimitations', 'limitations and future work', 'LimitationsAndFutureWork', 'future work', 'FutureWork', '局限', '研究限制', '局限性', '不足', '研究不足']
        }
        
        # 所有标准字段名
        standard_fields = list(field_mapping.keys())
        
        # 清理AI返回内容（去除markdown标记、多余空格）
        def clean_ai_content(s):
            if not isinstance(s, str):
                return s
            # 去除 ```json 和 ```
            s = s.strip()
            if s.startswith('```json'):
                s = s[7:]
            elif s.startswith('```'):
                s = s[3:]
            if s.endswith('```'):
                s = s[:-3]
            return s.strip()
        
        # 尝试多种方式解析JSON
        def try_parse(s):
            cleaned = clean_ai_content(s)
            
            # 尝试1: 直接解析
            try:
                return json.loads(cleaned)
            except:
                pass
            
            # 尝试2: 找到第一个 { 和最后一个 } 之间的内容
            try:
                start = cleaned.find('{')
                end = cleaned.rfind('}') + 1
                if start >= 0 and end > start:
                    return json.loads(cleaned[start:end])
            except:
                pass
            
            # 尝试3: 更宽松的修复（有时候引号有问题）
            try:
                import re
                # 尝试修复未转义的引号等问题
                fixed = cleaned.replace('\n', ' ').replace('\r', ' ')
                start = fixed.find('{')
                end = fixed.rfind('}') + 1
                if start >= 0 and end > start:
                    return json.loads(fixed[start:end])
            except:
                pass
            
            return None
        
        # 开始解析
        parsed_data = try_parse(raw_ai)
        
        if not parsed_data:
            print("  [失败] 无法解析AI返回的JSON")
            return {}
        
        print(f"  [成功] 解析到数据: {parsed_data}")
        
        # 标准化所有键，然后进行匹配
        normalized_data = {}
        for key, value in parsed_data.items():
            normalized_key = normalize_key(key)
            normalized_data[normalized_key] = value
        
        # 构建最终结果
        final_result = {}
        
        # 为每个标准字段查找值
        for std_field in standard_fields:
            possible_keys = field_mapping[std_field]
            value_found = None
            
            for possible_key in possible_keys:
                # 先尝试精确匹配
                if possible_key in parsed_data:
                    val = parsed_data[possible_key]
                    if val and (not isinstance(val, str) or val.strip() != ''):
                        value_found = val
                        print(f"  ✓ 字段[{std_field}] 找到 (精确匹配): {possible_key}")
                        break
                
                # 再尝试标准化匹配
                norm_possible = normalize_key(possible_key)
                if norm_possible in normalized_data:
                    val = normalized_data[norm_possible]
                    if val and (not isinstance(val, str) or val.strip() != ''):
                        value_found = val
                        print(f"  ✓ 字段[{std_field}] 找到 (标准化匹配): {possible_key}")
                        break
            
            # 确保值是字符串
            if value_found is not None and not isinstance(value_found, str):
                value_found = str(value_found)
            
            final_result[std_field] = value_found if value_found is not None else ''
        
        print(f"  [最终结果] {final_result}")
        return final_result

    except Exception as e:
        print(f"[ERROR] AI API调用失败: {str(e)}")
        return {}

@app.route('/api/validate-path', methods=['POST'])
def validate_path():
    data = request.get_json()
    folder_path = data.get('folder_path', '').strip()

    # 安全校验：路径不能为空
    if not folder_path:
        return jsonify({'valid': False, 'error': '请输入文件夹路径'})

    # 安全校验：拒绝敏感系统路径
    dangerous_paths = ['/etc', '/sys', '/proc', '/dev', 'C:\\Windows', 'C:\\windows',
                       'C:\\WINDOWS', '/root', '/var/log', '/var/run']
    folder_lower = folder_path.lower().replace('\\', '/')
    for dangerous in dangerous_paths:
        if folder_lower.startswith(dangerous.lower().replace('\\', '/')):
            return jsonify({'valid': False, 'error': '不允许访问系统目录'})

    path = Path(folder_path).resolve()

    if not path.exists():
        return jsonify({'valid': False, 'error': '文件夹路径不存在'})

    if not path.is_dir():
        return jsonify({'valid': False, 'error': '该路径不是文件夹'})

    # 安全校验：拒绝访问隐藏目录（以 . 开头）
    if any(part.startswith('.') for part in path.parts):
        return jsonify({'valid': False, 'error': '不允许访问隐藏目录'})

    pdf_files = list(path.rglob('*.pdf'))

    if len(pdf_files) == 0:
        return jsonify({'valid': False, 'error': '该文件夹中没有PDF文件'})

    return jsonify({'valid': True, 'message': f'找到 {len(pdf_files)} 个PDF文件'})

@app.route('/api/scan', methods=['POST'])
def scan_folder():
    global pdf_files_list
    data = request.get_json()
    folder_path = data.get('folder_path', '').strip()

    if not folder_path:
        return jsonify({'success': False, 'error': '请输入文件夹路径'})

    path = Path(folder_path)
    if not path.exists():
        return jsonify({'success': False, 'error': '文件夹路径不存在'})

    if not path.is_dir():
        return jsonify({'success': False, 'error': '该路径不是文件夹'})

    pdf_files = list(path.rglob('*.pdf'))
    pdf_files_list = [{'name': f.name, 'path': str(f)} for f in pdf_files]

    if len(pdf_files_list) == 0:
        return jsonify({'success': False, 'error': '该文件夹中没有PDF文件'})

    return jsonify({
        'success': True,
        'count': len(pdf_files_list),
        'files': pdf_files_list
    })

@app.route('/api/analyze', methods=['POST'])
def start_analysis():
    global analysis_results, is_analyzing, analysis_progress, total_files, current_file_name

    if is_analyzing:
        return jsonify({'success': False, 'error': '正在分析中，请稍候'})

    data = request.get_json()
    api_config = data.get('api_config', {})
    folder_path = data.get('folder_path', '').strip()

    # 支持两种命名格式
    api_key = api_config.get('api_key') or api_config.get('apiKey')
    api_url_val = api_config.get('api_url') or api_config.get('apiUrl')

    if not api_key:
        return jsonify({'success': False, 'error': '请先在设置页面配置API密钥'})

    if not api_url_val:
        return jsonify({'success': False, 'error': 'API地址未配置'})

    if not folder_path:
        return jsonify({'success': False, 'error': '请选择文献文件夹'})

    analysis_results = []
    analysis_progress = 0
    is_analyzing = True

    thread = threading.Thread(target=analyze_pdfs, args=(folder_path, api_config), daemon=True)
    thread.start()

    return jsonify({'success': True})

def analyze_pdfs(folder_path, api_config):
    global analysis_results, is_analyzing, analysis_progress, total_files, current_file_name, pdf_files_list

    pdf_reader = PDFReader()
    total_files = len(pdf_files_list)
    
    # 清空之前的结果
    analysis_results = []
    
    print("="*60)
    print(f"开始分析，共 {total_files} 个文件")
    print("="*60)

    for idx, pdf_file in enumerate(pdf_files_list):
        if not is_analyzing:
            break

        current_file_name = pdf_file['name']
        print(f"\n[{idx+1}/{total_files}] 处理: {pdf_file['name']}")

        try:
            print(f"  正在提取PDF文本...")
            text = pdf_reader.read_pdf(pdf_file['path'])
            print(f"  PDF提取成功，共 {len(text)} 字符")

            if text:
                print(f"  正在调用AI分析...")
                analysis = call_ai_api(text, api_config)

                if not analysis:
                    analysis = {}
                
                # 确保有默认字段
                default_fields = [
                    '题目', '作者', '摘要', '研究问题', '使用理论',
                    '研究方法', '研究步骤', '研究结果', '贡献',
                    '关键词', '发表期刊/会议', '发表年份', '研究局限性'
                ]
                for field in default_fields:
                    if field not in analysis:
                        analysis[field] = ''
                
                analysis['文件名'] = pdf_file['name']
                analysis['文件路径'] = pdf_file['path']
                analysis_results.append(analysis)
                print(f"  AI分析完成")

        except Exception as e:
            import traceback
            error_msg = str(e)
            print(f"[ERROR] 处理文件 {pdf_file['name']} 时出错: {error_msg}")
            traceback.print_exc()  # 仅在服务器控制台输出，不返回给客户端

            analysis_results.append({
                '文件名': pdf_file['name'],
                '文件路径': pdf_file['path'],
                '题目': '(解析失败)',
                '错误信息': error_msg,  # 只返回错误消息，不暴露堆栈
                '作者': '', '摘要': '', '研究问题': '', '使用理论': '',
                '研究方法': '', '研究步骤': '', '研究结果': '', '贡献': '',
                '关键词': '', '发表期刊/会议': '', '发表年份': '', '研究局限性': ''
            })

        # 调试：打印刚添加的结果
        print(f"  [调试] 当前analysis_results长度: {len(analysis_results)}")
        if len(analysis_results) > 0:
            last = analysis_results[-1]
            print(f"  [调试] 最后一个结果: 题目={repr(last.get('题目'))}, 文件名={last.get('文件名')}")

        analysis_progress = int((idx + 1) / total_files * 100)
    
    print("\n" + "="*60)
    print("分析完成!")
    success_count = 0
    failure_count = 0
    for r in analysis_results:
        if r.get('题目') != '(解析失败)':
            success_count += 1
        else:
            failure_count += 1
    print(f"成功: {success_count}")
    print(f"失败: {failure_count}")
    print("="*60)
    
    is_analyzing = False

@app.route('/api/progress')
def get_progress():
    global analysis_progress, is_analyzing, current_file_name, analysis_results
    return jsonify({
        'progress': analysis_progress,
        'analyzing': is_analyzing,
        'current': current_file_name,
        'results_count': len(analysis_results)
    })

@app.route('/api/results')
def get_results():
    global analysis_results
    print("\n" + "="*80)
    print("[API] /api/results 被调用")
    print(f"[API] analysis_results 长度: {len(analysis_results)}")
    for i, r in enumerate(analysis_results):
        print(f"[API] [{i}] 题目={repr(r.get('题目'))}, 文件名={r.get('文件名')}")
    print("="*80 + "\n")
    return jsonify({
        'success': True,
        'results': analysis_results
    })

@app.route('/api/extraction-stats')
def get_extraction_stats():
    """获取PDF提取统计信息（需要重新设计来获取统计）"""
    # 从分析结果中提取提取库信息
    library_usage = {}
    failed_files = []
    
    for result in analysis_results:
        if result.get('题目') == '(解析失败)':
            failed_files.append({
                '文件名': result.get('文件名', ''),
                '错误信息': result.get('错误信息', ''),
                '提取库': result.get('提取库', ''),
                '提取尝试': result.get('提取尝试', '')
            })
        else:
            lib = result.get('提取库', '')
            if lib:
                library_usage[lib] = library_usage.get(lib, 0) + 1
    
    total_success = len(analysis_results) - len(failed_files)
    success_rate = total_success / len(analysis_results) if analysis_results else 0
    
    return jsonify({
        'success': True,
        'stats': {
            'total_files': len(analysis_results),
            'success_count': total_success,
            'failure_count': len(failed_files),
            'success_rate': success_rate,
            'library_usage': library_usage,
            'failed_files': failed_files
        }
    })

@app.route('/api/export-csv')
def export_csv():
    if not analysis_results:
        return jsonify({'success': False, 'error': '没有可导出的数据'}), 400

    import csv
    import io

    headers = ['文件名', '题目', '作者', '摘要', '研究问题', '使用理论',
               '研究方法', '研究步骤', '研究结果', '贡献', '关键词',
               '发表期刊/会议', '发表年份', '研究局限性', '错误信息']

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)

    writer.writerow(headers)

    for result in analysis_results:
        row = []
        for header in headers:
            value = result.get(header, '')
            if value is None:
                value = ''
            value_str = str(value).replace('\n', ' ').replace('\r', ' ')
            row.append(value_str)
        writer.writerow(row)

    output.seek(0)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'literature_summary_{timestamp}.csv'

    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        as_attachment=True,
        download_name=filename,
        mimetype='text/csv'
    )

if __name__ == '__main__':
    app.run(debug=False)
