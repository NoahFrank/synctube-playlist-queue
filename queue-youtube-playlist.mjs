import WebSocket from "ws";
import fetch from "node-fetch";
import dotenv from "dotenv";
import readline from 'readline';

// CONSTANTS
const QUEUE_LOOP_SLEEP_PERIOD = 200; // In milliseconds
// Msg type codes for Synctube Websockets
const VIDEO_QUEUE_CODE = 30;
const REMOVE_VIDEO_CODE = 31;
const MOVE_VIDEO_CODE = 32;
const SET_NAME_CODE = 12;

const parseCookies = str =>
	str.split(';')
	.map(v => v.split('='))
	.reduce((acc, v) => {
		const key = v[0].trim();
		const value = v[1] !== undefined && v[1].length > 0 ? v[1].trim() : "";
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

/**
 * Shuffles array in place. ES6 version with Fisher-Yates
 * Source: https://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array
 * @param {Array} a items An array containing the items.
 */
 function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
	return new WebSocket(`wss://sync-tube.de/ws/${roomId}/${base64UserString}`, options);
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

async function queueYoutubePlaylist(roomSocket, apiKey, playlistUrl, isRandomQueueEnabled) {
	const parsedUrl = new URL(playlistUrl);
	const urlParams = parsedUrl.searchParams;
	// Youtube playlist id contained in "list" query param
	if (!urlParams.has('list')) {
		console.error("Please enter a valid youtube playlist URL!");
		return;
	}
	const playlistId = urlParams.get('list');

	// Execute Youtube API request to determine contents of the given playlist
	let videoList = await getVideosFromYoutubePlaylist(apiKey, playlistId);
	
	// Limit playlist queueing to 50 videos, if over limit then truncate list
	if (videoList.length > 50) videoList = videoList.slice(0, 50);

	// If optional randomizing of video order is enabled
	if (isRandomQueueEnabled) {
		videoList = shuffle(videoList);
	}

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

async function handleClearPlaylist(roomId) {
	const roomSocket = await createWebsocket(roomId);
	let playlist = [];
	roomSocket.on('message', (msg) => {
		const msgCode = Number(String(msg)[1]);
		if (msgCode == 0) {
			const truncatedMsg = msg.slice(3, msg.length-1);
			const data = JSON.parse(truncatedMsg);
			playlist = data.playlist.list;
		}
	});

	try {
		await sleepUntil(() => roomSocket.readyState == WebSocket.OPEN, 5000);
	} catch(error) {
		throw Error(`Failed to connect to websocket for synctube room id=${roomId} because err=${error}`);
	}

	if (playlist.length <= 0) {
		throw Error(`Failed to find any videos in the current room playlist(len=${playlist}) to remove!`);
	}
	
	console.info(`Clearing ${playlist.length} videos in Synctube playlist, should take about ${playlist.length*QUEUE_LOOP_SLEEP_PERIOD/1000}s...`);
	for (const [i, video] of playlist.entries()) {
		if (i > 0) {
			// After first loop, sleep for QUEUE_LOOP_SLEEP_PERIOD before sending each msg to prevent spamming
			await new Promise(r => setTimeout(r, QUEUE_LOOP_SLEEP_PERIOD));
		}
		const removeVideoMsg = `[${REMOVE_VIDEO_CODE},${JSON.stringify({id: video.id})}]`;
		roomSocket.send(removeVideoMsg);
		// console.info(`Removed video title=${video.title}, author=${video.author}, src=${video.src}`);
	}

	console.info(`Cleared all videos from playlist of room ID=${roomId}`);
	return roomSocket;
}

// LIST ALL SONGS IN PLAYLIST AND LET USER CHOOSE ONE TO BE MOVED TO TOP!
async function handleMoveToTopOfPlaylist(roomId) {
	const roomSocket = await createWebsocket(roomId);
	let playlist = [];
	roomSocket.on('message', (msg) => {
		const msgCode = Number(String(msg)[1]);
		if (msgCode == 0) {
			const truncatedMsg = msg.slice(3, msg.length-1);
			const data = JSON.parse(truncatedMsg);
			playlist = data.playlist.list;
		}
	});

	try {
		await sleepUntil(() => roomSocket.readyState == WebSocket.OPEN, 5000);
	} catch(error) {
		throw Error(`Failed to connect to websocket for synctube room id=${roomId} because err=${error}`);
	}

	if (playlist.length <= 0) {
		throw Error(`Failed to find any videos in the current room playlist(len=${playlist}) to choose from!`);
	}

	console.log("Select one video to move to top of playlist by number:")
	for (const [i, video] of playlist.entries()) {
		console.log(`${i+1}: ${video.title} - ${video.author}`);
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	rl.question(`Video Number: `, async index => {
		if (index <= 0 || index > playlist.length) {
			throw Error(`${index} is not a valid video number!`);
		}
		const selectedVideo = playlist[index-1];
		if (selectedVideo.id == playlist[0].id) {
			throw Error(`Selected video '${selectedVideo.title}' is already top of the playlist!`);
		}
		console.log(`Moving '${selectedVideo.title}' to top of Synctube playlist, should take about ${playlist.length*QUEUE_LOOP_SLEEP_PERIOD/1000}s...`);
		for (let i = 0; i < index-1; i++) {
			if (i > 0) {
				// After first loop, sleep for QUEUE_LOOP_SLEEP_PERIOD before sending each msg to prevent spamming
				await new Promise(r => setTimeout(r, QUEUE_LOOP_SLEEP_PERIOD));
			}
			const orderVideoMsg = `[${MOVE_VIDEO_CODE},${JSON.stringify({id: selectedVideo.id, dir: 1})}]`;
			roomSocket.send(orderVideoMsg);
		}
		console.log(`Successfully moved '${selectedVideo.title}' to top of Synctube playlist!`);
		
		rl.close();
		roomSocket.close();
	});
}

async function handleYoutubePlaylist(roomId, url, isRandomQueueEnabled) {
	// Manually connect to synctube room's websocket
	const roomSocket = await createWebsocket(roomId);
	
	// WAIT UP TO 5SEC UNTIL CONNECTED TO WEBSOCKET
	try {
		await sleepUntil(() => roomSocket.readyState == WebSocket.OPEN, 5000);
	} catch(error) {
		throw Error(`Failed to connect to websocket for synctube room id=${roomId} because err=${error}`);
	}

	// For fun, set the bot's name in the room
	const botName = "Billy Bot";
	roomSocket.send(`[${SET_NAME_CODE},${JSON.stringify(botName)},${Date.now()}]`);

	if (url.includes('youtube.com/watch')) {
		const queueVideoMsg = `[${VIDEO_QUEUE_CODE},${JSON.stringify({ src: url })},${Date.now()}]`;
		roomSocket.send(queueVideoMsg);
		console.info(`Queued video: ${url}`)
	} else if (url.includes('youtube.com/playlist')) {
		// MAX PLAYLIST SIZE IS 50
		await queueYoutubePlaylist(roomSocket, process.env.YT_API_KEY, url, isRandomQueueEnabled);
	} else {
		console.error(`Unsupported Youtube link => ${url}`);
	}

	return roomSocket;
}

// TODO: SAVE CURRENT PLAYING SONG TO PLAYLIST
// TODO: LOOP CURRENT SONG FOREVER UNTIL PROGRAM STOPPED

// ENTRYPOINT
(async () => {
	const cmdLineArgs = process.argv.slice(2);
	if (cmdLineArgs[0].toLowerCase().replace('-', '') == 'help' ||
			cmdLineArgs.length <= 1 ||
			cmdLineArgs.length > 4)
	{
		if (!cmdLineArgs[0].toLowerCase().includes('help'))
			console.error("Error: Expected 2-4 arguments");
		console.error("Three available commands, 'queue', 'clear', and 'top'");
		console.error("Queue Usage: Add a Youtube Playlist/Video to Synctube, node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> queue <YOUTUBE_URL> [ --random ]");
		console.error("Clear Usage: Remove all videos from Synctube Playlist, node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> clear");
		console.error("Top Usage: Move video to top of Synctube Playlist, node queue-youtube-playlist.mjs <SYNCTUBE_ROOM_OR_URL> top");
		return;
	}

	// Autoload ENV VARs from .env file
	dotenv.config()
	// Make sure YT API Key ENV VAR exists to use
	if (!('YT_API_KEY' in process.env)) {
		console.error("Error cannot find Youtube API Key set in API_KEY env var! Use README instructions to obtain your own key.");
		return;
	}

	// Parse and act on cmd line arguments
	const synctubeRoom = cmdLineArgs[0];
	let roomId = synctubeRoom;
	if (synctubeRoom.includes("http")) {
		const url = new URL(synctubeRoom);
		const pathList = url.pathname.split('/');
		roomId = pathList[pathList.length-1]
	}
	
	let roomSocket = null;
	const cmd = cmdLineArgs[1].toLowerCase();
	if (cmd == "queue") {
		const url = cmdLineArgs[2];
		const isRandomQueueEnabled = cmdLineArgs.length >= 4 && cmdLineArgs[3].toLowerCase().includes("random");
		roomSocket = await handleYoutubePlaylist(roomId, url, isRandomQueueEnabled);
	} else if (cmd == "clear") {
		roomSocket = await handleClearPlaylist(roomId);
	} else if (cmd == "top") {
		await handleMoveToTopOfPlaylist(roomId);
	} else {
		console.error(`Unrecognized command ${cmd}, see help menu (call with --help)!`)
	}

	// Close connection to websocket
	if (roomSocket != null) roomSocket.close();
})();