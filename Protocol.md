# Wire byte protocol

DomTerm mostly handles standard ansi/xterm escape sequences.

The following are preliminary code sequences,
which may change based on experience and feedback.

## Special sequences sent by client and handled by DomTerm

`ESC ] 72 ; html-text ^G`
Insert HTML text.

`ESC ] 74 ; KEY ^G`
Simulate pressening KEY.  Used by auto-line mode.

`ESC [ 12 u`
Start of error output.

`ESC [ 11 u`
End of error output.

## Special sequences sent by DomTerm to client

`0x92 NAME SP DATA '\n'`
General format for reporting events.

`0x92 "WS " ROWS " " COLS " " HEIGHT " " WIDTH "\n"`
Report window size from DomTerm to the client.

`0x92 "KEY " KCODE " " KCHARS "\n"`
Used by auto-line mode to report a key event to client.
KCODE is a numeric key code. KCHARS is as string literal (JSON-formatted)
of the characters that are normally transmitted to the client.
In auto-line mode, if the pty is in canonical mode, then KEY
is returned to DomTerm (using \033]74;"+KEY+"\007");
otherwise KCHARS are sent to the pty.

