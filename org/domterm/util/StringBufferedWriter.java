package org.domterm.util;

import java.io.*;

public abstract class StringBufferedWriter extends Writer {
    StringBuilder sbuf = new StringBuilder();
    protected boolean autoflush = true;

    public StringBufferedWriter(boolean autoflush) {
        this.autoflush = autoflush;
    }

    public synchronized void write(char[] buffer, int start, int len)
        throws IOException {
        sbuf.append(buffer, start, len);
        if (autoflush)
            flush();
    }

    public synchronized void write(int ch) throws IOException {
        sbuf.append((char) ch);
        if (autoflush && ch == '\n')
            flush();
    }

    public synchronized void write(String str)
        throws IOException {
        if (sbuf.length() > 0) {
            sbuf.append(str);
            if (autoflush)
                flush();
        } else
            writeRaw(str);
    }

    protected abstract void writeRaw(String str) throws IOException;

    public synchronized void flush() throws IOException {
        if (sbuf.length() > 0) {
            writeRaw(sbuf.toString());
            sbuf.setLength(0);
        }
    }
    public void close() throws IOException {
        flush();
    }
}
