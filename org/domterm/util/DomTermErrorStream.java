package org.domterm.util;

import java.io.*;

/** The standard error stream, when running under DomTerm.
 * This forwards to another stream (normally System.out),
 * but surrounds each write with special escape sequences.
 * These cause DomTerm to place the error output inside
 * a {@code <span std="err">} element, which by default
 * is colored red.
 *
 * Similar to DomTermErrorWriter, but at the byte level
 */

public class DomTermErrorStream extends PrintStream {
    public static final byte[] START_ERR_MARKER = {
        19, // urgent-begin
        21, // urgent-counted
        27, // escape
        (byte) '[',
        (byte) '1',
        (byte) '2',
        (byte) 'u',
        20 // urgent-end
    };
    public static final byte[] END_ERR_MARKER = {
        19, // urgent-begin
        21, // urgent-counted
        27, // escape
        (byte) '[',
        (byte) '1',
        (byte) '1',
        (byte) 'u',
        20 // urgent-end
    };
    private PrintStream out;

    public DomTermErrorStream(PrintStream out) {
        super(out, true);
        this.out = out;
    }

    public static void setSystemErr() {
        if (! (System.err instanceof DomTermErrorStream))
            System.setErr(new DomTermErrorStream(System.out));
    }

    @Override
    public void write(int b) {
        synchronized (out) {
            boolean escape = b != '\r' && b != '\n';
            if (escape)
                out.write(START_ERR_MARKER, 0, START_ERR_MARKER.length);
            out.write(b);
            if (escape)
                out.write(END_ERR_MARKER, 0, END_ERR_MARKER.length);
            if (b == '\n')
                out.flush();
        }
    }

    @Override
    public void write(byte buf[], int off, int len) {
        while (len > 0) {
            int i;
            for (i = 0; i < len; i++) {
                byte b = buf[off+i];
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
