/**
 * GoFile Web Server
 * A Node.js Express server that handles file downloads via GoFile API
 * Provides WebSocket support for real-time progress updates
 */

// ES Module imports
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import GoFileDownloader from './gofile.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize GoFile downloader instance
const downloader = new GoFileDownloader();

// Express and WebSocket server setup
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Server configuration
const PORT = process.env.PORT || 3000;

// Configure middleware for parsing request bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/**
 * Utility function for consistent logging
 * @param {string} message - Message to log
 * @returns {string} Formatted log message with timestamp
 */
const log = (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    return `[${timestamp}] ${message}`;
};

// WebSocket connection handler
// Manages real-time communication with clients
wss.on('connection', (ws) => {
    log('WebSocket connection established');
    ws.on('message', (message) => {
        log(`Received message: ${message}`);
    });
    ws.on('error', (error) => {
        log(`WebSocket error: ${error.message}`, 'error');
    });
});

// Route handler for serving the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * URL validation utility
 * @param {string} url - URL to validate
 * @returns {boolean} Whether the URL is valid
 */
const isValidUrl = (url) => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

/**
 * Download endpoint
 * Handles file download requests and broadcasts progress via WebSocket
 */
app.post('/download', async (req, res) => {
    const url = req.body.url.trim();

    // Validate input URL
    if (!url || !isValidUrl(url)) {
        return res.status(400).json({
            error: 'Invalid URL provided'
        });
    }

    try {
        // Configure progress callback for WebSocket broadcasts
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

// Global error handling middleware
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

// Start server and listen on configured port
server.listen(PORT, () => {
    log(`Server is running on http://localhost:${PORT}`)
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
    server.close(() => {
        log('Server shutdown complete');
        process.exit(0);
    });
});