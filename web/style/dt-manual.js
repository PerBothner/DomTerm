// Hook used by info.js to set sidebar-header logo+text
function sidebarLinkAppendContents(a, h1) {
    a.innerHTML = "<div class='logo'><img src='images/domterm1.svg'/><span>DomTerm terminal emulator</span></div>"
}

function fixCategory() {
    let categories = document.body.getElementsByClassName("category");
    for (let i = categories.length; --i >= 0; ) {
        let category = categories[i];
        let text = category.innerHTML;
        let m = text.match(/^(..*): *$/);
        if (m) {
            category.innerHTML = m[1];
        }
    }
}
INFO_CONFIG = {
    on_iframe_load: fixCategory
};
