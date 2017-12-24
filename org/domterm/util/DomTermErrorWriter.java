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
    public static final char[] START_ERR_MARKER = {
        19, // urgent-begin
        21, // urgent-counted
        27, // escape
        (byte) '[',
        (byte) '1',
        (byte) '2',
        (byte) 'u',
        20 // urgent-end
    };
    public static final char[] END_ERR_MARKER = {
        19, // urgent-begin
        21, // urgent-counted
        27, // escape
        (byte) '[',
        (byte) '1',
        (byte) '1',
        (byte) 'u',
        20 // urgent-end
    };

    public DomTermErrorWriter(Writer out) {
        super(out);
    }

    @Override
    public void write(char buf[], int off, int len) throws IOException {
        while (len > 0) {
            int i;
            for (i = 0; i < len; i++) {
                char b = buf[off+i];
                if (b == '\r' || b == '\n') {
                    break;
                }
            }
            synchronized (out) {
                if (i == 0) {
                    i = 1;
                    if (len >= 2 && buf[off] == '\r'
                        && buf[off+1] == '\n')
                        i = 2;
                    out.write(buf, off, i);
                } else {
                    out.write(START_ERR_MARKER, 0, START_ERR_MARKER.length);
                    out.write(buf, off, i);
                    out.write(END_ERR_MARKER, 0, END_ERR_MARKER.length);
                }
                out.flush();
            }
            off += i;
            len -= i;
        }
    }

}
