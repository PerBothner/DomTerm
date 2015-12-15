package org.domterm;

import org.domterm.util.Util;
import org.domterm.util.WTDebug;
import java.io.*;

/** Wraps a Java Process object.
 * Communicates with the Process using streams (pipes),
 * hence no Console (TTY) is available.
 */

public class ProcessClient extends Client {
    Process process;
    private Writer pin;
    Reader pout;
    Reader perr;
 
    public static String[] defaultCommandWithArgs
        = {"bash", "--noediting", "-i" };

    public ProcessClient() throws java.lang.Exception {
        this(defaultCommandWithArgs);
    }

    public ProcessClient(String[] commandWithArgs) throws java.lang.Exception {
        if (commandWithArgs.length == 0)
            commandWithArgs = defaultCommandWithArgs;
        ProcessBuilder pbuilder = new ProcessBuilder(commandWithArgs);
        java.util.Map<String, String> env = pbuilder.environment();
        env.put("TERM", "domterm");
        String dir = System.getProperty("user.dir");
        if (dir != null)
            env.put("TERMINFO", dir+"/");
        process = pbuilder.start();
        pin = new OutputStreamWriter(process.getOutputStream());
        pout = new InputStreamReader(process.getInputStream());
        perr = new InputStreamReader(process.getErrorStream());
        lineEditingMode = 'p';
    }

    public void run(Writer out) throws Exception {
        this.termWriter = out;
        sendInputMode(lineEditingMode);
        Util.copyThread(pout, false, out);
        Util.copyThread(perr, true, out);
    }

    public void processInputCharacters(String text) {
        try {
            WTDebug.println("PC.processInputCharacters: '"+WTDebug.toQuoted(text)+"'");
            if (text.length() == 0)
                return;
            text = text.replaceAll("\r", "\n");
            pin.write(text);
            pin.flush();
        } catch (Throwable ex) {
            ex.printStackTrace();
            System.exit(-1);
        } 
    }
}
