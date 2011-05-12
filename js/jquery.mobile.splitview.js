(function($,window,undefined){
  $( window.document ).bind('mobileinit', function(){
    //some class for css to detect touchscreens
    if($.support.touch){
      $('html').addClass('touch');
    }
    if ($.mobile.media("screen and (min-width:480px)")||($.mobile.browser.ie && $(this).width() >= 480)) {
      $('html').addClass('splitview');
      $(function() {
        $(document).unbind('.toolbar');
        $('.ui-page').die('.toolbar');
        $('div[data-role="panel"]').addClass('ui-mobile-viewport');
        if( !$.mobile.hashListeningEnabled || !$.mobile.path.stripHash( location.hash ) ){
          var firstPage=$('div[data-id="main"] > div[data-role="page"]:first').page().addClass($.mobile.activePageClass); 
          firstPage.children('div[data-role="content"]').attr('data-scroll', 'y');
        }
        $(window).trigger('orientationchange');
      });

//----------------------------------------------------------------------------------
//Main event bindings: click, form submits, hashchange and orientationchange/resize
//----------------------------------------------------------------------------------
      //DONE: link click event binding for changePage
      //click routing - direct to HTTP or Ajax, accordingly
      function findClosestLink(ele)
      {
        while (ele){
          if (ele.nodeName.toLowerCase() == "a"){
            break;
          }
          ele = ele.parentNode;
        }
        return ele;
      }

      $(document).unbind("click");
      $(document).bind( "click", function(event, isRefresh) {
        var link = findClosestLink(event.target);
        if (!link){
          return;
        }

        var $link = $(link),

          //get href, if defined, otherwise fall to null #
          href = $link.attr( "href" ) || "#",

          //cache a check for whether the link had a protocol
          //if this is true and the link was same domain, we won't want
          //to prefix the url with a base (esp helpful in IE, where every
          //url is absolute
          hadProtocol = $.mobile.path.hasProtocol( href ),

          //get href, remove same-domain protocol and host
          url = $.mobile.path.clean( href ),

          //rel set to external
          isRelExternal = $link.is( "[rel='external']" ),

          //rel set to external
          isEmbeddedPage = $.mobile.path.isEmbeddedPage( url ),

          // Some embedded browsers, like the web view in Phone Gap, allow cross-domain XHR
          // requests if the document doing the request was loaded via the file:// protocol.
          // This is usually to allow the application to "phone home" and fetch app specific
          // data. We normally let the browser handle external/cross-domain urls, but if the
          // allowCrossDomainPages option is true, we will allow cross-domain http/https
          // requests to go through our page loading logic.
          isCrossDomainPageLoad = ($.mobile.allowCrossDomainPages && location.protocol === "file:" && url.search(/^https?:/) != -1),

          //check for protocol or rel and its not an embedded page
          //TODO overlap in logic from isExternal, rel=external check should be
          //     moved into more comprehensive isExternalLink
          isExternal = ($.mobile.path.isExternal(url) && !isCrossDomainPageLoad) || (isRelExternal && !isEmbeddedPage),

          //if target attr is specified we mimic _blank... for now
          hasTarget = $link.is( "[target]" ),

          //if data-ajax attr is set to false, use the default behavior of a link
          hasAjaxDisabled = $link.is(":jqmData(ajax='false')"),

          $targetPanel=$link.jqmData('panel'),
          $targetContainer=$('div:jqmData(id="'+$targetPanel+'")'),
          $targetPanelActivePage=$targetContainer.children('div.'+$.mobile.activePageClass),
          $currPanel=$link.parents('div:jqmData(role="panel")'),
          //not sure we need this. if you want the container of the element that triggered this event, $currPanel 
          $currContainer=$.mobile.pageContainer, 
          $currPanelActivePage=$currPanel.children('div.'+$.mobile.activePageClass),
          from = null;

        //if there's a data-rel=back attr, go back in history
        if( $link.is( ":jqmData(rel='back')" ) ){
          window.history.back();
          return false;
        }

        //prevent # urls from bubbling
        //path.get() is replaced to combat abs url prefixing in IE
        var replaceRegex = new RegExp($.mobile.path.get()+"(?=#)");
        if( url.replace(replaceRegex, "") == "#" ){
          //for links created purely for interaction - ignore
          event.preventDefault();
          return;
        }

        $activeClickedLink = $link.closest( ".ui-btn" );

        if( isExternal || hasAjaxDisabled || hasTarget || !$.mobile.ajaxEnabled ||
          // TODO: deprecated - remove at 1.0
          !$.mobile.ajaxLinksEnabled ){
          //remove active link class if external (then it won't be there if you come back)
          window.setTimeout(function() {removeActiveLinkClass(true);}, 200);

          //use default click handling
          return;
        }

        //use ajax
        var transition = $link.jqmData( "transition" ),
          direction = $link.jqmData("direction"),
          reverse = (direction && direction === "reverse") ||
                    // deprecated - remove by 1.0
                    $link.jqmData( "back" ),
          hash = $currPanel.jqmData('hash');


        //this may need to be more specific as we use data-rel more
        nextPageRole = $link.attr( "data-" + $.mobile.ns + "rel" );

        //if it's a relative href, prefix href with base url
        if( $.mobile.path.isRelative( url ) && !hadProtocol ){
          url = $.mobile.path.makeAbsolute( url );
        }

        url = $.mobile.path.stripHash( url );

        //if link refers to an already active panel, stop default action and return
        if ($targetPanelActivePage.attr('data-url') == url || $currPanelActivePage.attr('data-url') == url) {
          if (isRefresh) { //then changePage below because it's a pageRefresh request
            $.mobile.changePage([$(':jqmData(url="'+url+'")'),url], 'fade', reverse, false, undefined, $targetContainer );
          }
          else { //else preventDefault and return
            event.preventDefault();
            return;
          }
        }
        //if link refers to a page on another panel, changePage on that panel
        else if ($targetPanel && $targetPanel!=$link.parents('div[data-role="panel"]')) {
          var from=$targetPanelActivePage;
          // $.mobile.pageContainer=$targetContainer;
          $.mobile.changePage([from,url], transition, reverse, true, undefined, $targetContainer);
        }
        //if link refers to a page inside the same panel, changePage on that panel 
        else {
          var from=$currPanelActivePage;
          // $.mobile.pageContainer=$currPanel;
          var hashChange= (hash == 'false' || hash == 'crumbs')? false : true;
          $.mobile.changePage([from,url], transition, reverse, hashChange, undefined, $currPanel);
          //active page must always point to the active page in main - for history purposes.
          $.mobile.activePage=$('div[data-id="main"] > div.'+$.mobile.activePageClass);
        }

        // $.mobile.changePage( url, transition, reverse );
        event.preventDefault();
      });

      //DONE: bind form submit with this plugin
      $("form").die('submit');
      $("form").live('submit', function(event){
        if( !$.mobile.ajaxEnabled ||
          //TODO: deprecated - remove at 1.0
          !$.mobile.ajaxFormsEnabled ||
          $(this).is( "[data-ajax='false']" ) ){ return; }

        var $this = $(this);
            type = $this.attr("method"),
            url = $.mobile.path.clean( $this.attr( "action" ) ),
            $currPanel=$this.parents('div[data-role="panel"]'),
            $currPanelActivePage=$currPanel.children('div.'+$.mobile.activePageClass);

        if( $.mobile.path.isExternal( url ) ){
          return;
        }

        if( $.mobile.path.isRelative( url ) ){
          url = $.mobile.path.makeAbsolute( url );
        }

        //temporarily put this here- eventually shud just set it immediately instead of an interim var.
        $.mobile.activePage=$currPanelActivePage;
        // $.mobile.pageContainer=$currPanel;
        $.mobile.changePage({
            url: url,
            type: type || "get",
            data: $this.serialize()
          },
          undefined,
          undefined,
          true,
          false,
          $currPanel
        );
        event.preventDefault();
      });

      //DONE: bind hashchange with this plugin
      //hashchanges are defined only for the main panel - other panels should not support hashchanges to avoid ambiguity
      $(window).unbind("hashchange");
      $(window).bind( "hashchange", function( e, triggered ) {
        var to = $.mobile.path.stripHash( location.hash ),
            transition = $.mobile.urlHistory.stack.length === 0 ? false : undefined,
            $mainPanel=$('div[data-id="main"]'),
            $mainPanelFirstPage=$mainPanel.children('div[data-role="page"]').first(),
            $mainPanelActivePage=$mainPanel.children('div.ui-page-active'),
            $menuPanel=$('div[data-id="menu"]'),
            $menuPanelFirstPage=$menuPanel.children('div[data-role="page"]').first(),
            $menuPanelActivePage=$menuPanel.children('div.ui-page-active'),
            //FIX: temp var for dialogHashKey
            dialogHashKey = "&ui-state=dialog";

        if( !$.mobile.hashListeningEnabled || !$.mobile.urlHistory.ignoreNextHashChange ){
          if( !$.mobile.urlHistory.ignoreNextHashChange ){
            $.mobile.urlHistory.ignoreNextHashChange = true;
          }
          return;
        }

        if( $.mobile.urlHistory.stack.length > 1 &&
            to.indexOf( dialogHashKey ) > -1 &&
            !$.mobile.activePage.is( ".ui-dialog" ) ){

          $.mobile.urlHistory.directHashChange({
            currentUrl: to,
            isBack: function(){ window.history.back(); },
            isForward: function(){ window.history.forward(); }
          });

          return;
        }

        //if to is defined, load it
        if ( to ){
          $.mobile.pageContainer=$menuPanel;
          //if this is initial deep-linked page setup, then changePage sidemenu as well
          if (!$('div.ui-page-active').length) {
            $.mobile.changePage($menuPanelFirstPage, transition, true, false, true);
          }
          // $.mobile.pageContainer=$mainPanel;
          $.mobile.activePage=$mainPanelActivePage.length? $mainPanelActivePage : undefined;
          $.mobile.changePage(to, transition, undefined, false, true, $mainPanel );
        }
        //there's no hash, go to the first page in the main panel.
        else {
          // $.mobile.pageContainer=$mainPanel;
          $.mobile.activePage=$mainPanelActivePage? $mainPanelActivePage : undefined;
          $.mobile.changePage($mainPanelFirstPage, transition, undefined, false, true, $mainPanel ); 
        }
      });

      //DONE: bind orientationchange and resize
      $(window).bind('orientationchange resize', function(event){
        var $menu=$('div[data-id="menu"]'),
            $main=$('div[data-id="main"]'),
            $mainHeader=$main.find('div.'+$.mobile.activePageClass+'> div[data-role="header"]'),
            $window=$(window);
        
        function popoverBtn(header) {
          if(!header.children('.popover-btn').length){
            if(header.children('a.ui-btn-left').length){
              header.children('a.ui-btn-left').replaceWith('<a class="popover-btn">Menu</a>');
              header.children('a.popover-btn').addClass('ui-btn-left').buttonMarkup();
            }
            else{
              header.prepend('<a class="popover-btn">Menu</a>');
              header.children('a.popover-btn').addClass('ui-btn-left').buttonMarkup()          
            }
          }
        }

        function replaceBackBtn(header) {
          if($.mobile.urlstack.length > 0 && !header.children('a:jqmData(rel="back")').length && header.jqmData('backbtn')!=false){ 
            header.prepend("<a href='#' class='ui-btn-left' data-"+ $.mobile.ns +"rel='back' data-"+ $.mobile.ns +"icon='arrow-l'>Back</a>" );
            header.children('a:jqmData(rel="back")').buttonMarkup();
          }
        };

        function popover(){
          $menu.addClass('panel-popover')
               .removeClass('ui-panel-left ui-border-right')
               .css({'width':'25%', 'min-width':'250px', 'display':''});     
          if(!$menu.children('.popover_triangle').length){ 
            $menu.prepend('<div class="popover_triangle"></div>'); 
          }
          $main.removeClass('ui-panel-right')
               .css('width', '');
          popoverBtn($mainHeader);

          $main.undelegate('div[data-role="page"]', 'pagebeforeshow.splitview');
          $main.delegate('div[data-role="page"]','pagebeforeshow.popover', function(){
            var $thisHeader=$(this).children('div[data-role="header"]');
            popoverBtn($thisHeader);
          });
        };

        function splitView(){
          $menu.removeClass('panel-popover')
               .addClass('ui-panel-left ui-border-right')
               .css({'width':'25%', 'min-width':'250px', 'display':''});
          $menu.children('.popover_triangle').remove();
          $main.addClass('ui-panel-right')
               .width(function(){
                 return $(window).width()-$('div[data-id="menu"]').width();  
               });
          $mainHeader.children('.popover-btn').remove();
          
          replaceBackBtn($mainHeader);

          $main.undelegate('div[data-role="page"]', 'pagebeforeshow.popover');
          $main.delegate('div[data-role="page"]', 'pagebeforeshow.splitview', function(){
            var $thisHeader=$(this).children('div[data-role="header"]');
            $thisHeader.children('.popover-btn').remove();
            replaceBackBtn($thisHeader);
          });

        }

        if(event.orientation){
          if(event.orientation == 'portrait'){
            popover();            
          } 
          else if(event.orientation == 'landscape') {
            splitView();
          } 
        }
        else if($window.width() < 768 && $window.width() > 480){
          popover();
        }
        else if($window.width() > 768){
          splitView();
        }
      });

//----------------------------------------------------------------------------------
//Other event bindings: scrollview, popover buttons, and toolbar hacks
//----------------------------------------------------------------------------------

      //DONE: pageshow binding for scrollview
      $('div[data-role="page"]').live('pagebeforeshow.scroll', function(event){
        if ($.support.touch) {
          var $page = $(this);
          $page.find('div[data-role="content"]').attr('data-scroll', 'y');
          $page.find("[data-scroll]:not(.ui-scrollview-clip)").each(function(){
            var $this = $(this);
            // XXX: Remove this check for ui-scrolllistview once we've
            //      integrated list divider support into the main scrollview class.
            if ($this.hasClass("ui-scrolllistview"))
              $this.scrolllistview();
            else
            {
              var st = $this.data("scroll") + "";
              var paging = st && st.search(/^[xy]p$/) != -1;
              var dir = st && st.search(/^[xy]/) != -1 ? st.charAt(0) : null;

              var opts = {};
              if (dir)
                opts.direction = dir;
              if (paging)
                opts.pagingEnabled = true;

              var method = $this.data("scroll-method");
              if (method)
                opts.scrollMethod = method;

              $this.scrollview(opts);
            }
          });
        }
      });

      //data-hash 'crumbs' handler
      //NOTE: if you set data-backbtn to false this WILL not work! will find time to work this thru better.
      $('div[data-role="page"]').live('pagebeforeshow.crumbs', function(event, data){
        var $this = $(this),
            backBtn = $this.find('a[data-rel="back"]');
        if (backBtn.length && ($this.data('hash') == 'crumbs' || $this.parents('div[data-role="panel"]').data('hash') == 'crumbs') && $.mobile.urlstack.length > 0) {
          backBtn.removeAttr('data-rel')
                 .attr('href','#'+data.prevPage.attr('data-url'))
                 .jqmData('direction','reverse')
                 .addClass('ui-crumbs');
          backBtn.find('.ui-btn-text').html(data.prevPage.find('div[data-role="header"] .ui-title').html());
        }
      });

      //data-context handler - a page with a link that has a data-context attribute will load that page after this page loads
      //this still needs work - pageTransitionQueue messes everything up.
      $('div:jqmData(role="page")').live('pageshow.context', function(){
        var $this=$(this),
            panelContextSelector = $this.parents('div[data-role="panel"]').jqmData('context'),
            pageContextSelector = $this.jqmData('context'),
            contextSelector= pageContextSelector ? pageContextSelector : panelContextSelector;
        if(contextSelector && $this.find(contextSelector).length){
          $this.find(contextSelector).trigger('click', true);
        }
      });

      //popover button click handler - from http://www.cagintranet.com/archive/create-an-ipad-like-dropdown-popover/
      $('.popover-btn').live('click', function(e){ 
        e.preventDefault(); 
        $('.panel-popover').fadeToggle('fast'); 
        if ($('.popover-btn').hasClass($.mobile.activeBtnClass)) { 
            $('.popover-btn').removeClass($.mobile.activeBtnClass); 
        } else { 
            $('.popover-btn').addClass($.mobile.activeBtnClass); 
        } 
      });

      $('body').live('click', function(event) { 
        if (!$(event.target).closest('.panel-popover').length && !$(event.target).closest('.popover-btn').length) { 
            $(".panel-popover").stop(true, true).hide(); 
            $('.popover-btn').removeClass($.mobile.activeBtnClass); 
        }; 
      });
    }
  });
})(jQuery,window);