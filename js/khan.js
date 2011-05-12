var videos;

$(document).delegate( "#playlist a", "mousedown", function() {
	// Grab the Youtube ID for the video
	genVideoPage( this.href.substr( this.href.indexOf("#video-") + 7 ) );
});

$(function() {
	$.getJSON( "http://www.khanacademy.org/api/playlistvideos?playlist=Algebra&callback=?", function( data ) {
		videos = data;
		ready();
	});

/*
	$(".ui-btn").live("hover", function() {
		$(this).toggleClass( "ui-btn-up-c ui-btn-hover-c" );
	});
*/
});

function ready() {
	$("#playlist")
		.html( "<li></li>" + tmpl( "videos", videos ) )
		.listview( "refresh" )
		.children().first().remove();
}

function genVideoPage( id ) {
	var video;
	
	// Generated page already exists
	if ( $("#video-" + id).length ) {
		return;
	}

	// Find the associated data blob
	for ( var i = 0, l = videos.length; i < l; i++ ) {
		if ( videos[i].youtube_id === id ) {
			video = videos[i];
			break;
		}
	}
	
	// If we found it, add it to the page
	if ( video ) {
		$( tmpl( "video", video ) )
			.appendTo( "#main" )
			.page();
	}
}