var data,
	playlists = {},
	videos = {},
	videoStatus = {},
	query = {},
	queryProcess = {},
	queryWatch = {},
	lastPlayhead = {}, // TODO needs to be persistent
	pendingSeek, // http://adamernst.com/post/6570213273/seeking-an-html5-video-player-on-the-ipad
	curVideoId;

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
		$("#menu").remove();
		$("#main > div").unwrap();
		// unwrap breaks the video tag on iPad (bug). Fix it.
		$("video").replaceWith(function() {return $(this).clone();});
		$("html").removeClass("splitview").addClass("no-sidebar");
		$(document).bind( "touchmove", false );
		
		$.mobile.activePage = $("#home");
		
		addQueryProcess( "playlist", function( json ) {
			// Load the playlist data for later use
			var playlist = JSON.parse( json );
			loadPlaylists( [ playlist ] );
			
			return playlist;
		});
		
		addQueryWatch( "video", function( id ) {
			setCurrentVideo( id );
		});
		
		addQueryWatch( "video_status", function( json ) {
			var updatedVideos = JSON.parse( json );
			// Merge into videoStatus
			$.each( updatedVideos, function( id, status ) {
				videoStatus[ id ] = status;
			});
			if ( curVideoId in updatedVideos ) {
				updateStatus();
			}
		});
		
		addQueryWatch( "playing", function( b ) {
			// This seems inelegant, TODO make it cleaner
			if ( b !== "no" ) {
				$("video").get(0).play();
			} else {
				$("video").get(0).pause();
			}
		});
		
		$(".save").click(function(){
			$( this ).addClass( "ui-disabled" );
			updateNativeHost( "download=" + curVideoId );
		});
		$(".share").click(function(){
			var location = $(this).offset();
			location["width"] = $(this).width();
			location["height"] = $(this).height();
			updateNativeHost( "share=" + curVideoId + "&share_location=" + encodeURIComponent(JSON.stringify(location)) );
		});
		
		$( "video" ).bind( "play" , function(ev) {
			updateNativeHost( "playing=yes" );
		}).bind( "pause" , function(ev) {
			updateNativeHost( "playing=no" );
		});
	});
}

$(function() {
	$("video").error(function(e) {
		lg("error " + e.target.error.code, true);
		pendingSeek = null;
		$("video").hide();
		$(".loading").hide();
		$(".error").show();
		$(".error h2").text("Network Error");
		$(".error p").text("Try downloading videos for offline viewing.");
		// You can't immediately animate an object that's just been shown.
		// http://www.greywyvern.com/?post=337
		// If you can find a better way, please do.
		setTimeout(function() { $(".error .details").css("opacity", 1.0); }, 0);
	}).bind( "loadstart progress suspend abort emptied stalled loadedmetadata loadeddata canplay canplaythrough playing waiting seeking seeked ended durationchange play pause ratechange" , function(ev){ 
		lg(ev.type, true);
	}).bind( "loadstart progress stalled loadedmetadata loadeddata canplay canplaythrough playing waiting durationchange" , function( ev ) {
		if ( pendingSeek !== null ) {
			var seekableRanges = ev.target.seekable;
			var isSeekable = function() {
				for ( var i = 0; i < seekableRanges.length; i++ )
					if ( seekableRanges.start(i) <= pendingSeek )
						if ( pendingSeek <= seekableRanges.end(i) )
							return true;
				return false;
			}
			if ( isSeekable() ) {
				// Copy to a local variable, in case setting currentTime triggers further events.
				var seekTo = pendingSeek;
				pendingSeek = null;
				ev.target.currentTime = seekTo;
			}
		}
	}).bind( "timeupdate" , function(ev){
		lastPlayhead[ curVideoId ] = ev.target.currentTime;
	}).bind( "loadstart" , function(ev){
		$(".loading").show();
	}).bind( "suspend progress stalled loadedmetadata loadeddata canplay playing", function(ev) {
		$(".loading").hide();
	});
	
	var updateVideoHeight = function() {
		var height = $(window).width() / 16.0 * 9.0;
		$(".video-wrap").height(height);
	};
	$(window).resize(updateVideoHeight);
	updateVideoHeight(); // Also update immediately
});

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

function updateNativeHost(qs) {
	window.location = "khan://update?" + qs;
}

function setCurrentVideo( id ) {
	if ( curVideoId === id ) return;
	
	var player = $("video").get(0);
	var video = videos[ id ];
	var status = videoStatus[ id ];
	
	if ( !player.paused ) player.pause();
	// TODO there has to be a better way to do this...
	var available = true;
	if ( status && status[ "download_status" ] && status[ "download_status" ][ "offline_url" ] ) {
		player.src = status[ "download_status" ][ "offline_url" ];
	} else if ( video["download_urls"] && video["download_urls"]["mp4"] ) {
		player.src = video[ "download_urls" ][ "mp4" ];
	} else {
		available = false;
	}
	
	if ( id in lastPlayhead ) {
		pendingSeek = lastPlayhead[id];
	} else {
		pendingSeek = null;
	}
	curVideoId = id;
	
	if ( available ) {
		$(player).show();
		$(".error").hide();
		$(".error .details").css("opacity", 0.0);
		$(".loading").show();
		player.load();
	} else {
		$(player).hide();
		$(".error").show();
		$(".error .details").css("opacity", 1.0);
		$(".error h2").text("Video Not Yet Available");
		$(".error p").text("Try again in a few hours.");
		$(".loading").hide();
	}
	
	$(".below-video h1").text( video[ "title" ] );
	$(".below-video p").text( video[ "description" ] );
	updateStatus();
}

function updateStatus() {
	var btn = $(".save");
	var btnText = $(".ui-btn-text", btn);
	
	if ( curVideoId in videoStatus ) {
		var status = videoStatus[ curVideoId ];
		var downloadStatus = status[ "download_status" ];
		if (downloadStatus) {
			if ( downloadStatus[ "offline_url" ] ) {
				btnText.text("Downloaded");
			} else {
				btnText.text("Downloading... (" + Math.round(downloadStatus[ "download_progress" ] * 100.0) + "%)");
			}
			btn.toggleClass( "ui-disabled", true );
			return;
		}
	}
	
	btnText.text( "Download" );
	var video = videos[ curVideoId ];
	btn.toggleClass( "ui-disabled", !(video["download_urls"] && video["download_urls"]["mp4"]) );  // TODO duplicates logic above
}

function lg(msg, states) {
	var v = $("video").get(0);
	if (states) {
		msg += " (readyState " + v.readyState + ", networkState " + v.networkState + ", currentTime " + v.currentTime + ")";
	}
	$(".log").prepend("<li>" + msg + "</li>");
}
