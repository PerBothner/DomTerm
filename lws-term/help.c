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
  { "image", "*imgcat"},
  { "imgcat", "*imgcat"},
  { "is-domterm", is_domterm_help},
  { "list", list_help},
  { "new", new_help},
  { "domterm", "*domterm"},
  { "qtdomterm", "*qtdomterm"},
  { NULL, NULL }
};

void print_help(FILE* out) {
    fprintf(out,
            "domterm is a terminal emulator/multipler that uses web technologies\n\n"
            "USAGE:\n"
            "    domterm [options] [<command> [<arguments...>]]\n\n"
            "COMMANDS:\n"
            "Sessions\n"
            "  [window-specifer] [new] [program [args] - new terminal\n"
            "  [window-specifer] [attach] session-specifier - (re-)attach session\n"
            "Miscellaneous subcommands:\n"
            "  help [subcommand]\n"
            "  [window-specifer] browse URL - open browser in new windowL\n"
            "  is-domterm - succeeds if running under DomTerm\n"
            "Subcommands for output:"
            "  html [or hcat] - display htmll]\n"
            "  image [or imgcat] - display imagel\n"
            "  fresh-line - if not at beginning of line, starts a fresh line\n"
            "Subcommands for styling:\n"
            "  reverse-video on|off - switch between dark or light background\n"
            "  add-style - add a new rule to a temporary stylesheet\n"
            "  load-stylesheet - load new stylesheet from a file\n"
            "  list-stylesheets - list loaded stylesheets\n"
            "  print-stylesheet - print stylesheet rules from a loaded stylesheet\n"
            "  disable-stylesheet - disable a stylesheet\n"
            "  enable-stylesheet - enable a stylesheet\n"

            "OPTIONS:\n"
            "    --browser[=command]     Create browser window for terminal.\n"
            "                            The command can have a '%U' which is replaced by a URL; otherwise ' %U' is append to the command,\n"
            "                            If no command specified, uses default browser\n"
#if 0
            "    --port, -p              Port to listen (default: '0' for random port)\n"
            "    --interface, -i         Network interface to bind (eg: eth0), or UNIX domain socket path (eg: /var/run/ttyd.sock)\n"
            "    --credential, -c        Credential for Basic Authentication (format: username:password)\n"
            "    --uid, -u               User id to run with\n"
            "    --gid, -g               Group id to run with\n"
            "    --signal, -s            Signal to send to the command when exit it (default: SIGHUP)\n"
            "    --reconnect, -r         Time to reconnect for the client in seconds (default: 10)\n"
            "    --readonly, -R          Do not allow clients to write to the TTY\n"
            "    --client-option, -t     Send option to client (format: key=value), repeat to add more options\n"
            "    --check-origin, -O      Do not allow websocket connection from different origin\n"
            "    --once, -o              Accept only one client and exit on disconnection\n"
            "    --index, -I             Custom index.html path\n"
            "    --ssl, -S               Enable SSL\n"
            "    --ssl-cert, -C          SSL certificate file path\n"
            "    --ssl-key, -K           SSL key file path\n"
            "    --ssl-ca, -A            SSL CA file path for client certificate verification\n"
            "    --debug, -d             Set log level (0-9, default: 0)\n"
#endif
            "    --version, -v           Print the version and exit\n"
            "    --help, -h              Print this text and exit\n"
            "If no --port option is specified, --browser is implied.\n"
            "VERSION:\n"
            "    %s\n\n",
            LDOMTERM_VERSION
    );
}

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
    sprintf(buf, "%s/%s.rst", hdir, name);
    FILE *rfile = fopen(buf, "r");
    if (rfile == NULL)
        goto err;
    copy_file(rfile, out);
    fclose(rfile);
    return;
  err:
    fprintf(out, "cannot find help file %s\n", buf);
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
