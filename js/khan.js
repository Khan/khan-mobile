var data,
	playlists = {},
	videos = {},
	videoStatus = {},
	query = {},
	queryProcess = {},
	queryWatch = {},
	lastPlayhead = {},
	pendingSeek, // http://adamernst.com/post/6570213273/seeking-an-html5-video-player-on-the-ipad
	curVideoId,
	videoStats,
	offline = false,
	oauth = { consumerKey: "", consumerSecret: "", token: "", tokenSecret: "" };

// Load in query string from URL
updateQuery( window.location.search.substring(1) );

// Temporarily disable loading of pages based upon URL
// TODO: Make this relevant, possibly delay loading of jQuery Mobile until
//       the data has been loaded from the server.
if ( query.sidebar !== "no" ) {
	$.mobile.hashListeningEnabled = false;

	$(function() {
		// Pull in all the playlist and video data
		$.getJSON( "http://www.khanacademy.org/api/videolibrary?callback=?", function( result ) {
			// Load the playlist data for later use
			loadPlaylists( result );
		
			// Inject the markup for the playlists into the site
			var content = $("#playlists-content")
				.html( tmpl( "playlists-tmpl", { playlists: data } ) );
		
			// Only turn on the custom scrolling logic if we're on a touch device
			if ( $.support.touch ) {
				// We need to enable it explicitly for the playlists
				// as we're loading it dynamically
				content.scrollview({ direction: "y" });
			}
		});
		
		$(".save").hide(); // Can't save offline if you're not in native app
	});

} else {
	$(function() {
		// We're not showing the sidebar or doing the splitview
		$("html").removeClass("splitview").addClass("no-sidebar");
		$("#menu").remove();
		
		// Assume that we're on an iPad, or similar, so disable scrolling
		$(document).bind( "touchmove", false );
		
		// Remove the extra main panel
		$("#main > div").unwrap();
		
		// Unwrap breaks the video tag on iPad (bug). Fix it.
		$("video").replaceWith(function() {
			return $(this).clone();
		});
		
		// Set the active page to the current page
		$.mobile.activePage = $("#home");
		
		// Watch for when playlist data is passed in
		// load the data for later usage
		addQueryProcess( "playlist", function( json ) {
			// Load the playlist data for later use
			var playlist = JSON.parse( json );
			loadPlaylists( [ playlist ] );
			return playlist;
		});
		
		// When a video is triggered, display it
		addQueryWatch( "video", setCurrentVideo );
		
		// Information about a video being downloaded
		addQueryWatch( "video_status", function( json ) {
			var updatedVideos = JSON.parse( json );
			
			// Merge into videoStatus
			$.extend( videoStatus, updatedVideos );
			
			// If the video is currently being played, update its status
			if ( updatedVideos[ curVideoId ] ) {
				updateStatus();
			}
			
			// Update point display
			updatePoints( updatedVideos.user_video && updatedVideos.user_video.video.youtube_id, updatedVideos );
		});
		
		// Turn on/off logging
		addQueryWatch( "log", function( value ) {
			$(".log").toggle( value === "yes" );
		});
		
		// Handle swapping between online/offline mode
		addQueryWatch( "offline", function( value ) {
			offline = value === "yes";
			
			// Sync with the server, if we can
			offlineSync();
		});
		
		// Toggle the video playing
		addQueryWatch( "playing", function( value ) {
			$("video")[0][ value === "no" ? "pause" : "play" ]();
		});
		
		// Handle OAuth-related matters
		addQueryWatch( "oauth", function( value ) {
			var parts = value.split(",");
			oauth.token = parts[0];
			oauth.tokenSecret = parts[1];
			
			// Sync with the server on load
			offlineSync();
		});
		
		addQueryWatch( "oauth_consumer", function( value ) {
			var parts = value.split(",");
			oauth.consumerKey = parts[0];
			oauth.consumerSecret = parts[1];
			
			// Sync with the server on load
			offlineSync();
		});
		
		// Watch for the Save/Download button being clicked
		$(".save").bind( "vclick", function() {
			// Disable the button (to indicate that it's downloading)
			$(this).addClass( "ui-disabled" );
			
			// Tell the app to start downloading the file
			updateNativeHost( "download=" + curVideoId );
		});
		
		// Watch for the Share button being clicked
		$(".share").bind( "vclick", function() {
			// Collect the dimensions of the button
			// (Makes it easier to position the share information)
			var location = $(this).offset();
			location.width = $(this).width();
			location.height = $(this).height();
			
			// Notify the app about what video should be shared and
			// where to position the overlay
			updateNativeHost( "share=" + curVideoId +
				"&share_location=" + encodeURIComponent(JSON.stringify(location)) );
		});
		
		// Notify the app when the user hits play
		$( "video" ).bind( "play", function() {
			updateNativeHost( "playing=yes" );
		
		// Notify the app when the user hits pause
		}).bind( "pause", function() {
			updateNativeHost( "playing=no" );
		
		// Handle when an error occurs loading the video
		}).bind("error", function(e) {
			log("error " + e.target.error.code, true);
			
			// Cancel any pending seeks since the video is broken
			pendingSeek = null;
			
			// Hide the video
			$(this).hide();
			
			// Hide the loading overlay
			$(".loading").hide();
			
			// Show an error message
			showError( "Network Error", "Try downloading videos for offline viewing." );
		
		// Log all the video events
		}).bind( "loadstart progress suspend abort emptied stalled loadedmetadata loadeddata canplay canplaythrough playing waiting seeking seeked ended durationchange play pause ratechange" , function(ev){ 
			log(ev.type, true);
		
		// Try to jump to a seeked position in a video
		}).bind( "loadstart progress stalled loadedmetadata loadeddata canplay canplaythrough playing waiting durationchange" , function() {
			// If we have a pending seek and the position we want is seekable
			if ( pendingSeek !== null && isSeekable( this.seekable ) ) {
				// Copy to a local variable, in case setting currentTime triggers further events.
				try {
					var seekTo = pendingSeek;
					pendingSeek = null;
					this.currentTime = seekTo;
				
				// Sometimes setting the currentTime fails out, we can try again on a later event
				} catch( e ) {
					pendingSeek = seekTo;
				}
			}
		
		// Remember the last position of the video, for resuming later on
		}).bind( "timeupdate", function() {
			// Store seek position offline
			if ( window.localStorage ) {
				window.localStorage[ "seek:" + curVideoId ] = this.currentTime;
				
			} else {
				lastPlayhead[ curVideoId ] = this.currentTime;
			}
		
		// Show a loading message while the video is loading
		}).bind( "loadstart", function() {
			$(".loading").show();
		
		// Hide the loading message once we get an indicator that loading is complete
		}).bind( "suspend progress stalled loadedmetadata loadeddata canplay playing", function() {
			$(".loading").hide();
			
			$(videoStatus).trigger( "playerready" );
		});

		$(window)
			// Make sure the video container is the right size ratio
			.resize(function() {
				$(".video-wrap").height( $(window).width() / 16.0 * 9.0 );
			})
			// Also update immediately
			.resize();
	});
}

// Watch for clicks on playlists in the main Playlist menu
$(document).delegate( "#playlists a", "mousedown", function() {
	// Grab the Youtube ID for the playlist
	var id = this.href.substr( this.href.indexOf("#list-") + 6 );

	// Generated page already exists
	if ( $("#list-" + id).length ) {
		return;
	}
	
	// If we found it, add it to the page
	if ( playlists[ id ] ) {
		$( tmpl( "playlist-tmpl", playlists[ id ] ) )
			.appendTo( "#menu" )
			.page();
	}
});

// Watch for clicks on videos in a playlist meny
$(document).delegate( "ul.playlist a", "mousedown", function() {
	// Grab the Youtube ID for the video and generate the page
	setCurrentVideo( this.href.substr( this.href.indexOf("#video-") + 7 ) );
});

// Query String Parser
// Original from:
// http://stackoverflow.com/questions/901115/get-querystring-values-in-javascript/2880929#2880929
function updateQuery( q ) {
	var e,
		a = /\+/g,  // Regex for replacing addition symbol with a space
		r = /([^&=]+)=?([^&]*)/g,
		d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
		name,
		value,
		added = {};

	while ( (e = r.exec(q)) ) {
		name = d(e[1]);
		value = d(e[2]);
		
		added[ name ] = query[ name ] = queryProcess[ name ] ? 
			queryProcess[ name ]( value ) :
			value;
	}
	
	for ( name in added ) {
		if ( queryWatch[ name ] ) {
			queryWatch[ name ]( added[ name ] );
		}
	}
	
	return true;
}

function addQueryProcess( name, fn ) {
	queryProcess[ name ] = fn;
	
	if ( query[ name ] ) {
		query[ name ] = queryProcess[ name ]( query[ name ] );
	}
}

function addQueryWatch( name, fn ) {
	queryWatch[ name ] = fn;
	
	if ( query[ name ] ) {
		queryWatch[ name ]( query[ name ] );
	}
}

function loadPlaylists( result ) {
	// Sort the playlists by name
	// XXX: Why aren't they sorted now?
	data = result.sort(function( a, b ) {
		return a.title > b.title ? 1 : -1;
	});

	// Build up an index of the playlists for fast reference
	for ( var p = 0, pl = data.length; p < pl; p++ ) {
		if ( !data[p].youtube_id ) {
			data[p].youtube_id = data[p].title;
		}
		
		playlists[ data[p].youtube_id ] = data[p];

		// Do the same thing for the videos
		var vids = data[p].videos;

		if ( vids ) {
			for ( var v = 0, vl = vids.length; v < vl; v++ ) {
				videos[ vids[v].youtube_id ] = vids[v];
			}
		}
	}
}

// Notify the app that something has occurred
function updateNativeHost( query ) {
	window.location = "khan://update?" + query;
}

// Display a video given the specified ID
function setCurrentVideo( id ) {
	// Bail if we're already displaying it
	if ( curVideoId === id ) {
		return;
	}
	
	var player = $("video")[0],
		video = videos[ id ],
		status = videoStatus[ id ];
	
	// Pause the existing video before loading the new one
	if ( !player.paused ) {
		player.pause();
	}
	
	// Remember the ID of the video that we're playing
	curVideoId = id;
	
	// Show the points display
	if ( oauth.token && oauth.consumerKey ) {
		updatePoints( id, { user_video: { points: 0 } } );
	
	// Hide the display if the user isn't logged in
	} else {
		$(".energy-points-badge").hide();
	}
	
	// Hook in video tracking
	videoStats = new VideoStats( id, player );
	videoStats.prepareVideoPlayer();
	videoStats.startLoggingProgress();
	
	// Get the video file URL to play
	var url = status && status.download_status && status.download_status.offline_url ||
		video.download_urls && video.download_urls.mp4 || null;
	
	// If a file was found, play it
	if ( url ) {
		// Load it into the player
		// Note: we re-use the existing player to save on resources
		player.src = url;
		
		// Get the cached seek position, if one exists
		// Check the offline cache as well
		pendingSeek = window.localStorage && parseFloat( window.localStorage[ "seek:" + id ] ) || lastPlayhead[id] || null;
		
		// Make sure the player is displayed
		$(player).show();
		
		// Hide any displayed error messages
		hideError();
		
		// Show a loading message
		$(".loading").show();
		
		// And start loading the video
		player.load();
	
	// If no valid video file was found
	} else {
		// Hide the video player
		$(player).hide();
		
		// Hide the loading indicator
		$(".loading").hide();
		
		// Display an error message
		showError( "Video Not Yet Available", "Try again in a few hours." );
	}
	
	// Display information about the video
	$(".below-video")
		.find("h1").text( video[ "title" ] ).end()
		.find("p").text( video[ "description" ] );
	
	// Update the download indicator
	updateStatus();
}

// Update the indicator of how downloads are going
function updateStatus() {
	var status = videoStatus[ curVideoId ],
		video = videos[ curVideoId ],
		downloadStatus = status && status.download_status,
		disable = false;
	
	// Disable if downloading or downloaded
	// Or if there's no video to download
	if ( downloadStatus || !(video.download_urls && video.download_urls.mp4) ) {
		disable = true;
	}

	// Only let them download if a downloadable version exists
	$(".save")
		.toggleClass( "ui-disabled", disable )
		
		// Show the status of the file download
		.find(".ui-btn-text").text( downloadStatus ?
				downloadStatus.offline_url ?
					"Downloaded" :
					"Downloading... (" + Math.round(downloadStatus.download_progress * 100) + "%)" :
				"Download" );
}

// Check to see if a pending seek is able to be resumed
function isSeekable( seekableRanges ) {
	for ( var i = 0, l = seekableRanges.length; i < l; i++ ) {
		if ( seekableRanges.start(i) <= pendingSeek && pendingSeek <= seekableRanges.end(i) ) {
			return true;
		}
	}
	
	return false;
}

// Show an error message to the user
function showError( title, msg ) {
	// Show the error message overlay
	var details = $(".error").show()
		// Set the text of the error message
		.find("h2").text( title ).end()
		.find("p").text( msg ).end()
		.find(".details");
	
	// You can't immediately animate an object that's just been shown.
	// http://www.greywyvern.com/?post=337
	// If you can find a better way, please do.
	setTimeout(function() {
		details.css( "opacity", 1 );
	}, 1);
}

// Hide the error message dialog
function hideError() {
	$(".error").hide()
		
		// Reset the opacity of the details
		// (for the CSS animation)
		.find(".details").css( "opacity", 0 );
}

// Update point display
function updatePoints( id, data ) {
	if ( curVideoId === id ) {
		try {
			$(".energy-points-badge").show().text( data.user_video.points + " of 750" );
		} catch(e) {
			$(".energy-points-badge").hide();
		}
	}
}

// Log out details to the screen
function log( msg, states ) {
	var video = $("video")[0];
	
	if ( states ) {
		msg += " (readyState " + video.readyState + ", networkState " + video.networkState + ", currentTime " + video.currentTime + ")";
	}
	
	$(".log").prepend("<li>" + msg + "</li>");
}