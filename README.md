# Add a Youtube Playlist to queue in a [sync-tube](https://sync-tube.de/) room

## Usage Instructions
1. Navigate to your [sync-tube](https://sync-tube.de/) room or create a new one
2. Open the browser's dev tools (F12) and go to the Console
3. Copy-paste the contents of `queue-youtube-playlist.js` into your browser's Console
4. To queue a Youtube playlist's videos to the SyncTube room:
```js
queueYoutubePlaylist(YOUR_API_KEY, YOUTUBE_PLAYLIST_URL);

// Example usage
queueYoutubePlaylist("fakeapikey123", "https://www.youtube.com/playlist?list=PLxkBRm_U8gJ8x-J9SR_-sSm2gcT8Gnmuh");
```

