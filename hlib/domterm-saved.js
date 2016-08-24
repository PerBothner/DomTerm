/* Used for saved (snapshots of) DomTerm sessions. */
function loadHandler(event) {
    var dt = new DomTerm("domterm");
    window.domterm1 = dt;
    var topNode = document.getElementById("domterm");
    //wt.initializeTerminal(topNode);
    topNode.addEventListener("click",
                             function(e) {
                                 var target = e.target;
                                 if (target instanceof Element
                                     && target.nodeName == "SPAN"
                                     && target.getAttribute("class") == "term-style"
                                     && target.getAttribute("std") == "hider") {
                                     dt._showHideHandler(e);
                                     e.preventDefault();
                                 }
                             },
                             false);
    
};
window.addEventListener("load", loadHandler, false);
