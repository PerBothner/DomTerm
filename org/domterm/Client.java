package org.domterm;

import org.domterm.util.WTDebug;
import org.domterm.util.Util;
import java.io.*;

/** Encapsulates a client (inferior) and how we communicate with it.
 * Does not encapsulate a front-end (GUI or browser) or transport layer.
 */

public abstract class Client {
    public int verbosity = 0;

    public char lineEditingMode = 'a';
    protected void sendInputMode(char mode) throws Exception {
        termWriter.write("\033[20;"+((int)mode)+"u");
    }

    public boolean isCanonicalMode() { return true; }

    public void reportEvent(String name, String str) {
        if (name.equals("KEY")) {
            if (termWriter != null && isCanonicalMode()) {
                try {
                    termWriter.write("\033]74;"+str+"\007");
                } catch (IOException ex) {
                    if (verbosity > 0)
                        System.err.println("PtyClient caught "+ex);        
                }
            } else {
                int q = str.indexOf('"');
                String kstr = Util.parseSimpleJsonString(str, q, str.length());
                processInputCharacters(kstr);
            }
        } else if ("WS".equals(name)) {
            String[] words = str.split("  *");
            try {
                int i1 = Integer.parseInt(words[0]);
                int i2 = Integer.parseInt(words[1]);
                int i3 = Integer.parseInt(words[2]);
                int i4 = Integer.parseInt(words[3]);
                setWindowSize(i1, i2, i3, i3);
            } catch (Throwable ex) {
                System.err.println("caught "+ex);
            }
        }
    }

    public abstract void processInputCharacters(String text);

    protected Writer termWriter;

    public abstract void run(Writer out) throws Exception;

    public void setWindowSize(int nrows, int ncols, int pixw, int pixh) {
        WTDebug.println("Cl.setWinSize");
    }
}
