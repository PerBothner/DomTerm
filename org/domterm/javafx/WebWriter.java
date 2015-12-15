package org.domterm.javafx;

import org.domterm.util.StringBufferedWriter;
import java.io.IOException;

/** A Writer that inserts the written text into a WebTerminal.
 */

public class WebWriter extends StringBufferedWriter
{
    protected WebTerminal terminal;

    public WebWriter (WebTerminal terminal) {
        super(true);
        this.terminal = terminal;
    }

    protected void writeRaw(String str) throws IOException {
        terminal.insertOutput(str);
    }
}
