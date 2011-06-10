var data,
	playlists = {},
	videos = {},
	query = {},
	queryWatch = {},
	YTReady;

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
	});

} else {
	$(function() {
		$("#menu").remove();
		$("#main > div").unwrap();
		$("html").removeClass("splitview").addClass("no-sidebar");
		
		$.mobile.activePage = $("#home");
		
		addQueryWatch( "video", function( json ) {
			json = JSON.parse( json );
			
			// Generated page doesn't exist so make it
			if ( !$("#video-" + json.youtube_id).length ) {
				$( tmpl( "video-tmpl", json ) )
					.appendTo( "body" )
					.page();
			}
			
			if ( YTReady ) {
				var oldIframe = $.mobile.activePage.find("iframe")[0];
			
				if ( oldIframe ) {
					(new YT.Player( oldIframe )).pauseVideo();
				}
			}
			
			// Swap to the new page
			$.mobile.changePage( $("#video-" + json.youtube_id), "none", false, false );
		});
	});
}

function onYouTubePlayerAPIReady() {
	YTReady = true;
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
	// Grab the Youtube ID for the video
	var id = this.href.substr( this.href.indexOf("#video-") + 7 );
	
	// Generated page already exists
	if ( $("#video-" + id).length ) {
		return;
	}
	
	// If we found it, add it to the page
	if ( videos[ id ] ) {
		$( tmpl( "video-tmpl", videos[ id ] ) )
			.appendTo( "#main" )
			.page();
	}
});

// Query String Parser
// Original from:
// http://stackoverflow.com/questions/901115/get-querystring-values-in-javascript/2880929#2880929
function updateQuery( q ) {
	var e,
		a = /\+/g,  // Regex for replacing addition symbol with a space
		r = /([^&=]+)=?([^&]*)/g,
		d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
		name;

	while ( (e = r.exec(q)) ) {
		name = d(e[1]);
		query[ name ] = d(e[2]);
		
		if ( queryWatch[ name ] ) {
			queryWatch[ name ]( query[ name ] );
		}
	}
	
	return true;
}

function addQueryWatch( name, fn ) {
	queryWatch[ name ] = fn;
	
	if ( query[ name ] ) {
		queryWatch[ name ]( query[ name ] );
	}
}