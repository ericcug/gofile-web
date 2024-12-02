// gofile.js
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { join } from 'path';
import { createWriteStream, existsSync, statSync } from 'fs';
import { mkdir, rename } from 'fs/promises';

class GoFileDownloader {
  constructor(rootDir) {
    this.rootDir = process.env.GF_DOWNLOADDIR || process.cwd();
    this.filesInfo = {};
    this.recursiveFilesIndex = 0;
    this.token = null;
    this.onProgress = null;
  }

  async getToken() {
    const headers = {
      'User-Agent': process.env.GF_USERAGENT || 'Mozilla/5.0',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };

    const response = await fetch('https://api.gofile.io/accounts', {
      method: 'POST',
      headers
    });

    const data = await response.json();
    if (data.status !== 'ok') {
      throw new Error('Account creation failed');
    }

    return data.data.token;
  }

  async downloadContent(fileInfo) {
    const filepath = join(this.rootDir, fileInfo.filename);
    if (existsSync(filepath) && statSync(filepath).size > 0) {
      console.log(`${filepath} already exists, skipping.`);
      return;
    }

    const tmpFile = `${filepath}.part`;
    const headers = {
      'Cookie': `accountToken=${this.token}`,
      'User-Agent': process.env.GF_USERAGENT || 'Mozilla/5.0',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };

    let partSize = 0;
    if (existsSync(tmpFile)) {
      partSize = statSync(tmpFile).size;
      headers['Range'] = `bytes=${partSize}-`;
    }

    const response = await fetch(fileInfo.link, { headers });

    if (!response.ok ||
      (partSize === 0 && response.status !== 200) ||
      (partSize > 0 && response.status !== 206)) {
      console.error(`Download failed: ${fileInfo.link} (Status: ${response.status})`);
      return;
    }

    const contentLength = response.headers.get('content-length');
    const totalSize = partSize === 0 ? contentLength :
      contentLength ? contentLength.split('/').pop() : null;

    if (!totalSize) {
      console.error('Could not determine file size');
      return;
    }

    const fileStream = createWriteStream(tmpFile, { flags: 'a' });
    const startTime = performance.now();
    let downloadedSize = partSize;
    let message = '';

    await new Promise((resolve, reject) => {
      response.body.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = (downloadedSize / parseInt(totalSize)) * 100;
        const elapsedSeconds = (performance.now() - startTime) / 1000;
        const rate = (downloadedSize - partSize) / elapsedSeconds;

        // 计算下载速率单位
        let rateStr = this.formatRate(rate);

        const progressMessage = `Downloading ${fileInfo.filename}: ${downloadedSize} of ${totalSize} ${progress.toFixed(1)}% ${rateStr}`;

        if (this.onProgress) {
          this.onProgress(progressMessage);
        }
      });

      response.body.pipe(fileStream);
      response.body.on('error', reject);
      fileStream.on('finish', resolve);
      fileStream.on('error', (err) => {
        fileStream.close();
        reject(err);
      });
    });

    if (statSync(tmpFile).size === parseInt(totalSize)) {
      await rename(tmpFile, filepath);
      process.stdout.write('\r' + ' '.repeat(message.length));
      console.log(`\rDownloading ${fileInfo.filename}: ${totalSize} of ${totalSize} Done!`);
    }
  }
  formatRate(rate) {
    if (rate < 1024) return `${rate.toFixed(1)}B/s`;
    if (rate < 1024 * 1024) return `${(rate / 1024).toFixed(1)}KB/s`;
    if (rate < 1024 * 1024 * 1024) return `${(rate / (1024 * 1024)).toFixed(1)}MB/s`;
    return `${(rate / (1024 * 1024 * 1024)).toFixed(1)}GB/s`;
  }
  async parseLinksRecursively(contentId, password) {
    const url = new URL(`https://api.gofile.io/contents/${contentId}`);
    url.searchParams.append('wt', '4fd6sg89d7s6');
    url.searchParams.append('cache', 'true');

    if (password) {
      url.searchParams.append('password',
        createHash('sha256').update(password).digest('hex'));
    }

    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'User-Agent': process.env.GF_USERAGENT || 'Mozilla/5.0',
      'Accept': '*/*'
    };

    const response = await fetch(url.toString(), { headers });
    const data = await response.json();

    if (data.status !== 'ok') {
      throw new Error(`Failed to get content from ${url}`);
    }

    const content = data.data;
    if (content.type === 'folder') {
      for (const childId in content.children) {
        const child = content.children[childId];
        if (child.type === 'folder') {
          await this.parseLinksRecursively(child.id, password);
        } else {
          this.recursiveFilesIndex++;
          this.filesInfo[this.recursiveFilesIndex] = {
            path: this.rootDir,
            filename: child.name,
            link: child.link
          };
        }
      }
    } else {
      this.recursiveFilesIndex++;
      this.filesInfo[this.recursiveFilesIndex] = {
        path: this.rootDir,
        filename: content.name,
        link: content.link
      };
    }
  }

  async download(url, password) {
    try {
      const urlParts = url.split('/');
      if (urlParts[urlParts.length - 2] !== 'd') {
        throw new Error('Invalid URL format');
      }

      const contentId = urlParts[urlParts.length - 1];
      this.token = await this.getToken();

      await this.parseLinksRecursively(contentId, password);

      if (Object.keys(this.filesInfo).length === 0) {
        console.log(`No files found for url: ${url}`);
        return;
      }

      for (const fileInfo of Object.values(this.filesInfo)) {
        await this.downloadContent(fileInfo);
      }
    } finally {
      this.filesInfo = {};
      this.recursiveFilesIndex = 0;
    }
  }
}

export default GoFileDownloader;