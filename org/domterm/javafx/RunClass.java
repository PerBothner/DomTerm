package org.domterm.javafx;

import org.domterm.*;
import javafx.application.Application;

public class RunClass extends WebTerminalApp
{
    protected Backend makeClient() throws java.lang.Exception {
        if (mainClient != null)
            return mainClient;
        return new ClassBackend(getParameters().getRaw());
    }

    public static void main(String[] args) throws Throwable {
        org.domterm.util.WTDebug.init();
        String[] restArgs = new String[args.length-1];
        System.arraycopy(args, 1, restArgs, 0, restArgs.length);
        mainClient = new ClassBackend(args[0], restArgs);
        exitOnStop = true;
        Application.launch(args);
    }
}
