var videos;

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
		.html( "<li></li>" + tmpl( "video", videos ) )
		.listview( "refresh" )
		.children().first().remove();
}
