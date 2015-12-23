package org.domterm.javafx;

import org.domterm.*;
import org.domterm.pty.*;
import java.lang.reflect.Method;
import javafx.application.Application;

public class Main {
    public static void usage() {
        System.err.println("--class classname arg ...");
        System.err.println("--process [command arg ...]");
        System.err.println("--pty [command arg ...]");
    }
    public static void usage(String msg) {
        System.err.print("error in org.domterm.javafx.Main: ");
        System.err.println(msg);
        usage();
        System.exit(-1);
    }
    static Backend mainClient;
    protected Backend makeClient() throws java.lang.Exception {
        return mainClient;
    }
    public static void main(String[] args) {
        char mode = ' ';
        int i = 0;
        for (; i < args.length; i++) {
            String arg = args[i];
            if (arg.equals("--class")) {
                //System.err.println("arg:"+arg+" i:"+i+" len:"+args.length);
                if (i + 1 == args.length)
                    usage("missing class name");
                Method method = null;
                try {
                    method = ClassBackend.getMainMethod(args[i+1]);
                } catch (Throwable ex) {
                    usage("caught "+ex);
                }
                System.err.println("found method "+method);
                String[] restArgs = new String[args.length-i-2];
                System.arraycopy(args, i+2, restArgs, 0, restArgs.length);
                mainClient = new ClassBackend(method, restArgs);
                break;
            } else if (arg.equals("--pty"))
                mode = 'T';
            else if (arg.equals("--shell") || arg.equals("--process"))
                mode = 'S';
            else if (arg.length() == 0 || arg.charAt(0) == '-')
                usage("unknown argument '"+arg+"'");
            else
                break;
        }
        if (mainClient == null) {
            String[] restArgs = new String[args.length-i];
            System.arraycopy(args, i, restArgs, 0, restArgs.length);
            if (mode == 'T' || mode == ' ') {
                try {
                    PTY.checkLoaded();
                    mode = 'T';
                } catch (Throwable ex) {
                    if (mode == ' ') {
                        mode = 'S';
                        System.err.println("(no pty in java.library.path - using --process)");
                    } else
                        usage("caught "+ex);
                }
            }
            try {
                if (mode == 'S')
                    mainClient = new ProcessBackend(restArgs);
                else
                    mainClient = new PtyBackend(restArgs);
             } catch (Throwable ex) {
                 usage("caught "+ex);
             }
        }

        org.domterm.util.WTDebug.init();
        try {
            WebTerminalApp.exitOnStop = true;
            WebTerminalApp.mainClient = mainClient;
        } catch (Throwable ex) {
            usage("JavaFX or WebEngine classes not found");
        }
        Application.launch(WebTerminalApp.class, args);
    }
}
