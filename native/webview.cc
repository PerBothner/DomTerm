// Fedora: dnf install gtk3-devel webkit2gtk3-devel

#include "webview.h"
#ifdef WIN32
int WINAPI WinMain(HINSTANCE hInt, HINSTANCE hPrevInst, LPSTR lpCmdLine,
                   int nCmdShow) {
#else
int main(int argc, char **argv) {
#endif
    //const char *url = "https://en.m.wikipedia.org/wiki/Main_Page";
    char *geometry = NULL;
    char *url = NULL;
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
    // printf("g:%s w:%d h:%d u:%s\n", geometry, width, height, url);
    // exit(0);
    webview::webview w(true, nullptr);
    w.set_title("DomTerm");
    w.set_size(width, height, WEBVIEW_HINT_NONE);
    w.navigate(url);
    w.run();
    return 0;
}
