// 使用 ES 模块导入语法
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';
import {WebSocket, WebSocketServer } from 'ws';
import GoFileDownloader from './gofile.js';

// 获取 __dirname 替代方案（ES 模块中不直接支持 __dirname）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const downloader = new GoFileDownloader();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const log = (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    return `[${timestamp}] ${message}`;
};

// WebSocket 连接处理 - 移到外面
wss.on('connection', (ws) => {
    log('WebSocket connection established');
    ws.on('message', (message) => {
        log(`Received message: ${message}`);
    });
    ws.on('error', (error) => {
        log(`WebSocket error: ${error.message}`, 'error');
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// URL 验证函数
const isValidUrl = (url) => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

app.post('/download', async (req, res) => {
    const url = req.body.url.trim();

    if (!url || !isValidUrl(url)) {
        return res.status(400).json({
            error: 'Invalid URL provided'
        });
    }

    try {
        downloader.onProgress = (progress) => {
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'progress',
                        data: progress
                    }));
                }
            });
        };

        await downloader.download(url);
        return res.json({ message: 'Download completed successfully' });
    } catch (error) {
        log(`Download error: ${error.stack || error.message}`, 'error');
        return res.status(500).json({
            error: 'Download failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    const errorMessage = `Server error (${req.method} ${req.path}): ${err.message}`;
    log(errorMessage, 'error');
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

server.listen(PORT, () => {
    log(`Server is running on http://localhost:${PORT}`)
});

process.on('SIGTERM', () => {
    server.close(() => {
        log('Server shutdown complete');
        process.exit(0);
    });
});