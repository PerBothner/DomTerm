package webterminal;

public abstract class Client {
    public int verbosity = 1;

    public abstract void reportEvent(String name, String str);
    public abstract void processInputCharacters(String text);

    public abstract void run(WebWriter out);

    public void setWindowSize(int nrows, int ncols, int pixw, int pixh) {
    }
}
