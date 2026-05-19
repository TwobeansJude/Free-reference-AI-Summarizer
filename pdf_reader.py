"""PDF阅读模块（最简单兼容版）"""
import fitz
from pathlib import Path


class PDFReader:
    def __init__(self):
        pass
    
    def read_pdf(self, file_path: str) -> str:
        """读取PDF文件 - 最简单版本"""
        try:
            doc = fitz.open(file_path)
            text = ""
            for page in doc:
                page_text = page.get_text()
                if page_text:
                    text += page_text + "\n\n"
            doc.close()
            
            if len(text.strip()) > 0:
                return text
            else:
                raise ValueError("提取的文本为空")
                
        except Exception as e:
            raise ValueError(f"PDF提取失败: {str(e)}")
    
    def extract_first_page_text(self, file_path: str, max_chars: int = 3000) -> str:
        """提取首页文本"""
        try:
            doc = fitz.open(file_path)
            if len(doc) > 0:
                text = doc[0].get_text()
                doc.close()
                return text[:max_chars] if text else ""
            doc.close()
        except:
            pass
        return ""
    
    def extract_metadata(self, file_path: str) -> dict:
        """提取PDF元数据"""
        try:
            doc = fitz.open(file_path)
            metadata = doc.metadata
            doc.close()
            return metadata
        except:
            return {}
