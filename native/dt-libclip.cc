#include <libclipboard.h>
#include <string.h>
#include <stdio.h>

int
main(int argc, char **argv)
{
    clipboard_c* clipboard_manager = clipboard_new(NULL);
    clipboard_mode cmode =
        argv[1] && strcmp(argv[1], "--print-selection") == 0 ? LCB_PRIMARY
        : LCB_CLIPBOARD;

    int length;
    char *clipText = clipboard_text_ex(clipboard_manager, &length, cmode);
    if (clipText
        && fwrite(clipText, 1, length, stdout) == length
        && fputc('\n', stdout) >= 0)
        return 0;
    return -1;
}
