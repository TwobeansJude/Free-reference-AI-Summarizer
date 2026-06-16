# AI 文献总结器

一个基于 AI 的学术文献自动分析工具，扫描 PDF 文件夹，调用大语言模型提取结构化信息。

## 功能特性

- **PDF 扫描**：自动扫描指定文件夹中的所有 PDF 文件
- **AI 信息提取**：调用 AI API 从文献中提取 13 个结构化字段
  - 题目、作者、摘要、研究问题、使用理论、研究方法
  - 研究步骤、研究结果、贡献、关键词、发表期刊/会议、发表年份、研究局限性
- **CSV 导出**：将分析结果导出为 CSV 表格
- **Web 界面**：简洁的浏览器操作界面

## 安装依赖

```bash
pip install -r requirements.txt
```

## 配置 API

打开浏览器访问 http://localhost:5000/settings，填入：
- API 密钥（DeepSeek 或其他兼容 OpenAI 接口的 Key）
- API 地址
- 模型名称

设置保存在浏览器本地存储中，不会上传到服务器。

## 运行程序

```bash
python app.py
```

打开浏览器访问 http://localhost:5000

## 使用方法

1. 在输入框中填入包含 PDF 文献的文件夹路径
2. 点击「扫描文件夹」确认 PDF 文件
3. 点击「开始分析」，AI 逐篇提取信息
4. 分析完成后点击「导出 CSV」保存结果

## 技术栈

- 后端：Python Flask
- 前端：原生 HTML + CSS + JavaScript
- AI：兼容 OpenAI 接口的大语言模型（默认 DeepSeek）
- PDF 解析：PyMuPDF
