package org.domterm.javafx;

import org.domterm.*;
import java.util.List;
import javafx.application.Application;

public class RunClass extends WebTerminalApp
{
    static Client mainClient;
    protected Client makeClient() throws java.lang.Exception {
        if (mainClient != null)
            return mainClient;
        return new ClassClient(getParameters().getRaw());
    }

    public static void main(String[] args) throws Throwable {
        org.domterm.util.WTDebug.init();
        String[] restArgs = new String[args.length-1];
        System.arraycopy(args, 1, restArgs, 0, restArgs.length);
        mainClient = new ClassClient(args[0], restArgs);
        exitOnStop = true;
        Application.launch(args);
    }
}
