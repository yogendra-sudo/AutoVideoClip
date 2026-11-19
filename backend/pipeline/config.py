"""
Pipeline模块配置文件
"""

import os
from pathlib import Path

# 获取项目根目录
PROJECT_ROOT = Path(__file__).parent.parent.parent
BACKEND_ROOT = Path(__file__).parent.parent

# 数据目录
DATA_DIR = PROJECT_ROOT / "data"
METADATA_DIR = DATA_DIR / "output" / "metadata"

# 提示词文件路径
PROMPT_DIR = PROJECT_ROOT / "prompt"
PROMPT_FILES = {
    'outline': PROMPT_DIR / "outline.txt",
    'timeline': PROMPT_DIR / "timestamps.txt",
    'scoring': PROMPT_DIR / "recommendation_reason.txt",
    'recommendation': PROMPT_DIR / "recommendation_reason.txt",
    'title': PROMPT_DIR / "title_generation.txt",
    'clustering': PROMPT_DIR / "topic_clustering.txt"
}

# 确保目录存在
METADATA_DIR.mkdir(parents=True, exist_ok=True)
PROMPT_DIR.mkdir(parents=True, exist_ok=True)

# API密钥配置
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# 默认API密钥
DEFAULT_API_KEY = DASHSCOPE_API_KEY or OPENAI_API_KEY

# 评分阈值
MIN_SCORE_THRESHOLD = 7.0

# 聚类配置
MAX_CLIPS_PER_COLLECTION = 10
