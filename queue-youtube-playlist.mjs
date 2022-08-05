import WebSocket from "ws";
import fetch from "node-fetch";
import dotenv from "dotenv";

// CONSTANTS
const QUEUE_LOOP_SLEEP_PERIOD = 200; // In milliseconds
const VIDEO_QUEUE_CODE = 30;  // Msg type code for Synctube Websockets
const SET_NAME_CODE = 12;

const parseCookies = str =>
	str.split(';')
	.map(v => v.split('='))
	.reduce((acc, v) => {
		let key = v[0].trim();
		let value = "";
		if (v[1] !== undefined && v[1].length > 0) {
			value = v[1].trim();
		}
		acc[decodeURIComponent(key)] = decodeURIComponent(value);
		return acc;
	}, {});

// Source: https://levelup.gitconnected.com/javascript-wait-until-something-happens-or-timeout-82636839ea93
async function sleepUntil(f, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startTime = new Date();
        let wait = setInterval(function() {
            if (f()) {  // Condition success case
                clearInterval(wait);
                resolve();
            } else if (new Date() - startTime > timeoutMs) { // Timeout fail case
                console.error("rejected after", new Date() - startTime, "ms");
                clearInterval(wait);
                reject();
            }
        }, 20);
    });
}

// Manually create a websocket connection to the given synctube room ID.  In order to authenticate, we first need an 's' cookie which can be obtained
// from the 'set-cookie' response header from 'https://sync-tube.de/api/user'.
// Source: Colin Thatcher
async function createWebsocket(roomId) {
	// GET 's' AUTH COOKIE BY MAKING SIMPLE UNAUTHORIZED REQUEST TO USER API
	const authCookieResponse = await fetch("https://sync-tube.de/api/user");
	if (authCookieResponse.status != 401) {
		throw Error(`ERROR: FAILED TO REQUEST AUTH COOKIE TOKEN EXPECTED 401 UNAUTHORIZED, STATUS=${authCookieResponse.status}`);
	}
	const rawCookies = authCookieResponse.headers.raw()["set-cookie"][0];
	const cookies = parseCookies(rawCookies);
	if (!('s' in cookies)) {
		throw Error(`ERROR: FAILED TO EXTRACT AUTH COOKIE TOKEN EXPECTED 401 UNAUTHORIZED, STATUS=${authCookieResponse.status}, COOKIES=${rawCookies}`);
	}

	// CONNECT TO THE SYNCTUBE ROOM'S WEBSOCKET
	const authCookie = `s=${cookies['s']}`;
	const options = { headers: {Cookie: authCookie} };
	// const userString = '{.".u.s.e.r.".:.{.".n.a.m.e.".:.".t.u.r.t.l.e. .t.h.e. .m.o.o.s.e.".,.".c.o.l.o.r.".:.".#.5.c.4.1.8.3.".}.}.';
	// const base64UserString = Buffer.from(userString).toString('base64');
	const base64UserString = 'ey4iLnUucy5lLnIuIi46LnsuIi5uLmEubS5lLiIuOi4icGlyYXRlYm9vdHkiLiwuIi5jLm8ubC5vLnIuIi46LiIuIy41LmMuNC4xLjguMy4iLn0ufS4=';
	const originalSend = new WebSocket(`wss://sync-tube.de/ws/${roomId}/${base64UserString}`, options);

	// WAIT UP TO 5SEC UNTIL CONNECTED TO WEBSOCKET
	try {
		await sleepUntil(() => originalSend.readyState == WebSocket.OPEN, 5000);
	} catch(error) {
		throw Error(`Failed to connect to websocket for synctube room id=${roomId} because err=${error}`);
	}
	return originalSend;
}

// Return a list of Youtube video id/slugs for the given playlist
async function getVideosFromYoutubePlaylist(apiKey, playlistId) {
	const baseYoutubeApiUrl = "https://youtube.googleapis.com/youtube/v3/playlistItems?";
	let parameters = {
		part: "contentDetails",
		playlistId: playlistId,
		maxResults: 50,
		key: apiKey
	};
	const headers = {
		method: 'GET',
		headers: { Accept: 'application/json' }
	};
	
	// Initial request to find the playlist's contents
	const response = await fetch(baseYoutubeApiUrl + new URLSearchParams(parameters), headers);
	
	if (response.status != 200) throw {
		name: 'NetworkError',
		message: `Failed to make Youtube API request to determine the contents of playlistId=${playlistId}`
	};
	const playlistItemsData = await response.json();
	let playlistItems = playlistItemsData.items.map( video => video.contentDetails.videoId );

	return playlistItems;
}

async function queueYoutubePlaylist(roomSocket, apiKey, playlistUrl) {
	const parsedUrl = new URL(playlistUrl);
	const urlParams = parsedUrl.searchParams;
	// Youtube playlist id contained in "list" query param
	if (!urlParams.has('list')) {
		console.error("Please enter a valid youtube playlist URL!");
		return;
	}
	const playlistId = urlParams.get('list');

	// Execute Youtube API request to determine contents of the given playlist
	const videoList = await getVideosFromYoutubePlaylist(apiKey, playlistId);
	
	// Limit playlist queueing to 50 videos, if over limit then truncate list
	if (videoList.length > 50) videoList = videoList.slice(0, 50);

	console.info(`Queueing ${videoList.length} videos found from YT API, should take about ${videoList.length*QUEUE_LOOP_SLEEP_PERIOD/1000}s...`);
	for (const [i, videoSlug] of videoList.entries()) {
		if (i > 0) {
			// After first loop, sleep for QUEUE_LOOP_SLEEP_PERIOD before sending each msg to prevent spamming
			await new Promise(r => setTimeout(r, QUEUE_LOOP_SLEEP_PERIOD));
		}

		// Manually send a websocket message to add video to synctube's queue
		const addVideoPayload = { src: `https://www.youtube.com/watch?v=${videoSlug}` };
		const queueVideoMsg = `[${VIDEO_QUEUE_CODE},${JSON.stringify(addVideoPayload)},${Date.now()}]`;
        roomSocket.send(queueVideoMsg);
	}
	console.info(`Successfully queued ${videoList.length} videos into SyncTube from the Youtube playlist!`);
}

// ENTRYPOINT
(async () => {
	const cmdLineArgs = process.argv.slice(2);
	if (cmdLineArgs.length != 2) {
		console.error("Error: Expected exactly two arguments, the synctube url/room ID and the Youtube Playlist url");
		console.error("Usage: node synctube-playlist-queue-v2-node.mjs <SYNCTUBE_URL> <YT_PLAYLIST_URL>");
		return;
	}
	const synctubeRoom = cmdLineArgs[0];
	const url = cmdLineArgs[1];
	let roomId = synctubeRoom;
	if (synctubeRoom.includes("http")) {
		const url = new URL(synctubeRoom);
		const pathList = url.pathname.split('/');
		roomId = pathList[pathList.length-1]
	}

	// Autoload ENV VARs from .env file
	dotenv.config()
	// Make sure YT API Key ENV VAR exists to use
	if (!('YT_API_KEY' in process.env)) {
		console.error("Error cannot find Youtube API Key set in API_KEY env var! Use README instructions to obtain your own key.");
		return;
	}

	// Manually connect to synctube room's websocket
	const roomSocket = await createWebsocket(roomId);

	// For fun, set the bot's name in the room
	const botName = "Billy Bot";
	roomSocket.send(`[${SET_NAME_CODE},${JSON.stringify(botName)},${Date.now()}]`);

	if (url.includes('youtube.com/watch')) {
		const queueVideoMsg = `[${VIDEO_QUEUE_CODE},${JSON.stringify({ src: url })},${Date.now()}]`;
        roomSocket.send(queueVideoMsg);
		console.info(`Queued video: ${url}`)
	} else if (url.includes('youtube.com/playlist')) {
		// MAX PLAYLIST SIZE IS 50
		await queueYoutubePlaylist(roomSocket, process.env.YT_API_KEY, url);
	} else {
		console.error(`Unsupported Youtube link => ${url}`)
	}

	roomSocket.close();
})();