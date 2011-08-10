var data,
	playlists = {},
	videos = {},
	videoStatus = {},
	query = {},
	queryProcess = {},
	queryWatch = {},
	storage = { seek: {}, watch: {} },
	pendingSeek, // http://adamernst.com/post/6570213273/seeking-an-html5-video-player-on-the-ipad
	seekFn,
	curVideoId,
	nextVideoId,
	subInterval,
	doJump = true,
	scrollResume,
	scrollingProgrammatically = false,
	videoStats,
	offline = false,
	userId,
	nativeIframes = [],
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
		
		// Remove the extra main panel
		$("#main > div").unwrap();
		
		// Unwrap breaks the video tag on iPad (bug). Fix it.
		$("video").replaceWith(function() {
			return $(this).clone();
		});
		
		// Set the active page to the current page
		$.mobile.activePage = $("#home");
		
		// Handle OAuth-related matters
		addQueryWatch( "user", function( value ) {
			// User has logged in
			if ( value ) {
				var user = JSON.parse( value );
				
				var parts = user.token.split(",");
				oauth.token = parts[0];
				oauth.tokenSecret = parts[1];
				
				// Get user ID
				userId = user.user_data.user;
				
				// Get the user storage
				loadStorage();
			
			// User is logging out
			} else {
				oauth.token = oauth.tokenSecret = "";
				userId = null;
				videoStatus = {};
				
				// Reset the storage object
				loadStorage();
			}
			
			// Sync with the server on load
			offlineSync();
			updatePoints();
		});
		
		addQueryWatch( "oauth_consumer", function( value ) {
			var parts = value.split(",");
			oauth.consumerKey = parts[0];
			oauth.consumerSecret = parts[1];
			
			// Sync with the server on load
			offlineSync();
		});
		
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
			
			// If the video is currently being played, update its status and points
			var curVideoStatus = updatedVideos[ curVideoId ];
			if ( curVideoStatus ) {
				updateStatus();
				updatePoints();
			}
		});
		
		// Turn on/off logging
		addQueryWatch( "log", function( value ) {
			$(".log").toggle( value === "yes" );
		});
		
		// Handle swapping between online/offline mode
		addQueryWatch( "offline", function( value ) {
			offline = value === "yes";
			
			// Toggle a global offline class for tweaking style
			$("html").toggleClass( "offline", offline );
			
			// Sync with the server, if we can
			offlineSync();
		});
		
		// Toggle the video playing
		addQueryWatch( "playing", function( value ) {
			$("video")[0][ value === "no" ? "pause" : "play" ]();
		});
		
		// Watch for the Save/Download button being clicked
		$(".save").bind( "vclick", function() {
			// Disable the button (to indicate that it's downloading)
			$(this).addClass( "ui-disabled" );
			
			// Tell the app to start downloading the file
			updateNativeHost( {download: curVideoId} );
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
			updateNativeHost( {share: curVideoId, share_location: JSON.stringify(location)} );
		});
		
		// Retry watching a video that has errored out
		$(".retry-button").bind( "vclick", function() {
			// Force re-displaying the current video
			setCurrentVideo( curVideoId, true );
		});
		
		// Allow the user to replay the current video
		$(".replay-button").bind( "vclick", function() {
			hideReplay();
			
			// Start the video over at the beginning
			var video = $("video").show()[0];
			try {
				video.currentTime = 0;
				video.play();
			} catch( e ) {
				// TODO ignore for now
				// This has been shown to throw
				// exceptions (as it is documented to,
				// if called in the wrong state)
			}
		});
		
		// Allow the user to watch the next video
		$(".next-button").bind( "vclick", function() {
			hideReplay();
			
			// Notify the app that we're switching to another video
			updateNativeHost( {video: nextVideoId} );
			
			// Switch to the next video
			setCurrentVideo( nextVideoId );
		});
		
		// Notify the app when the user hits play
		$( "video" ).bind( "play", function() {
			updateNativeHost( {playing: "yes"} );
		
		// Notify the app when the user hits pause
		}).bind( "pause", function() {
			updateNativeHost( {playing: "no"} );
		
		// Watch for when the video ends, to show the replay dialog
		}).bind( "ended", function() {
			// Hide the video gracefully
			var video = $("video").css( "opacity", 0 );

			// Show the replay button when animation is complete
			setTimeout(function() {
				video.hide().css( "opacity", 1 );

				showReplay();
			}, 2000 );
		
		// Handle when an error occurs loading the video
		}).bind("error", function(e) {
			var error = e.target.error;
			log("error " + (error ? error.code : ""), true);
			
			// Cancel any pending seeks since the video is broken
			pendingSeek = null;
			
			// Hide the video
			$(this).hide();
			
			// Hide the loading overlay
			$(".loading").hide();
			
			// Show an error message
			showError( "Network Error", "Try downloading videos for offline viewing." );
		
		// Log all the video events, except progress
		}).bind( "loadstart suspend abort emptied stalled loadedmetadata loadeddata canplay canplaythrough playing waiting seeking seeked ended durationchange play pause ratechange" , function(ev){ 
			log(ev.type, true);
		
		// Try to jump to a seeked position in a video
		}).bind( "loadstart progress stalled loadedmetadata loadeddata canplay canplaythrough playing waiting durationchange" , function() {
			seek( this );
		
		// Remember the last position of the video, for resuming later on
		}).bind( "timeupdate", function() {
			// Check to see if we're too close to the end of the video
			var currentTime = this.currentTime + 5 >= this.duration ? 0 : this.currentTime;
 
			// Remember the video seek position
			storage.seek[ curVideoId ] = currentTime;
			
			// Store seek position offline
			saveStorage();
		
		// Show a loading message while the video is loading
		}).bind( "loadstart", function() {
			$(".loading").show();
		
		// Hide the loading message once we get an indicator that loading is complete
		}).bind( "suspend progress loadedmetadata loadeddata canplay playing", function() {
			$(".loading").hide();
			
			$(videoStatus).trigger( "playerready" );
		});

		$(window)
			// Make sure the video container is the right size ratio
			.resize(function() {
				// Make sure the video is kept to the proper aspect ratio
				$(".video-wrap").height( $(window).width() / 16.0 * 9.0 );
				
				// Adjust the height of the subtitle viewport
				var subtitles = $(".subtitles");
				subtitles.height( $(window).height() - subtitles.offset().top - 14 );

				// Jump to the active subtitle
				subtitles.scrollTo( subtitles.find(".subtitle.active")[0] );
				
				// Show more of the video description if we have enough window height available
				$(".video-description").css("-webkit-line-clamp", $(window).height() > 800 ? "4" : "2" );
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
		added = [];

	while ( (e = r.exec(q)) ) {
		name = d(e[1]);
		value = d(e[2]);
		
		query[ name ] = queryProcess[ name ] ? 
			queryProcess[ name ]( value ) :
			value;
		
		added.push( name );
	}
	
	for ( var i = 0, l = added.length; i < l; i++ ) {
		name = added[i];
		
		if ( queryWatch[ name ] ) {
			log( "updateQuery: " + name );
			queryWatch[ name ]( query[ name ] );
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

function newIframe() {
	return $("<iframe>").appendTo("body").load(function(){
		var f = this;
		setTimeout(function(){
			nativeIframes.push(f);
		}, 100);
	})[0];
}

// Notify the app that something has occurred
function updateNativeHost( update ) {
	if ( window.location.protocol.indexOf( "http" ) !== 0 ) {
		// Setting window.location is a bad idea; see 
		// https://github.com/Khan/khan-mobile/issues/47
		// Instead use iframes, but recycle them to avoid
		// hitting the 1000-frame WebKit cap
		
		var iframe = ( nativeIframes.length ? nativeIframes.pop() : newIframe() );
		iframe.src = "khan://update?" + $.param( update );
	}
}

// Display a video given the specified ID
function setCurrentVideo( id, force ) {
	// Bail if we're already displaying it
	if ( curVideoId === id && !force ) {
		return;
	}
	
	var player = $("video")[0],
		video = videos[ id ],
		status = videoStatus[ id ];
	
	if ( !video ) {
		return;
	}
	
	// Pause the existing video before loading the new one
	if ( !player.paused ) {
		player.pause();
	}
	
	// Remember the ID of the video that we're playing
	curVideoId = id;
	
	// Find the next video to show
	// TODO: Determine which playlist we're current focused on.
	var playlist = playlists[ video.playlists[0] ];
	nextVideoId = playlist && playlist.videos.length > video.position ? playlist.videos[ video.position ].youtube_id : null;
	
	// Show or hide the Next Video button
	$(".next-button").toggle( !!nextVideoId );
	
	// Update the user point display
	updatePoints();
	
	// Start by hiding the subtitles while we're loading
	$(".subtitles").hide();
	$(".subtitles-error").hide();
	
	// Show the loading indicator
	var loading = $(".subtitles-loading").css("opacity", 0).show();
	
	// Fade in the loading indicator
	setTimeout(function() {
		loading.css("opacity", 1);
	}, 1);
	
	// Load in the subtitle data for the video
	$.ajax({
		url: "kasubtitles://" + id + "/",
		dataType: "json",
		success: showSubtitles,
		error: function() {
			// Pass in no arguments to trigger an error
			showSubtitles();
		}
	});
	
	// Hook in video tracking
	if ( videoStats ) {
		videoStats.stopLoggingProgress();
	}

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
		pendingSeek = storage.seek[ id ] || status && status.user_video && status.user_video.last_second_watched || null;
		
		// Prevent subtitles jumping to the end if the video has been watched
		if ( pendingSeek + 5 >= video.duration ) {
			pendingSeek = null;
		}
		
		// Make sure the player is displayed
		$(player).show();
		
		// Hide any displayed error messages and replay overlay
		hideError();
		hideReplay();
		
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
	// For description, use '|| ""' because .text( null ) does nothing
	$(".below-video")
		.find("h1").text( video[ "title" ] ).end()
		.find(".video-description").text( video[ "description" ] || "" );
	
	// Update the download indicator
	updateStatus();
}

function showSubtitles( data ) {
	log( "Subtitles: " + JSON.stringify( data ) );

	// Show or hide the interactive subtitles
	var subtitles = $(".subtitles").toggle( !!(data && data.length) ),
		player = $("video")[0],
		isScroll = subtitles.hasClass("ui-scrollview-clip"),
		subContainer = (isScroll ? subtitles.children("div.ui-scrollview-view") : subtitles);
	
	// Stop updating the old subtitle updater
	clearInterval( subInterval );
	
	// Hide the subtitle loading message
	$(".subtitles-loading").hide();

	// If they don't exist, back out
	// Or if we have a malformed subtitle start time
	if ( !data || !data.length || data[ data.length - 1 ].start_time < 0 ) {
		var error = $(".subtitles-error").css( "opacity", 0 ).show();

		// Fade in the error message
		setTimeout(function() {
			error.css( "opacity", 1 );
		}, 1);
		
		// Fade it out at the end
		setTimeout(function() {
			error.css( "opacity", 0 );
		}, 3000);

		return;
	}

	// Inject the subtitles
	subContainer.html( tmpl( "subtitles-tmpl", { subtitles: data } ) );

	// Make it easier to add some themeing to the subtitle rows
	subContainer.find(".subtitle")
		.first().addClass("first").end()
		.last().addClass("last");
	
	// Watch for clicks on subtitles
	// We need to bind directly to the list items so that
	// the event fires before it hits the scrollview
	subtitles.find("a").bind("click", function( e ) {
		// Stop from visiting the link
		e.preventDefault();

		// Resume scrolling from this position
		doJump = true;
		clearInterval( scrollResume );
		
		// Grab the time to jump to from the subtitle
		pendingSeek = parseFloat( $(e.target).parent().data( "time" ) );
		
		// Start playing the video, if we haven't done so already
		seekFn = function() {
			if ( player.paused ) {
				player.play();
			}
		};
		
		// Jump to that portion of the video
		seek( player );
	});
	
	// Get the subtitles and hilite the first one
	var li = subtitles.find(".subtitle"),
		curLI = li.eq(0).addClass("active")[0];
	
	// Continually update the active subtitle position
	subInterval = setInterval(function() {
		// Get the seek position or the current time
		// (allowing the user to see the transcript while loading)
		// We need to round the number to fix floating point issues
		var curTime = (pendingSeek || player.currentTime).toFixed(2);
		
		for ( var i = 0, l = li.length; i < l; i++ ) {
			var liTime = $(li[i]).data("time");
			
			// We're looking for the next highest element before backtracking
			if ( liTime > curTime && liTime !== curTime ) {
				var nextLI = li[ i - 1 ];
				
				if ( nextLI ) {
					return subtitleJump( nextLI );
				}
			}
		}
		
		// We've reached the end so make the last one active
		subtitleJump( li[ i - 1 ] );
	}, 333);
	
	// Jump to a specific subtitle (either via click or automatically)
	function subtitleJump( nextLI ) {
		if ( nextLI !== curLI ) {
			$(nextLI).addClass("active");
			$(curLI).removeClass("active");
			curLI = nextLI;

			// Adjust the viewport to animate to the new position
			if ( doJump ) {
				subtitles.scrollTo( curLI );
			}
		}
	}
	
	var subtitles = $(".subtitles");
	subtitles.height( $(window).height() - subtitles.offset().top - 14 );

	// Only turn on the custom scrolling logic if we're on a touch device
	if ( $.support.touch ) {
		// Reset to the starting scroll position
		if ( isScroll ) {
			subtitles.scrollTo( 0 );
		
		// We need to enable it explicitly for the subtitles
		// as we're loading it dynamically
		} else {
			if ( typeof subtitles[0].style.webkitOverflowScrolling === "undefined" ) {
				subtitles
					.scrollview({ direction: "y" })
					.bind( "scrollstart", function() {
						clearInterval( scrollResume );

						doJump = false;
					})
					.bind( "scrollstop", function() {
						// Wait 30 seconds before resuming auto-scrolling
						scrollResume = setTimeout(function() {
							doJump = true;
						}, 30000);
					});
			} else {
				subtitles.scroll( function() {
					// A scrollTop animation triggers the scroll event so make sure we're not animating
					if ( !scrollingProgrammatically ) {
						clearInterval( scrollResume );
						doJump = false;

						// Wait 30 seconds before resuming auto-scrolling
						scrollResume = setTimeout(function() {
							doJump = true;
						}, 30000);
					}
				} );
			}
		}
	}
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
					"(" + Math.round(downloadStatus.download_progress * 100) + "%)" :
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
	var player = $("video")[0],
		details = $(".error").show()
			// Set the text of the error message
			.find("h2").text( title ).end()
			.find("p").text( msg ).end()
			.find(".details");
	
	// Force the video to pause, just in case
	if ( !player.paused ) {
		player.pause();
	}
	
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

// Show an replay overlay to the user
function showReplay() {
	// Show the replay overlay
	var player = $("video")[0],
		details = $(".replay").show().find(".details");
	
	// Force the video to pause, just in case
	if ( !player.paused ) {
		player.pause();
	}
	
	// You can't immediately animate an object that's just been shown.
	// http://www.greywyvern.com/?post=337
	// If you can find a better way, please do.
	setTimeout(function() {
		details.css( "opacity", 1 );
	}, 1);
}

// Hide the error message dialog
function hideReplay() {
	$(".replay").hide()
		
		// Reset the opacity of the details
		// (for the CSS animation)
		.find(".details").css( "opacity", 0 );
}

// Update point display
function updatePoints() {
	var curVideoStatus = videoStatus[ curVideoId ];
	log("updatePoints, looked up video status for " + curVideoId);
	if ( oauth.token ) {
		var points = 0;
		if ( curVideoStatus && curVideoStatus.user_video && curVideoStatus.user_video.points ) {
			points = curVideoStatus.user_video.points;
		}
		log("updatePoints, looked up points earned: " + points);
		$(".energy-points-badge").show().text( points + " of 750" );
		
	} else {
		$(".energy-points-badge").hide();
	}
}

// Seek to a specific part of a video
function seek( video ) {
	// If we have a pending seek and the position we want is seekable
	if ( pendingSeek !== null && isSeekable( video.seekable ) ) {
		// Copy to a local variable, in case setting currentTime triggers further events.
		try {
			var seekTo = pendingSeek;
			pendingSeek = null;
			video.currentTime = seekTo;
			
			// Execute the callback if one was specified
			if ( seekFn ) {
				seekFn();
				seekFn = null;
			}
		
		// Sometimes setting the currentTime fails out, we can try again on a later event
		} catch( e ) {
			pendingSeek = seekTo;
		}
	}
}

function loadStorage() {
	storage = JSON.parse( userId && window.localStorage[ userId ] || '{"seek":{},"watch":{}}' );
}

function saveStorage() {
	// Save the data if the user is logged in
	if ( userId ) {
		window.localStorage[ userId ] = JSON.stringify( storage );
	}
}

// Log out details to the screen
function log( msg, states ) {
	var video = $("video")[0];
	
	if ( states ) {
		msg += " (readyState " + video.readyState + ", networkState " + video.networkState + ", currentTime " + video.currentTime + ")";
	}
	
	// Delay display of log to prevent UI from breaking
	setTimeout(function() {
		updateNativeHost({log: msg});
	}, 1);
}

function pad( num ) {
	return num < 10 ? "0" + num : num;
}

jQuery.fn.scrollTo = function( top ) {
	if ( top == null ) {
		return this;
	} else if ( top.offsetTop != null ) {
		top = top.offsetTop;
	}
	
	// Set the positioning to be positioned 45 pixels down
	// (allowing the user to read the two previous lines)
	var pos = Math.max( top - 45, 0 );
	
	// Make sure that we don't end with whitespace at the bottom
	pos = Math.min( this[0].scrollHeight - this[0].offsetHeight, pos );
	
	// Adjust the viewport to animate to the new position
	if ( jQuery.support.touch && this.hasClass("ui-scrollview-clip") ) {
		this.scrollview( "scrollTo", 0, pos, 200 );
	
	} else {
		scrollingProgrammatically = true;
		this.stop().animate( { scrollTop: pos }, {
			duration: 200,
			complete: function() {
				// We seem to get one "scroll" event after complete is called
				// Use a timeout in hopes that this gets run after that happens
				setTimeout( function() { scrollingProgrammatically = false; }, 1 );
			}
		} );
	}
	
	return this;
};
