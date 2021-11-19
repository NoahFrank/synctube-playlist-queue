// Store a reference to each websocket that is actively sending messages in window.sockets
// Source: https://stackoverflow.com/questions/59915987/get-active-websockets-of-a-website-possible
function setupWebsocketSendOverride() {
	const originalSend = WebSocket.prototype.send;
	window.sockets = [];
	WebSocket.prototype.send = function(...args) {
		if (window.sockets.indexOf(this) === -1)
			window.sockets.push(this);
		return originalSend.call(this, ...args);
	};

	return window.sockets;
}

function getUrlParams(url) {
    const hashes = url.slice(url.indexOf('?') + 1).split('&')
    const params = {}
    hashes.map(hash => {
        const [key, val] = hash.split('=')
        params[key] = decodeURIComponent(val)
    })
    return params
}

// Return a list of Youtube video id/slugs for the given playlist
// TODO: Recursive solution makes more sense with the "next page" requests
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
		headers: { 'Accept': 'application/json' }
	};
	
	// Initial request to find the playlist's contents
	const response = await fetch(baseYoutubeApiUrl + new URLSearchParams(parameters), headers);
	if (response.status != 200) throw {
		name: 'NetworkError',
		message: `Failed to make Youtube API request to determine the contents of playlistId=${playlistId}`
	};
	const playlistItemsData = await response.json();
	let playlistItems = playlistItemsData.items.map( video => video.contentDetails.videoId );

	// Repeat the same request with the next page token until we have the entire playlist contents
	let hasMorePages = "nextPageToken" in playlistItemsData;
	let nextPageToken = playlistItemsData.nextPageToken;
	while (hasMorePages) {
		parameters['pageToken'] = nextPageToken;

		const nextPageResponse = await fetch(baseYoutubeApiUrl + new URLSearchParams(parameters), headers);
		if (response.status != 200) throw {
			name: 'NetworkError',
			message: `Failed to make Youtube API request to determine the contents of playlistId=${playlistId}`
		};
		const nextPagePlaylistItemsData = await nextPageResponse.json();
		const nextPagePlaylistItems = nextPagePlaylistItemsData.items.map( video => video.contentDetails.videoId );
		playlistItems = playlistItems.concat(nextPagePlaylistItems);

		// TODO: Implement failsafe, maximum of 3 calls for maxResults=50 otherwise we have an issue or very long playlist (not supported)
		hasMorePages = "nextPageToken" in playlistItemsData;
		if (hasMorePages)
			nextPageToken = playlistItemsData.nextPageToken;
	}

	return playlistItems;
}

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

async function queueYoutubePlaylist(apiKey, playlistUrl) {
	// Override websocket send func to capture reference to active websockets
	let sockets = setupWebsocketSendOverride();

	const urlParams = getUrlParams(playlistUrl);
	// Youtube playlist id contained in "list" query param
	if (!("list" in urlParams)) {
		console.log("Please enter a valid youtube playlist URL!");
		return;
	}
	const playlistId = urlParams.list;

	// Execute Youtube API request to determine contents of the given playlist
	const videoList = await getVideosFromYoutubePlaylist(apiKey, playlistId);

	// Conditional sleep until we have an active websocket recorded, timeout if longer than 4 seconds
	// Assumes synctube only opens a single websocket for a room you are in
	try {
		await sleepUntil(() => sockets.length == 1, 4000);
	} catch(timeoutError) {
		console.error("Failed to find room's active websocket");
		return;
	}

	let roomSocket = sockets[0];
	for (const [i, videoSlug] of videoList.entries()) {
		if (i > 0) {
			// After first loop, sleep for 100ms before sending each msg to prevent spamming
			await new Promise(r => setTimeout(r, 100));
		}

		// Manually send a websocket message to add video to synctube's queue
		const addVideoMsgType = "addVideo";
		const addVideoPayload = { id: videoSlug };
		roomSocket.send(addVideoMsgType + JSON.stringify(addVideoPayload));
	}
	console.log(`Successfully queued ${videoList.length} videos into SyncTube from the Youtube playlist!`);
}