var data,
	playlists = {},
	videos = {},
	videoStatus = {},
	query = {},
	queryProcess = {},
	queryWatch = {},
	lastPlayhead = {},
	pendingSeek, // http://adamernst.com/post/6570213273/seeking-an-html5-video-player-on-the-ipad
	seekFn,
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
			seek( this );
		
		// Remember the last position of the video, for resuming later on
		}).bind( "timeupdate", function() {
			// Check to see if we're too close to the end of the video
			var currentTime = this.currentTime + 5 >= this.duration ? 0 : this.currentTime;
 
			// Store seek position offline
			if ( window.localStorage ) {
				window.localStorage[ "seek:" + curVideoId ] = currentTime;
			
			// Remember the position so that we resume the video later
			} else {
				lastPlayhead[ curVideoId ] = currentTime;
			}
		
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
				$(".video-wrap").height( $(window).width() / 16.0 * 9.0 );
			})
			// Also update immediately
			.resize();
		
		setTimeout(function(){
			updateQuery('video=jxA8MffVmPs&oauth_consumer=Pge78dXdqHJLsNWR%2CngpsuP9Vy6HXFpAu&oauth=gxWbavhuuhZa25Cx%2C7aDCqwVLMAHFMByG&playlist=' + encodeURIComponent('{"videos":[{"duration":145,"readable_id":"place-value-1","title":"Place Value 1","description":"U01_L1_T1_we1 Place Value 1","download_urls":{"mp4":"http://www.archive.org/download/KA-youtube-converted/jxA8MffVmPs.mp4","png":"http://www.archive.org/download/KA-youtube-converted/jxA8MffVmPs.png"},"url":"http://www.youtube.com/watch?v=jxA8MffVmPs&feature=youtube_gdata_player","youtube_id":"jxA8MffVmPs","ka_url":"http://www.khanacademy.org/video/place-value-1","subtitles":[{"text":"Find the place value of 3 in 4,356.","start_time":0.63,"subtitle_id":"5234826701633","sub_order":2,"end_time":6.73},{"text":"Now, whenever I think about place value, and the more you","start_time":6.73,"subtitle_id":"3111214604505","sub_order":3,"end_time":9.19},{"text":"do practice problems on this it\'ll become a little bit of","start_time":9.19,"subtitle_id":"3113891227247","sub_order":4,"end_time":11.72},{"text":"second nature, but whenever I see a problem like this, I","start_time":11.72,"subtitle_id":"5860105701525","sub_order":5,"end_time":14.6},{"text":"like to expand out what 4,356 really is, so let me rewrite","start_time":14.6,"subtitle_id":"7064799964137","sub_order":6,"end_time":20.32},{"text":"the number.","start_time":20.32,"subtitle_id":"8851016294167","sub_order":7,"end_time":20.88},{"text":"So if I were to write it-- and I\'ll write it","start_time":20.88,"subtitle_id":"9247741964008","sub_order":8,"end_time":21.94},{"text":"in different colors.","start_time":21.94,"subtitle_id":"7926446182020","sub_order":9,"end_time":23.21},{"text":"So 4,356 is equal to-- and just think about","start_time":23.21,"subtitle_id":"9912513489729","sub_order":10,"end_time":33.42},{"text":"how I just said it.","start_time":33.42,"subtitle_id":"2473116629245","sub_order":11,"end_time":34.36},{"text":"It is equal to 4,000 plus 300 plus 50 plus 6.","start_time":34.36,"subtitle_id":"8043375463592","sub_order":12,"end_time":48.19},{"text":"And you could come up with that just based on how we said","start_time":48.19,"subtitle_id":"9830235933204","sub_order":13,"end_time":50.6},{"text":"it: four thousand, three hundred, and fifty-six.","start_time":50.6,"subtitle_id":"9285940435286","sub_order":14,"end_time":54.81},{"text":"Now another way to think about this is this is just like","start_time":54.81,"subtitle_id":"7049222510846","sub_order":15,"end_time":58.06},{"text":"saying this is 4 thousands plus-- or you could even think","start_time":58.06,"subtitle_id":"5950143664027","sub_order":16,"end_time":67.52},{"text":"of \\"and\\"-- so plus 3 hundreds plus 50, you could think of it","start_time":67.52,"subtitle_id":"6235311374424","sub_order":17,"end_time":76.88},{"text":"as 5 tens plus 6.","start_time":76.88,"subtitle_id":"3235306379101","sub_order":18,"end_time":82.04},{"text":"And instead of 6, we could say plus 6 ones.","start_time":82.04,"subtitle_id":"3218754620024","sub_order":19,"end_time":84.42},{"text":"","start_time":84.42,"subtitle_id":"1141854383365","sub_order":20,"end_time":87.57},{"text":"And so if we go back to the original number 4,356, this is","start_time":87.57,"subtitle_id":"9020825385492","sub_order":21,"end_time":92.62},{"text":"the same thing as 4-- I\'ll write it down.","start_time":92.62,"subtitle_id":"5044095117813","sub_order":22,"end_time":96.44},{"text":"Let me see how well I can-- I\'ll write it up like this.","start_time":96.44,"subtitle_id":"9060246974036","sub_order":23,"end_time":99.23},{"text":"This is the same thing is 4 thousands, 3 hundreds, 5 tens","start_time":99.23,"subtitle_id":"7372162861288","sub_order":24,"end_time":111.02},{"text":"and then 6 ones.","start_time":111.02,"subtitle_id":"976749270599","sub_order":25,"end_time":113.67},{"text":"So when they ask what is the place value of 3 into 4,356,","start_time":113.67,"subtitle_id":"5198089135308","sub_order":26,"end_time":119.82},{"text":"we\'re concerned with this 3 right here,","start_time":119.82,"subtitle_id":"4916492209319","sub_order":27,"end_time":122.12},{"text":"and it\'s place value.","start_time":122.12,"subtitle_id":"4454928528802","sub_order":28,"end_time":123.26},{"text":"It\'s in the hundreds place.","start_time":123.26,"subtitle_id":"2168870553935","sub_order":29,"end_time":125.09},{"text":"If there was a 4 here, that would mean we\'re dealing with","start_time":125.09,"subtitle_id":"4854865404398","sub_order":30,"end_time":126.97},{"text":"4 hundreds.","start_time":126.97,"subtitle_id":"8560594646007","sub_order":31,"end_time":127.85},{"text":"If there\'s a 5, 5 hundreds.","start_time":127.85,"subtitle_id":"9929011756802","sub_order":32,"end_time":129.85},{"text":"It\'s the third from the right.","start_time":129.85,"subtitle_id":"2302517547133","sub_order":33,"end_time":132.26},{"text":"This is the ones place.","start_time":132.26,"subtitle_id":"3999450355229","sub_order":34,"end_time":133.41},{"text":"That\'s 6 ones, 5 tens, 3 hundreds.","start_time":133.41,"subtitle_id":"206969347787","sub_order":35,"end_time":136.5},{"text":"So the answer here is it is in the hundreds place.","start_time":136.5,"subtitle_id":"3196781322597","sub_order":36,"end_time":140.19}],"playlists":["Developmental Math"],"date_added":"2011-02-20T16:39:02","kind":"Video","views":59691,"position":1,"keywords":"U01_L1_T1_we1, Place, Value"},{"duration":249,"readable_id":"place-value-2","title":"Place Value 2","description":"U01_L1_T1_we2 Place Value 2","download_urls":{"mp4":"http://www.archive.org/download/KA-youtube-converted/wd4cRAoBOiE.mp4","png":"http://www.archive.org/download/KA-youtube-converted/wd4cRAoBOiE.png"},"url":"http://www.youtube.com/watch?v=wd4cRAoBOiE&feature=youtube_gdata_player","youtube_id":"wd4cRAoBOiE","ka_url":"http://www.khanacademy.org/video/place-value-2","playlists":["Developmental Math"],"date_added":"2011-02-20T16:39:02","kind":"Video","views":18077,"position":2,"keywords":"U01_L1_T1_we2, Place, Value"},{"duration":320,"readable_id":"place-value-3","title":"Place Value 3","description":"U01_L1_T1_we3 Place Value 3","download_urls":{"mp4":"http://www.archive.org/download/KA-youtube-converted/iK0y39rjBgQ.mp4","png":"http://www.archive.org/download/KA-youtube-converted/iK0y39rjBgQ.png"},"url":"http://www.youtube.com/watch?v=iK0y39rjBgQ&feature=youtube_gdata_player","youtube_id":"iK0y39rjBgQ","ka_url":"http://www.khanacademy.org/video/place-value-3","playlists":["Developmental Math"],"date_added":"2011-02-20T16:39:02","kind":"Video","views":13809,"position":3,"keywords":"U01_L1_T1_we3, Place, Value"}],"title":"Developmental Math","description":"Worked developmental math examples from the Monterey Institute.  These start pretty basic and would prepare a student for the Algebra I worked examples"}'));
		}, 1000);
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
	if ( window.location.protocol.indexOf( "http" ) !== 0 ) {
		window.location = "khan://update?" + query;
	}
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
	
	if ( !video ) {
		return;
	}
	
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
	
	// Show or hide the interactive subtitles
	var subtitles = $(".subtitles").toggle( !!video.subtitles );
	
	// If they exist, display them
	if ( video.subtitles ) {
		subtitles.html( tmpl( "subtitles-tmpl", video ) );
		
		// Watch for clicks on subtitles
		// We need to bind directly to the list items so that
		// the event fires before it hits the scrollview
		subtitles.find("a").bind("click", function( e ) {
			// Stop from visiting the link
			e.preventDefault();
			
			// Grab the time to jump to from the subtitle
			pendingSeek = parseFloat( $(e.target).parent().data( "time" ) );
			
			// Jump to that portion of the video
			var video = $("video")[0];
			seek( video );
			
			// Start playing the video, if we haven't done so already
			seekFn = function() {
				if ( video.paused ) {
					video.play();
				}
			};
		});
		
		// Get the subtitles and hilite the first one
		var li = subtitles.find("li"),
			curLI = li.eq(0).addClass("active")[0],
			doJump = true;
		
		// Continually update the active subtitle position
		setInterval(function() {
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
		
		function subtitleJump( nextLI ) {
			if ( nextLI !== curLI ) {
				$(nextLI).addClass("active");
				$(curLI).removeClass("active");
				curLI = nextLI;

				subtitles.animate( { scrollTop: Math.max( curLI.offsetTop - 45, 0 ) }, 200 );
			}
		}
		
		// Only turn on the custom scrolling logic if we're on a touch device
		if ( $.support.touch && !subtitles.hasClass("ui-scrollview-clip") ) {
			// We need to enable it explicitly for the subtitles
			// as we're loading it dynamically
			subtitles
				.scrollview({ direction: "y" })
				.bind( "scrollstart", function() {
					doJump = false;
				})
				.bind( "scrollstop", function() {
					doJump = true;
				});
		}
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

// Log out details to the screen
function log( msg, states ) {
	var video = $("video")[0];
	
	if ( states ) {
		msg += " (readyState " + video.readyState + ", networkState " + video.networkState + ", currentTime " + video.currentTime + ")";
	}
	
	$(".log").prepend("<li>" + msg + "</li>");
}

function pad( num ) {
	return num < 10 ? "0" + num : num;
}