package org.domterm;

import java.io.Writer;

public abstract class Client {
    public int verbosity = 0;

    public abstract void reportEvent(String name, String str);
    public abstract void processInputCharacters(String text);

    public abstract void run(Writer out);

    public void setWindowSize(int nrows, int ncols, int pixw, int pixh) {
    }
}
