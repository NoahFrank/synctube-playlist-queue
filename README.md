# Add a Youtube Playlist to queue in a [sync-tube](https://sync-tube.de/) room

## Prerequisite
- Youtube API Key
    1. Log in to [Google Developers Console](https://console.cloud.google.com/).
    2. Create a new project (use search bar if needed).
    3. Navigate to [APIs & Services](https://console.cloud.google.com/apis/dashboard).
    4. Click "Library" then search for "YouTube Data API v3" under YouTube APIs.
    5. Enable the API after ensuring your new project is selected in the top bar.
    6. Click "Credentials" -> "Create Credentials" -> API Key.
    7. A screen will appear with your new Youtube API key!


## Usage Instructions
1. Navigate to your [sync-tube](https://sync-tube.de/) room or create a new one
2. Open the browser's dev tools (F12) and go to the Console
3. Copy-paste the contents of `queue-youtube-playlist.js` into your browser's Console
4. To queue a Youtube playlist's videos to the SyncTube room:
```js
queueYoutubePlaylist(YOUTUBE_API_KEY, YOUTUBE_PLAYLIST_URL);

// Example usage
queueYoutubePlaylist("fakeapikey123", "https://www.youtube.com/playlist?list=PLxkBRm_U8gJ8x-J9SR_-sSm2gcT8Gnmuh");
```

