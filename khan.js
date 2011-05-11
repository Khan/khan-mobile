var videos;

$(function() {
	$.getJSON( "http://www.khanacademy.org/api/playlistvideos?playlist=Algebra&callback=?", function( data ) {
		videos = data;
		ready();
	});
});

function ready() {
	$("#playlist")
		.html( $.map( videos, function( video ) {
			return "<li><img src='http://img.youtube.com/vi/" + video.youtube_id + "/2.jpg'/>" +
				"<a href=''><h3>" + video.title + "</h3><p>" + video.description + "</p></a></li>";
		}).join("") )
		.listview( "refresh" );
}
