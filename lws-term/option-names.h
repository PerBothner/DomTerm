/*#define OPTION_NUMBER_TYPE*/
/*#define OPTION_MISC_TYPE*/
OPTION_S(browser_default, "browser.default", OPTION_MISC_TYPE)
OPTION_S(shell_command, "shell.default", OPTION_MISC_TYPE)
OPTION_S(command_firefox, "command.firefox", OPTION_MISC_TYPE)
OPTION_S(command_chrome, "command.chrome", OPTION_MISC_TYPE)
OPTION_S(command_electron, "command.electron", OPTION_MISC_TYPE)
OPTION_S(command_headless, "command.headless", OPTION_MISC_TYPE)
OPTION_S(command_ssh, "command.ssh", OPTION_MISC_TYPE)
OPTION_S(command_remote_domterm, "command.remote-domterm", OPTION_MISC_TYPE)
OPTION_S(command_get_clipboard, "command.get-clipboard", OPTION_MISC_TYPE)
OPTION_S(command_get_selection, "command.get-selection", OPTION_MISC_TYPE)
OPTION_S(window_geometry, "window.geometry", OPTION_MISC_TYPE)
OPTION_S(window_session_type, "window-session-type", OPTION_MISC_TYPE) // "x11" or "wayland"
OPTION_S(openfile_application, "open.file.application", OPTION_MISC_TYPE)
OPTION_S(openlink_application, "open.link.application", OPTION_MISC_TYPE)
OPTION_S(log_file, "log.file", OPTION_STRING_TYPE)
OPTION_S(titlebar, "titlebar", OPTION_STRING_TYPE)
OPTION_S(subwindows, "subwindows", OPTION_STRING_TYPE)
#if WITH_XTERMJS
OPTION_S(termimal, "xtermjs", OPTION_MISC_TYPE)
#endif

/* front-end options */
OPTION_F(style_user, "style.user", OPTION_MISC_TYPE)
OPTION_F(style_dark, "style.dark", OPTION_MISC_TYPE)
OPTION_F(color_background, "color.background", OPTION_MISC_TYPE)
OPTION_F(color_foreground, "color.foreground", OPTION_MISC_TYPE)
OPTION_F(color_cyan, "color.cyan", OPTION_MISC_TYPE)
OPTION_F(style_blink_rate, "style.blink-rate", OPTION_MISC_TYPE)
OPTION_F(style_caret, "style.caret", OPTION_MISC_TYPE)
OPTION_F(style_edit_caret, "style.edit-caret", OPTION_MISC_TYPE)
OPTION_F(style_qt, "style.qt", OPTION_MISC_TYPE)
OPTION_F(keymap_master, "keymap.master", OPTION_MISC_TYPE)
OPTION_F(keymap_line_edit, "keymap.line-edit", OPTION_MISC_TYPE)
OPTION_F(output_byte_by_byte, "output-byte-by-byte", OPTION_NUMBER_TYPE)
OPTION_F(debug_input_extra_delay, "debug.input.extra-delay", OPTION_NUMBER_TYPE)
OPTION_F(predicted_input_timeout, "predicted-input-timeout", OPTION_NUMBER_TYPE)
OPTION_F(history_storage_key, "history.storage-key", OPTION_STRING_TYPE)
OPTION_F(history_storage_max, "history.storage-max", OPTION_NUMBER_TYPE)
OPTION_F(password_hide_char, "password-hide-char", OPTION_STRING_TYPE)
OPTION_F(password_show_char_timeout, "password-show-char-timeout", OPTION_NUMBER_TYPE)
OPTION_F(terminal_minimum_width, "terminal.minimum-width", OPTION_NUMBER_TYPE)
OPTION_F(flow_confirm_each, "flow-confirm-every", OPTION_NUMBER_TYPE)
//OPTION_S(flow_max_unconfirmed, "flow-max-unconfired", OPTION_NUMBER_TYPE)
//OPTION_S(flow_max_continue, "flow-max-continue", OPTION_NUMBER_TYPE)
OPTION_F(log_js_verbosity, "log.js-verbosity", OPTION_MISC_TYPE)
OPTION_F(log_js_to_server, "log.js-to-server", OPTION_STRING_TYPE)
OPTION_F(log_js_string_max, "log.js-string-max", OPTION_MISC_TYPE)

/** Local browser sends input to remote server at least this frequently. */
OPTION_F(remote_input_interval, "remote-input-interval", OPTION_NUMBER_TYPE)
/** Remote server times out if no input received from browser by this time.
 * Defaults to 2 * remote-input-interval */
OPTION_F(remote_input_timeout, "remote-input-timeout", OPTION_NUMBER_TYPE)
/** Remote server sends output to browser this frequently, if non-zero.
 * Defaults to 10.0 (seconds). */
OPTION_F(remote_output_interval, "remote-output-interval", OPTION_NUMBER_TYPE)
/** Browser times out if no output received from remote server */
OPTION_F(remote_output_timeout, "remote-output-timeout", OPTION_NUMBER_TYPE)
OPTION_F(window_scale, "window-scale", OPTION_NUMBER_TYPE)
OPTION_F(pane_scale, "pane-scale", OPTION_NUMBER_TYPE)
