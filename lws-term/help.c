#include "server.h"
#include "version.h"

struct help_info {
  const char *command;
  const char *help;
};

static bool html_option_seen = false;
static bool man_option_seen = false;
static bool text_option_seen = false;
static char *pager_option = "";

static char attach_help[] = "Usage: domterm attach session-specifier\n";

static char is_domterm_help[] = "Usage: domterm is-domterm\n"
    "Succeeds if running on a DomTerm terminal; fails otherwise.\n"
    "Typical shell usage: if domterm is-domterm; then ...; fi\n";

static char list_help[] = "Usage: domterm list\n"
  "List sessions running under current server.\n";

static char browse_help[] = "Usage: domterm [options] browse url\n"
  "Open the given url in a specified (sub-)window.\n";

struct help_info help_table[] = {
  { "attach", attach_help},
  { "browse", browse_help},
  { "html", "*domterm-hcat"},
  { "hcat", "*domterm-hcat"},
  { "window-specifier", "*domterm-window-specifier" },
  { "image", "*domterm-imgcat"},
  { "imgcat", "*domterm-imgcat"},
  { "is-domterm", is_domterm_help},
  { "list", list_help},
  { "new", "*domterm-new"},
  { "domterm", "*domterm"},
  { "qtdomterm", "*qtdomterm"},
  { NULL, NULL }
};

void print_help_file(const char* name, FILE *out)
{
    char *hdir = get_bin_relative_path(DOMTERM_DIR_RELATIVE "/help");
    char *buf = xmalloc(strlen(hdir)+strlen(name)+20);
    if (! text_option_seen && ! man_option_seen && probe_domterm(true) > 0) {
        sprintf(buf, "%s/%s.html", hdir, name);
        FILE *rfile = fopen(buf, "r");
        if (rfile == NULL)
            goto err;
        copy_html_file(rfile, out);
        return;
    }
    sprintf(buf, "%s/%s.txt", hdir, name);
    FILE *rfile = fopen(buf, "r");
    if (rfile == NULL)
        goto err;
    copy_file(rfile, out);
    fclose(rfile);
    return;
  err:
    fprintf(out, "cannot find help file %s\n", buf);
}

void print_help(FILE* out) {
  print_help_file("domterm", out);
}

int help_action(int argc, char** argv, const char*cwd,
                char **env, struct lws *wsi, struct options *opts)
{
    int ecode = EXIT_SUCCESS;
    char *topic = NULL;
    for (int argi = 1; argi < argc; argi++) {
        topic = argv[argi];
        if (strcmp(topic, "--html") == 0)
            html_option_seen = true;
        else if (strcmp(topic, "--man") == 0)
            man_option_seen = true;
        else if (strcmp(topic, "--text") == 0)
            text_option_seen = true;
        else if (strcmp(topic, "--pager") == 0)
            pager_option = ""; // FUTURE maybe allow --pager=xxx
        else if (strcmp(topic, "--no-pager") == 0)
            pager_option = NULL;
        else if (topic[0] == '-' && topic[1] == '-') {
            FILE *err = fdopen(opts->fd_err, "w");
            fprintf(err, "unknown help option '%s'\n", topic);
            fclose(err);
            return EXIT_FAILURE;
        }
        else
          break;
    }
    FILE *out = fdopen(opts->fd_out, "w");
    if (topic != NULL) {
      struct help_info *p = help_table;
      for (; ; p++) {
        if (p->command == NULL) {
          fprintf(out, "unknown help topic '%s'\n", topic);
          ecode = EXIT_FAILURE;
          break;
        }
        if (strcmp(topic, p->command) == 0) {
          const char *h = p->help;
          if (*h == '*')
            print_help_file(h+1, out);
          else
            fputs(h, out);
          break;
        }
      }
    } else {
      print_help(out);
    }
    fclose(out);
    return ecode;
}
