FROM python:3.13-slim

# 设置工作目录
WORKDIR /app

# 复制项目文件到工作目录
COPY server.js index.html gofile.py package*.json requirements.txt ./

RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install -r requirements.txt \
    && npm install

# 暴露应用运行的端口
EXPOSE 3000

# 启动应用
CMD ["node", "server.js"]