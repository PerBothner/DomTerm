package org.domterm.util;

import java.io.*;

/** The standard error Writer when running under DomTerm.
 * This forwards to another Writer (used for standard output),
 * but surrounds each write with special escape sequences.
 * These cause DomTerm to place the error output inside
 * a {@code <span std="err">} element, which by default
 * is colored red.
 *
 * Similar to DomTermErrorStream, but at the character level
 */

public class DomTermErrorWriter extends FilterWriter {
    public static final int ESCAPE = 27;

    public static final char[] START_ERR_MARKER = {
        ESCAPE, '[', '1', '2', 'u'
    };
    public static final char[] END_ERR_MARKER = {
        ESCAPE, '[', '1', '1', 'u'
    };
    public static final char[] EOF_MARKER = {
        ESCAPE, '[', '9', '9', ';', '9', '9', 'u'
    };

    public DomTermErrorWriter(Writer out) {
        super(out);
    }

    @Override
    public void write(char cbuf[], int off, int len) throws IOException {
        synchronized (out) {
            out.write(START_ERR_MARKER, 0, START_ERR_MARKER.length);
            out.write(cbuf, off, len);
            out.write(END_ERR_MARKER, 0, END_ERR_MARKER.length);
        }
    }

}
