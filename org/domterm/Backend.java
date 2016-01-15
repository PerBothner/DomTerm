package org.domterm;

import org.domterm.util.Util;
import java.awt.Desktop;
import java.io.*;
import java.net.URI;
import java.net.URISyntaxException;


/** Encapsulates a back-end (inferior) and how we communicate with it.
 * Does not encapsulate a front-end (GUI or browser) or transport layer.
 */

public abstract class Backend {
    public int verbosity = 0;

    public String versionInfo;

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
                        System.err.println("PtyBackend caught "+ex);        
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
        } else if ("ALINK".equals(name)) {
            int q = str.indexOf('"');
            String href = Util.parseSimpleJsonString(str, q, str.length());
            if (Desktop.isDesktopSupported()) {
                URI uri;
                try {
                    uri = new URI(href);
                } catch (URISyntaxException ex) {
                    // FIXME should do better
                    uri = URI.create("http:invalid-URI-syntax-in-link");
                }
                try {
                    Desktop.getDesktop().browse(uri);
                } catch (Throwable ex) {
                    // ???
                }
            }
        } else if ("VERSION".equals(name)) {
            addVersionInfo(str);
        }
    }

    public synchronized String getVersionInfo() { return versionInfo; }

    public synchronized void addVersionInfo(String str) {
        versionInfo = versionInfo == null || versionInfo.length() == 0 ? str
            : versionInfo + ";" + str;
    }

    public abstract void processInputCharacters(String text);

    /** Characters written here call terminal.js's insertString method.
     * Each write method should be synchronized (on the termWriter),
     * so different messages don't appear out of order.
     */
    protected Writer termWriter;

    /** Initialize and run this back-end.
     * @param out used to initialize termWriter - see note there.
     */
    public abstract void run(Writer out) throws Exception;

    public void setWindowSize(int nrows, int ncols, int pixw, int pixh) {
    }
}
