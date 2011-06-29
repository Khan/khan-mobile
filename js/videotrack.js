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
			var self = this;
			setInterval(function() {
				self.playerStateChange(-2);
			}, 10000);
			this.fIntervalStarted = true;
		}
	},

	listenToPlayerStateChange: function() {
		if (!this.player || this.player.fStateChangeHookAttached) return;
		
		var status = this;
		
		if (!this.fAlternativePlayer) {
			window.onYouTubePlayerStateChange = function(state) {
			    status.playerStateChange(state);
			};
			
			// YouTube player is ready, add event listener
			this.player.addEventListener("onStateChange", "onYouTubePlayerStateChange");

		} else {
			
			$(this.player).bind( "play", function() {
				status.playerStateChange( 1 );
			}).bind( "pause", function() {
				status.playerStateChange( 2 );
			}).bind( "ended", function() {
				status.playerStateChange( 0 );
			});
		}
		
		// Multiple calls should be idempotent
		this.player.fStateChangeHookAttached = true;
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

		var self = this,
			id = this.curVideoId,
			secondsWatched = this.getSecondsWatchedRestrictedByPageTime(),
			lastSecondWatched = this.getSecondsWatched();
		
		// Store the watch data offline
		if ( window.localStorage ) {
			window.localStorage[ "watch:" + id ] = secondsWatched + "," + lastSecondWatched;
			
			if ( (window.localStorage.watch || "").indexOf( "," + id ) < 0 ) {
				window.localStorage.watch += "," + id;
			}
		}
		
		if ( !offline ) {
			saveWatch({
				id: id,
				lastSecondWatched: lastSecondWatched,
				secondsWatched: secondsWatched,
				success: function( data ) {
					self.finishSave(data, percent);
				},
				error: function() {
					// Restore pre-error stats so user can still get full
					// credit for video even if GAE timed out on a request
					self.fSaving = false;
					self.dtSinceSave = dtSinceSaveBeforeError;
				}
			});
			
			this.dtSinceSave = new Date();
		
		// Make sure that we resume trying to save
		} else {
			this.fSaving = false;
			this.dtSinceSave = dtSinceSaveBeforeError;
		}
	},

	finishSave: function(dict_json, percent) {
		this.fSaving = false;
		this.dPercentLastSaved = percent;
		
		if ( !dict_json ) {
			return;
		}
		
		if ( typeof updateNativeHost === "function" ) {
			updateNativeHost( "action_result=" + encodeURIComponent(JSON.stringify( dict_json )) );
		}

		// XXX: From the old way of tracking points - not relevant any more?
		if (dict_json.video_points && dict_json.user_points_html)
		{
			var jelPoints = $(".video-energy-points");
			jelPoints.attr("title", jelPoints.attr("title").replace(/^\d+/, dict_json.video_points));
			$(".video-energy-points-current", jelPoints).text(dict_json.video_points);
			$("#user-points-container").html(dict_json.user_points_html);
		}
		
		// Update point display
		updatePoints( this.curVideoId, dict_json && dict_json.action_results );
	},

	prepareAlternativePlayer: function() {

		this.player = $("#flvPlayer").get(0);
		if (!this.player) return;
		
		var self = this;

		// Simulate the necessary YouTube APIs for the alternative player
		this.player.getDuration = function() { return self.cachedDuration; };
		this.player.getCurrentTime = function() { return self.cachedCurrentTime; };

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

function offlineSync() {
	// Coming back online, sync data with server
	if ( !offline && window.localStorage && oauth.token && oauth.consumerKey ) {
		var ids = (window.localStorage.watch || "").split( "," );
		
		for ( var i = 0, l = ids.length; i < l; i++ ) {
			var id = ids[i],
				watched = (window.localStorage[ "watch:" + id ] || "").split( "," );
			
			// We have the data, time to sync it
			if ( watched.length === 2 ) {
				saveWatch({
					id: id,
					lastSecondWatched: watched[1],
					secondsWatched: watched[0]
				});
			
			// Data no longer exists, strike from the sync queue
			} else {
				clearSync( id );
			}
		}
	}
}

function saveWatch( opt ) {
	$.oauth($.extend( {}, oauth, {
		type: "POST",
		url: "http://www.khanacademy.org/api/v1/user/videos/" + opt.id + "/log",
		timeout: 5000,
		dataType: "json",
		data: {
			last_second_watched: opt.lastSecondWatched,
			seconds_watched: opt.secondsWatched
		},
		success: function( data ) {
			// Synced with server, wipe out sync queue
			clearSync( opt.id );
			
			if ( opt.success ) {
				opt.success( data );
			}
		},
		error: opt.error
	}) );
}

function clearSync( id ) {
	if ( id && window.localStorage ) {
		window.localStorage.removeItem( "watch:" + id );
		window.localStorage.watch = window.localStorage.watch.replace( new RegExp(",?" + id, "g"), "" );
	}
}