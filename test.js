// example.js
import GoFileDownloader from './gofile.js';

const downloader = new GoFileDownloader();
downloader.download('https://gofile.io/d/AdeIL9')
  .catch(console.error);