chrome.app.runtime.onLaunched.addListener(function() {
    chrome.app.window.create('repl-client.html', {
        outerBounds: { width: 600, height: 500 }
    });
});

chrome.runtime.onInstalled.addListener(function() {
    alert("onInstalled");
    chrome.contextMenus.create({
        title: "Copy",
        id: "context-copy"
    });
    chrome.contextMenus.create({
        title: "Paste",
        id: "context-paste"
    });
});
