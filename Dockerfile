FROM node:22.11.0-slim

# 设置工作目录
WORKDIR /app

# 复制项目文件到工作目录
COPY server.js index.html gofile.js package*.json ./

RUN npm install

# 暴露应用运行的端口
EXPOSE 3000

# 启动应用
CMD ["node", "server.js"]