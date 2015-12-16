package org.domterm;

import org.domterm.util.*;
import java.lang.reflect.Method;
import java.io.*;
import java.util.List;

public class ClassClient extends Client {

    Method methodToRun;
    String[] restArgs;
    Writer pin;

    public ClassClient(String className, String[] restArgs) throws Exception {
        this(getMainMethod(className), restArgs);
    }

     public ClassClient(Method methodToRun, String[] restArgs) {
        this.methodToRun = methodToRun;
        this.restArgs = restArgs;
        lineEditingMode = 'l';
    }

   public ClassClient(List<String> args) throws Exception {
        this.methodToRun = getMainMethod(args.get(0));
        int nargs = args.size();
        this.restArgs = new String[nargs-1];
        args.subList(1, nargs).toArray(this.restArgs);
    }

    public static Method getMainMethod(String className) throws Exception {
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        Class clas = Class.forName(className, false, loader);
        return clas.getDeclaredMethod("main", String[].class);
    }

    public void run(Writer out) throws Exception {
        this.termWriter = out;
        sendInputMode('p');
        addVersionInfo("ClassClient;err-handled");
        OutputStream outs = new Utf8WriterOutputStream(out);
        PrintStream outp = new PrintStream(new BufferedOutputStream(outs, 128), true);
        System.setOut(outp);
        ErrorPrintStream.setSystemErr();

        try {
            PipedOutputStream inputSink = new PipedOutputStream();
            pin = new OutputStreamWriter(inputSink);
            System.setIn(new PipedInputStream(inputSink));
        } catch (Throwable ex) {
            throw new RuntimeException(ex);
        }
        try {
            System.setProperty("org.domterm", getVersionInfo());
        } catch (Throwable ex) {
            ex.printStackTrace();
        }

        (new Thread() {
                public void run() {
                    try {
                        methodToRun.invoke(null, new Object[] { restArgs });
                    } catch (Throwable ex) {
                        WTDebug.println("caught while executing main "+ex);
                    }
                }}).start();
    }

    public void processInputCharacters(String text) {
        try {
            //WTDebug.println("processInputCharacters '"+WTDebug.toQuoted(text)+"'");
            pin.write(text.replaceAll("\r", "\n"));
            pin.flush();
        } catch (Throwable ex) {
            ex.printStackTrace();
            System.exit(-1);
        } 
    }
}

