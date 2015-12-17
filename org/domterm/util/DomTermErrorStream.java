package org.domterm.util;

import java.io.*;

/** The standard error stream, when running under DomTerm.
 * This forwards to another stream (normally System.out),
 * but surrounds each write with special escape sequences.
 * These cause DomTerm to place the error output inside
 * a {@code <span std="err">} element, which by default
 * is colored red.
 */

public class DomTermErrorStream extends PrintStream {
    public static final byte[] START_ERR_MARKER = {
        27 /* escape */,
        (byte) '[',
        (byte) '1',
        (byte) '2',
        (byte) 'u'
    };
    public static final byte[] END_ERR_MARKER = {
        27 /* escape */,
        (byte) '[',
        (byte) '1',
        (byte) '1',
        (byte) 'u'
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
            out.write(START_ERR_MARKER, 0, START_ERR_MARKER.length);
            out.write(b);
            out.write(END_ERR_MARKER, 0, END_ERR_MARKER.length);
            if (b == '\n')
                out.flush();
        }
    }

    @Override
    public void write(byte buf[], int off, int len) {
        synchronized (out) {
            out.write(START_ERR_MARKER, 0, START_ERR_MARKER.length);
            out.write(buf, off, len);
            out.write(END_ERR_MARKER, 0, END_ERR_MARKER.length);
            out.flush();
        }
    }
}
