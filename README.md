# Add a Youtube Playlist to queue in a [sync-tube](https://sync-tube.de/) room

## Prerequisites
- [NodeJS](https://nodejs.dev/) - `choco install nodejs`
- [Yarn](https://classic.yarnpkg.com/lang/en/docs/install/)/NPM - `choco install yarn`
- Google account
- Youtube API Key
  1. Log in to [Google Developers Console](https://console.cloud.google.com/).
  2. Create a new project (use search bar if needed).
  3. Navigate to [APIs & Services](https://console.cloud.google.com/apis/dashboard).
  4. Click "Library" then search for "YouTube Data API v3" under YouTube APIs.
  5. Enable the API after ensuring your new project is selected in the top bar.
  6. Click "Credentials" -> "Create Credentials" -> API Key.
  7. A screen will appear with your new Youtube API key!


## Usage Instructions
1. Clone the repository and navigate to it!
```bash
git clone https://github.com/NoahFrank/synctube-playlist-queue.git
cd synctube-playlist-queue
````
2. Install dependencies with `yarn` or `npm install`
3. Create an `.env` file from the `.env.sample` file, replacing <YOUR_YOUTUBE_API_KEY> with the API Key acquired in the Prerequisites
4. Run the script with `node` like so:
```bash
node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> queue <YOUTUBE_URL>
```

## Queue Youtube Playlist in Synctube
Add the entire Youtube playlist into Synctube playlist, include `--random` if you want to randomize the queueing order.  Supports adding a single Youtube video to Synctube playlist.
```bash
node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> queue <YOUTUBE_URL> [ --random ]
```

## Clear Synctube Playlist
*Ensure the Viewer group has 'Remove' permissions in the Synctube room*
```bash
node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> clear
```

## Move To Top of Synctube Playlist
*Ensure the Viewer group has 'Move' permissions in the Synctube room*
```bash
node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> top
```

## Limitations
- When queueing videos from the websocket maximum is **50** videos.

## Authors
Noah Frank and Colin Thatcher (shoutout to Big Bird for the direct Websocket connection POC)