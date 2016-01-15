package org.domterm.util;
import java.io.*;

public class Util {

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

    public static void copyThread(final Reader fromInferior,
                                  final boolean errStream,
                                  final Writer out) {
        Thread th = new Thread() {
                char[] buffer = new char[1024];
                public void run () {
                    //WTDebug.println("copyThread start err:"+errStream+" to:"+out.getClass().getName());
                    for (;;) {
                        try {
                            int count = fromInferior.read(buffer);
                            if (count < 0) {
                                out.write(EOF_MARKER, 0,
                                          EOF_MARKER.length);
                                break;
                            }
                            //WTDebug.println("copyThread "+count+": "+WTDebug.toQuoted(new String(buffer,0,count))+" err:"+errStream);
                            if (errStream) {
                                synchronized (out) {
                                    out.write(START_ERR_MARKER, 0,
                                              START_ERR_MARKER.length);
                                    out.write(buffer, 0, count);
                                    out.write(END_ERR_MARKER, 0,
                                              END_ERR_MARKER.length);
                                }
                            } else {
                                out.write(buffer, 0, count);
                            }
                        } catch (Throwable ex) {
                            ex.printStackTrace();
                            System.exit(-1);
                        }
                    }
                }
            };
        th.start();
    }

    /** Parse a string formatted using JSON.stringify */
    public static String parseSimpleJsonString(String str, int start, int end) {
        StringBuilder buf = new StringBuilder();
        char ch0 = 0;
        int i = start;
        for (;;) {
            if (i >= end)
                return null;
            ch0 = str.charAt(i++);
            if (ch0 == '"' || ch0 == '\'')
                break;
            if (! Character.isWhitespace(ch0))
                return null;
        }
        for (; i < end; ) {
            char ch = str.charAt(i++);
            if (ch == ch0)
                break;
            if (ch == '\\') {
                if (i == end)
                    return null;
                ch = str.charAt(i++);
                switch (ch) {
                case 'b': ch = '\b'; break;
                case 'f': ch = '\f'; break;
                case 't': ch = '\t'; break;
                case 'n': ch = '\n'; break;
                case 'r': ch = '\r'; break;
                case '\\':
                case '\'':
                case '\"':
                    break;
                case 'u':
                    if (i + 4 > end)
                        return null;
                    ch = 0;
                    for (int j = 0; j < 4; j++) {
                        int d = Character.digit(str.charAt(i++), 16);
                        if (d < 0)
                            return null;
                        ch = (char) ((ch << 4) + d);
                    }
                }
            }
            buf.append(ch);
        }
        return buf.toString();
    }
}
