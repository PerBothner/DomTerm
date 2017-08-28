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
        if (terminal != null)
            terminal.insertOutput(str);
    }

    @Override
    public void close() throws IOException {
        super.close();
        WebTerminal t = terminal;
        terminal = null;
        if (t != null)
            t.close();
    }
}
