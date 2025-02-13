// gofile.js
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, statSync } from 'fs';
import { mkdir, readdir, unlink, cp, rm, readFile, writeFile } from 'fs/promises';
import JSZip from 'jszip';
import { join, basename, dirname } from 'path';

/**
 * GoFileDownloader - A class to download and organize files from GoFile.io
 * Features:
 * - Downloads files from GoFile.io with resume support
 * - Handles folder structures recursively
 * - Organizes music files into artist/album structure
 * - Supports password protected content
 */
class GoFileDownloader {
	/**
	 * Initialize the downloader
	 * @param {string} rootDir - Base directory for downloads
	 */
	constructor(rootDir) {
		this.rootDir = process.env.GF_DOWNLOADDIR || process.cwd();
		this.musicDir = process.env.GF_MUSICDIR || '';
		this.filesInfo = {};
		this.recursiveFilesIndex = 0;
		this.token = null;
		this.onProgress = null;
		this.progressThrottle = 500;
	}

	/**
	 * Get authentication token from GoFile.io
	 * @returns {Promise<string>} Authentication token
	 * @throws {Error} If account creation fails
	 */
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

	/**
	 * Extract ZIP file to specified path
	 * @param {string} zipPath - Path to ZIP file
	 * @param {string} extractPath - Path to extract files to
	 * @returns {Promise<void>}
	 */
	async unzipFile(zipPath, extractPath) {

		try {
			const data = await readFile(zipPath);
			const zip = new JSZip();
			const contents = await zip.loadAsync(data);
			await mkdir(extractPath, { recursive: true });

			const extractPromises = [];
			contents.forEach((relativePath, file) => {
				if (!file.dir) {
					// 构建完整的解压路径
					const fullPath = join(extractPath, relativePath);
					// 确保文件的目录存在
					const dirPath = dirname(fullPath);

					const promise = mkdir(dirPath, { recursive: true })
						.then(() => file.async('nodebuffer'))
						.then(content => writeFile(fullPath, content));

					extractPromises.push(promise);
				}
			});

			await Promise.all(extractPromises);
			return true;
		} catch (error) {
			throw (error);
		};
	}

	/**
	 * Recursively parse GoFile.io links from folder structure
	 * @param {string} contentId - GoFile content ID
	 * @param {string} [password] - Optional password for protected content
	 * @throws {Error} If content fetch fails
	 */
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

	/**
	 * Main download function
	 * @param {string} url - GoFile.io URL
	 * @param {string} [password] - Optional password
	 * @throws {Error} If URL format is invalid
	 */
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

	/**
	 * Download single file content with progress
	 * @param {Object} fileInfo - File information object
	 * @param {string} fileInfo.filename - File name
	 * @param {string} fileInfo.link - Download link
	 * @returns {Promise<void>}
	 */
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
		let progressMessage = '';

		await new Promise((resolve, reject) => {
			let lastUpdate = 0;
			response.body.on('data', (chunk) => {
				downloadedSize += chunk.length;
				const now = Date.now();
				if (now - lastUpdate >= this.progressThrottle) {
					const progress = (downloadedSize / parseInt(totalSize)) * 100;
					const elapsedSeconds = (performance.now() - startTime) / 1000;
					const rate = (downloadedSize - partSize) / elapsedSeconds;

					// 计算下载速率单位
					let rateStr = this.formatRate(rate);

					const progressMessage = `Downloading ${fileInfo.filename}: ${downloadedSize / (1024 * 1024)} of ${totalSize / (1024 * 1024)} ${progress.toFixed(1)}% ${rateStr}`;

					if (this.onProgress) {
						this.onProgress(progressMessage);
					}
					lastUpdate = now;
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
			await cp(tmpFile, filepath, { recursive: true });
			await this.organizeMusicFolder(filepath);
			await rm(tmpFile, { recursive: true });
			process.stdout.write('\r' + ' '.repeat(progressMessage.length));
			console.log(`\rDownloading ${fileInfo.filename}: ${totalSize / (1024 * 1024)} of ${totalSize / (1024 * 1024)} Done!`);

		}
	}

	/**
	 * Parse artist and album from folder name
	 * @param {string} folderName - Folder name in "Artist - Album" format
	 * @returns {Object} Object containing artist and album
	 * @throws {Error} If folder name format is invalid
	 */
	parseArtistAlbum(folderName) {
		const parts = folderName.split(' - ');
		if (parts.length < 2) {
			throw new Error(`Invalid folder name format: ${folderName}`);
		}
		
		const artist = parts[0].trim();
		// 如果有多个'-'，将剩余部分合并为专辑名
		const album = parts.slice(1).join(' - ').trim();
		
		return { artist, album };
	}

	/**
	 * Organize music files into artist/album structure
	 * @param {string} sourcePath - Path to source ZIP file
	 * @returns {Promise<void>}
	 */
	async organizeMusicFolder(sourcePath) {
		if (!this.musicDir) {
			return; // 如果没有设置音乐目录，直接返回
		}

		try {
			// 如果文件是zip且在文件名中包含音乐相关标识，则进行处理
			if (sourcePath.endsWith('.zip')) {
				const tempExtractPath = join(this.rootDir, basename(sourcePath, '.zip'));
				await mkdir(tempExtractPath, { recursive: true });

				console.log(`Organizing music file: ${sourcePath}`);
				await this.unzipFile(sourcePath, tempExtractPath);

				const extractedItems = await readdir(tempExtractPath);

				for (const item of extractedItems) {
					const itemPath = join(tempExtractPath, item);
					const itemStat = await statSync(itemPath);

					if (itemStat.isDirectory()) {
						try {
							const { artist, album } = this.parseArtistAlbum(item);
							const artistPath = join(this.musicDir, artist);

							await mkdir(artistPath, { recursive: true });
							const targetPath = join(artistPath, album);

							if (!existsSync(targetPath)) {
								// 使用cp替代rename处理跨设备复制
								await cp(itemPath, targetPath, { recursive: true });
								await rm(itemPath, { recursive: true });
								console.log(`Organized music: ${artist} - ${album}`);
							} else {
								console.log(`Album already exists: ${artist} - ${album}`);
							}
						} catch (error) {
							console.error(`Error processing music folder "${item}":`, error.message);
						}
					}
				}

				// 清理临时文件
				await unlink(sourcePath);
				await rm(tempExtractPath, { recursive: true }); // 替换rmdir
				console.log(`Cleaned up ${sourcePath} and temporary files`);
			}
		} catch (error) {
			console.error('Error organizing music folder:', error);
		}
	}

	/**
	 * Format download rate to human readable string
	 * @param {number} rate - Bytes per second
	 * @returns {string} Formatted rate string (B/s, KB/s, MB/s, GB/s)
	 */
	formatRate(rate) {
		if (rate < 1024) return `${rate.toFixed(1)}B/s`;
		if (rate < 1024 * 1024) return `${(rate / 1024).toFixed(1)}KB/s`;
		if (rate < 1024 * 1024 * 1024) return `${(rate / (1024 * 1024)).toFixed(1)}MB/s`;
		return `${(rate / (1024 * 1024 * 1024)).toFixed(1)}GB/s`;
	}
}

export default GoFileDownloader;