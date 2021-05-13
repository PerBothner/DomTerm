#include "webview.h"

webview::webview w(true, nullptr);

void close_main_window(const char *seq, const char *req, void *arg)
{
    exit(0);
}

void set_w_t(const char *seq, const char *req, void *arg)
{
    size_t rlen = strlen(req);
    // The req is a JSON list of a single string.
    // The +1 and -2 are to strip off the list delimiters '[' and ']'
    int jlen = webview::json_unescape(req+1, rlen-2, nullptr);
    char *tmp = new char[jlen+1];
    webview::json_unescape(req+1, rlen-2, tmp);
    w.set_title(tmp);
    delete[] tmp;
}

#ifdef WIN32
int WINAPI WinMain(HINSTANCE hInt, HINSTANCE hPrevInst, LPSTR lpCmdLine,
                   int nCmdShow) {
#else
int main(int argc, char **argv) {
#endif
    char *geometry = NULL;
    char *url = NULL;
#ifdef WEBVIEW_GTK
    // See https://wiki.archlinux.org/index.php/GTK#Disable_overlay_scrollbars
    setenv("GTK_OVERLAY_SCROLLING", "0", 1);
#endif
    for (int i = 1; i < argc; i++) {
        char *arg = argv[i];
        if (strcmp(arg, "--geometry") == 0 && i+1 < argc) {
            geometry = argv[++i];
        } else {
            url = arg;
        }
    }
    int width = 800, height = 600;
    if (geometry) {
        int w, h;
        if (sscanf(geometry, "%dx%d", &w, &h) == 2) {
            width = w;
            height = h;
        }
    }
    w.set_title("DomTerm");
    webview_bind(&w, "setWindowTitle", set_w_t, NULL);
    webview_bind(&w, "closeMainWindow", close_main_window, NULL);
    w.set_size(width, height, WEBVIEW_HINT_NONE);
    w.navigate(url);
    w.run();
    return 0;
}
