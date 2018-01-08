#include "server.h"
#include "version.h"

struct help_info {
  const char *command;
  const char *help;
};

static char attach_help[] = "Usage: domterm attach session-specifier\n";

static char is_domterm_help[] = "Usage: domterm is-domterm\n"
    "Succeeds if running on a DomTerm terminal; fails otherwise.\n"
    "Typical shell usage: if domterm is-domterm; then ...; fi\n";

static char html_help[] = "Usage: domterm html html-data...\n"
  "Each 'html-data' must be a well-formed HTML fragment\n"
  "If there are no arguments, read html from standard input\n";

static char list_help[] = "Usage: domterm list\n"
  "List sessions running under current server.\n";

static char new_help[] = "Usage: domterm [options] new [command [arguments]\n"
  "Run executable 'command' with given 'arguments'.\n";

static char browse_help[] = "Usage: domterm [options] browse url\n"
  "Open the given url in a specified (sub-)window.\n";

struct help_info help_table[] = {
  { "attach", attach_help},
  { "browse", browse_help},
  { "html", html_help},
  { "hcat", html_help},
  { "window-specifier", "*window-specifier" },
  { "image", "*imgcat"},
  { "imgcat", "*imgcat"},
  { "is-domterm", is_domterm_help},
  { "list", list_help},
  { "new", new_help},
  { "domterm", "*domterm"},
  { "qtdomterm", "*qtdomterm"},
  { NULL, NULL }
};

void print_help_file(const char* name, FILE *out)
{
    char *hdir = get_bin_relative_path(DOMTERM_DIR_RELATIVE "/help");
    char *buf = xmalloc(strlen(hdir)+strlen(name)+20);
    if (probe_domterm(true) > 0) {
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
    FILE *out = fdopen(opts->fd_out, "w");
    int ecode = EXIT_SUCCESS;
    if (argc >= 2) {
      char *topic = argv[1];
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
