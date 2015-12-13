package org.domterm.javafx;

import org.domterm.*;

import java.util.List;
import javafx.application.Application;

public class RunProcess extends WebTerminalApp
{
    protected Client makeClient() throws java.lang.Exception {
        List<String> args = getParameters().getRaw();
        return new ProcessClient(args.toArray(new String[args.size()]));
    }

    public static void main(String[] args) throws Throwable {
        exitOnStop = true;
        Application.launch(args);
    }
}

