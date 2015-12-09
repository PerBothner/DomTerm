var cur_column_style = 2;
var style_cookie_name = "style" ;
var style_cookie_duration = 30 ;
var one_column_stylesheet;
var two_column_stylesheet;

function onLoadHandler() {
  //useStyleAgain('saved-style');

  //if (! window.cookieSeen) {
    /* Window size calculation from S5 slides.css. by Eric Meyer. */
    var hSize, vSize;
    if (window.innerHeight) {
      vSize = window.innerHeight;
      hSize = window.innerWidth;
    } else if (document.documentElement.clientHeight) {
      vSize = document.documentElement.clientHeight;
      hSize = document.documentElement.clientWidth;
    } else if (document.body.clientHeight) {
      vSize = document.body.clientHeight;
      hSize = document.body.clientWidth;
    } else {
      vSize = 0;
      hSize = 0;
    }
    if ((hSize < 700 && hSize > 0)
        || (screen && screen.availWidth > 0 && screen.availWidth < 700))
      changeStyle("Single column, top navigation");
  //}

  var scheme = location.protocol;
  if (scheme!="http:" && scheme!="https:") {
    var links = document.getElementsByTagName("a");
    for (var i = links.length; --i >= 0; ) {
      var link = links[i];
      var href = link.href;
      var hlen = href.length;
      if (hlen > 0 && link.protocol==scheme && href.charAt(hlen-1) == "/")
        links[i].href = href + "index.html";
    }
  }
}

function onUnloadHandler() {
  //rememberStyle('saved-style',20);
}

/***********************************************************************************************
                             Script to swap between stylesheets
  Written by Mark Wilton-Jones, 05/12/2002. v2.2.1 updated 14/03/2006 for dynamic stylesheets
 ************************************************************************************************

Please see http://www.howtocreate.co.uk/jslibs/ for details and a demo of this script
Please see http://www.howtocreate.co.uk/jslibs/termsOfUse.html for terms of use
________________________________________________________________________________________________*/

function getAllSheets() {
	if( !window.ScriptEngine && navigator.__ice_version ) { return document.styleSheets; }
	if( document.getElementsByTagName ) { var Lt = document.getElementsByTagName('link'), St = document.getElementsByTagName('style');
	} else if( document.styleSheets && document.all ) { var Lt = document.all.tags('LINK'), St = document.all.tags('STYLE');
	} else { return []; } for( var x = 0, os = []; Lt[x]; x++ ) {
		var rel = Lt[x].rel ? Lt[x].rel : Lt[x].getAttribute ? Lt[x].getAttribute('rel') : '';
		if( typeof( rel ) == 'string' && rel.toLowerCase().indexOf('style') + 1 ) { os[os.length] = Lt[x]; }
	} for( var x = 0; St[x]; x++ ) { os[os.length] = St[x]; } return os;
}
function changeStyle() {
	window.userHasChosen = window.MWJss;
	for( var x = 0, ss = getAllSheets(); ss[x]; x++ ) {
		if( ss[x].title ) { ss[x].disabled = true; }
		for( var y = 0; y < arguments.length; y++ ) { if( ss[x].title == arguments[y] ) { ss[x].disabled = false; } }
        } }
/*
function changeStyleRaw() {
	for( var x = 0, ss = getAllSheets(); ss[x]; x++ ) {
		if( ss[x].title ) { ss[x].disabled = true; }
		for( var y = 0; y < arguments.length; y++ ) { if( ss[x].title == arguments[y] ) { ss[x].disabled = false; } }
        } }
function rememberStyle( cookieName, cookieLife ) {
	for( var viewUsed = false, ss = getAllSheets(), x = 0; window.MWJss && MWJss[x] && ss[x]; x++ ) { if( ss[x].disabled != MWJss[x] ) { viewUsed = true; break; } }
	if( !window.userHasChosen && !viewUsed ) { return; }
	for( var x = 0, outLine = '', doneYet = []; ss[x]; x++ ) {
		if( ss[x].title && ss[x].disabled == false && !doneYet[ss[x].title] ) { doneYet[ss[x].title] = true; outLine += ( outLine ? ' MWJ ' : '' ) + escape( ss[x].title ); } }
	if( ss.length ) { document.cookie = escape( cookieName ) + '=' + escape( outLine ) + ( cookieLife ? ';expires=' + new Date( ( new Date() ).getTime() + ( cookieLife * 86400000 ) ).toGMTString() : '' ) + ';path=/'; }
}
function useStyleAgain( cookieName ) {
	for( var x = 0; x < document.cookie.split( "; " ).length; x++ ) {
		var oneCookie = document.cookie.split( "; " )[x].split( "=" );
		if( oneCookie[0] == escape( cookieName ) ) {
			var styleStrings = unescape( oneCookie[1] ).split( " MWJ " );
			for( var y = 0, funcStr = ''; styleStrings[y]; y++ ) { funcStr += ( y ? ',' : '' ) + 'unescape( styleStrings[' + y + '] )'; }
			eval( 'changeStyle(' + funcStr + ');' );
			window.cookieSeen = true; break;
	} }
        window.MWJss = []; for( var ss = getAllSheets(), x = 0; ss[x]; x++ ) { MWJss[x] = ss[x].disabled; }
}*/
