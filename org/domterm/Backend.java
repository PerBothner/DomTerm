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
    static int counter;
    static synchronized int incrementCounter() { return ++counter; }

    public char lineEditingMode = 'a';
    protected void sendInputMode(char mode) throws Exception {
        termWriter.write("\033[80;"+((int)mode)+"u");
    }

    protected void setAutomaticNewline(boolean v) throws Exception {
        termWriter.write(v ? "\033[20h" : "\033[20l");
    }
    public void sendSessionName() throws Exception {
        sendSessionName(generateSessionName());
    }
    protected void sendSessionName(String name) throws Exception {
        termWriter.write("\033]30;"+name+"\007");
    }
    protected String generateSessionName() {
        return "domterm-"+incrementCounter();
    }

    public boolean isCanonicalMode() { return true; }
    public boolean isEchoingMode() { return true; }

    public void reportEvent(String name, String str) {
        if (name.equals("KEY")) {
            int q = str.indexOf('"');
            String kstr = Util.parseSimpleJsonString(str, q, str.length());
            if (termWriter != null && isCanonicalMode()
                && (kstr.length() != 1
                    || (kstr.charAt(0) != 3 && kstr.charAt(0) != 4))) {
                try {
                    int cmd = isEchoingMode() ? 74 : 73;
                    termWriter.write("\033]"+cmd+";"+str+"\007");
                } catch (IOException ex) {
                    if (verbosity > 0)
                        System.err.println("Backend caught "+ex);        
                }
            } else {
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
                final URI furi = uri;
                // Need to run Desktop.browse in a separate thread
                // if we're running in a JavaFX thread.  That appears to be
                // a JavaFX bug, but this seems a harmless workaround.
                (new Thread() {
                    public void run() {
                        try {
                            Desktop.getDesktop().browse(furi);
                        } catch (Throwable ex) {
                            ex.printStackTrace();
                        }
                    }
                    }).start();
            }
        } else if ("VERSION".equals(name)) {
            addVersionInfo(str);
        } else if ("GET-HTML".equals(name)) {
            System.err.println("GET-HTML: "+str);
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
