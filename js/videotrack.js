function VideoStats( id, player ) {
	this.curVideoId = id;
	this.player = player;
}
	
VideoStats.prototype = {
	dPercentGranularity: 0.05,
	dPercentLastSaved: 0.0,
	fSaving: false,
	curVideoId: null,
	player: null,
	fIntervalStarted: false,
	fAlternativePlayer: false,
	cachedDuration: 0, // For use by alternative FLV player
	cachedCurrentTime: 0, // For use by alternative FLV player
	dtSinceSave: null,

	getSecondsWatched: function() {
		if (!this.player) return 0;
		return this.player.getCurrentTime() || 0;
	},

	getSecondsWatchedRestrictedByPageTime: function() {
		var secondsPageTime = ((new Date()) - this.dtSinceSave) / 1000.0;
		return Math.min(secondsPageTime, this.getSecondsWatched());
	},

	getPercentWatched: function() {
		if (!this.player) return 0;

		var duration = this.player.getDuration() || 0;
		if (duration <= 0) return 0;

		return this.getSecondsWatched() / duration;
	},

	startLoggingProgress: function() {

		this.dPercentLastSaved = 0;
		this.cachedDuration = 0;
		this.cachedCurrentTime = 0;
		this.dtSinceSave = new Date();

		// Listen to state changes in player to detect final end of video
		this.listenToPlayerStateChange();
		
		// If the player isn't ready yet or if it is replaced in the future,
		// listen to the state changes once it is ready/replaced.
		$(this).bind("playerready", function() {
			this.listenToPlayerStateChange();
		});

		if (!this.fIntervalStarted)
		{
			// Every 10 seconds check to see if we've crossed over our percent
			// granularity logging boundary
			setInterval(function(){VideoStats.playerStateChange(-2);}, 10000);
			this.fIntervalStarted = true;
		}
	},

	listenToPlayerStateChange: function() {
		if (!this.player || this.player.fStateChangeHookAttached) return;
		
		if (this.fAlternativePlayer)
		{
			this.player 
			// YouTube player is ready, add event listener
			this.player.addEventListener("onStateChange", "onYouTubePlayerStateChange");

			// Multiple calls should be idempotent
			this.player.fStateChangeHookAttached = true;
		}
	},

	playerStateChange: function(state) {
		if (state == -2) { // playing normally
			var percent = this.getPercentWatched();
			if (percent > (this.dPercentLastSaved + this.dPercentGranularity))
			{
				// Another 10% has been watched
				this.save();
			}
		} else if (state == 0) { // ended
			this.save();
		} else if (state == 2) { // paused
			if (this.getSecondsWatchedRestrictedByPageTime() > 1) {
			  this.save();
			}
		} else if (state == 1) { // play
			this.dtSinceSave = new Date();
		}
		// If state is buffering, unstarted, or cued, don't do anything
	},

	save: function() {
		if (this.fSaving) return;

		this.fSaving = true;
		var percent = this.getPercentWatched();
		var dtSinceSaveBeforeError = this.dtSinceSave;

		$.oauth($.extend( {}, oauth, {
			type: "POST",
			url: "http://www.khanacademy.org/api/v1/user/videos/" + this.curVideoId + "/log",
			dataType: "json",
			data: {
				last_second_watched: this.getSecondsWatched(),
				seconds_watched: this.getSecondsWatchedRestrictedByPageTime()
			},
			success: function (data) {
				VideoStats.finishSave(data, percent);
			},
			error: function () {
				// Restore pre-error stats so user can still get full
				// credit for video even if GAE timed out on a request
				VideoStats.fSaving = false;
				VideoStats.dtSinceSave = dtSinceSaveBeforeError;
			}
		}) );

		this.dtSinceSave = new Date();
	},

	finishSave: function(dict_json, percent) {
		VideoStats.fSaving = false;
		VideoStats.dPercentLastSaved = percent;

		if (dict_json.video_points && dict_json.user_points_html)
		{
			var jelPoints = $(".video-energy-points");
			jelPoints.attr("title", jelPoints.attr("title").replace(/^\d+/, dict_json.video_points));
			$(".video-energy-points-current", jelPoints).text(dict_json.video_points);
			$("#user-points-container").html(dict_json.user_points_html);
		}
	},

	prepareAlternativePlayer: function() {

		this.player = $("#flvPlayer").get(0);
		if (!this.player) return;

		// Simulate the necessary YouTube APIs for the alternative player
		this.player.getDuration = function() { return VideoStats.cachedDuration; };
		this.player.getCurrentTime = function() { return VideoStats.cachedCurrentTime; };

		this.fAlternativePlayer = true;
	},
	
	prepareVideoPlayer: function() {
		this.player = $("video").get(0);
		if (!this.player) return;

		// Simulate the necessary YouTube APIs for the alternative player
		this.player.getDuration = function() { return this.duration; };
		this.player.getCurrentTime = function() { return this.currentTime; };

		this.fAlternativePlayer = true;
	},

	cacheStats: function(time, duration) {

		// Only update current time if it exists, not if video finished
		// and scrubber went back to 0.
		var currentTime = parseFloat(time);
		if (currentTime) this.cachedCurrentTime = currentTime;

		this.cachedDuration = parseFloat(duration);
	}
};

function onYouTubePlayerReady(playerID) {
	// Ensure UniSub widget will know about ready players if/when it loads.
	(window.unisubs_readyAPIIDs = window.unisubs_readyAPIIDs || []).push((playerID == "undefined" || !playerID) ? '' : playerID);

	var player = $(".mirosubs-widget object")[0] ||
		document.getElementById("idPlayer") ||
		document.getElementById("idOVideo");

	if ( typeof VideoControls !== "undefined" ) {
		VideoControls.player = player;
		$(VideoControls).trigger('playerready');
	}
	
	// The UniSub (aka mirosubs) widget replaces the YouTube player with a copy 
	// and that will cause onYouTubePlayerReady() to be called again.  So, we trigger 
	// 'playerready' events on any objects that are using the player so that they can 
	// take appropriate action to use the new player.
	var stats = new VideoStats( playerID, player );
	$(stats).trigger('playerready');
}