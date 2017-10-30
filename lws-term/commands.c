#include "server.h"
#include <stdlib.h>

struct lws;

int is_domterm_action(int argc, char** argv, const char*cwd,
                      char **env, struct lws *wsi, int replyfd,
                      struct options *opts)
{
    return probe_domterm() > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}

int html_action(int argc, char** argv, const char*cwd,
                      char **env, struct lws *wsi, int replyfd,
                      struct options *opts)
{
    check_domterm(opts);
    int i = optind + 1;
    if (i == argc) {
        char buffer[1024];
        fprintf(stdout, "\033]72;");
        for (;;) {
            int r = fread(buffer, 1, sizeof(buffer), stdin);
            if (r <= 0 || fwrite(buffer, 1, r, stdout) <= 0)
                break;
        }
        fprintf(stdout, "\007");
    } else {
        while (i < argc)  {
            fprintf(stdout, "\033]72;%s\007", argv[i++]);
        }
    }
    fflush(stderr);
    return EXIT_SUCCESS;
}

struct command commands[] = {
  { .name = "is-domterm",
    .options = COMMAND_IN_CLIENT,
    .action = is_domterm_action },
  { .name ="html",
    .options = COMMAND_IN_CLIENT,
    .action = html_action },
  { .name ="hcat",
    .options = COMMAND_IN_CLIENT|COMMAND_ALIAS },
  { .name = "attach", .options = COMMAND_IN_SERVER,
    .action = attach_action},
  { .name = "browse", .options = COMMAND_IN_SERVER,
    .action = browse_action},
  { .name = "list",
    .options = COMMAND_IN_CLIENT_IF_NO_SERVER|COMMAND_IN_SERVER,
    .action = list_action },
  { .name = "help",
    .options = COMMAND_IN_CLIENT,
    .action = help_action },
  { .name = "new", .options = COMMAND_IN_SERVER,
    .action = new_action},
  { .name = 0 }
  };

struct command *
find_command(const char *name)
{
    struct command *cmd = &commands[0];
    for (; ; cmd++) {
        if (cmd->name == NULL)
            return NULL;
        if (strcmp(cmd->name, name) == 0)
            break;
    }
    while ((cmd->options & COMMAND_ALIAS) != 0)
        cmd--;
    return cmd;
}

