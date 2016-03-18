package org.domterm.util;
import java.io.*;

public final class Util {

    private Util() {}

    public static final int ESCAPE = 27;

    public static final char[] EOF_MARKER = {
        ESCAPE, '[', '9', '9', ';', '9', '9', 'u'
    };

    public static void copyThread(Reader fromInferior,
                                  boolean errStream,
                                  Writer out) {
        if (errStream)
            out = new DomTermErrorWriter(out);
        copyThread(fromInferior, out);
    }

    public static void copyThread(final Reader fromInferior,
                                  final Writer out) {
        Thread th = new Thread() {
                char[] buffer = new char[1024];
                public void run () {
                    //WTDebug.println("copyThread start to:"+out.getClass().getName());
                    for (;;) {
                        try {
                            int count = fromInferior.read(buffer);
                            if (count < 0) {
                                out.write(EOF_MARKER, 0,
                                          EOF_MARKER.length);
                                break;
                            }
                            //WTDebug.println("copyThread "+count+": "+WTDebug.toQuoted(new String(buffer,0,count)));
                            out.write(buffer, 0, count);
                        } catch (Throwable ex) {
                            ex.printStackTrace();
                            System.exit(-1);
                        }
                    }
                }
            };
        th.start();
    }

    public static String toJson(String str) {
        int len = str.length();
        StringBuilder buf = new StringBuilder();
        buf.append('\"');
        for (int i = 0;  i < len;  i++) {
            char ch = str.charAt(i);
            if (ch == '\n')
                buf.append("\\n");
            else if (ch == '\r')
                buf.append("\\r");
            else if (ch == '\t')
                buf.append("\\t");
            else if (ch == '\b')
                buf.append("\\b");
            else if (ch < ' ' || ch >= 127) {
                String hex = Integer.toHexString((int) ch);
                int slen = hex.length();
                if (slen == 1) hex = "000" + hex;
                else if (slen == 2) hex = "00" + hex;
                else if (slen == 3) hex = "0" + hex;
                buf.append("\\u");
                buf.append(hex);
            } else {
                if (ch == '\"' || ch == '\\')
                    buf.append('\\');
                buf.append(ch);
            }
        }
        buf.append('\"');
        return buf.toString();
    }

    /** Parse a string formatted using JSON.stringify */
    public static String parseSimpleJsonString(String str, int start, int end) {
        return parseSimpleJsonString(str, start, end, null);
    }

    /** Parse a string formatted using JSON.stringify */
    public static String parseSimpleJsonString(String str, int start, int end,
                                               int[] endPointer) {
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
            if (ch == ch0) {
                if (endPointer != null)
                    endPointer[0] = i;
                break;
            }
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
