package org.domterm;

import java.awt.Desktop;
import java.io.*;
import java.util.*;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.net.URI;
import java.net.URL;
import java.net.URLConnection;

import org.domterm.*;
import org.domterm.util.StringBufferedWriter;
import org.domterm.util.WTDebug;
import org.domterm.pty.*;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/** A simple http server for DomTerm.
 * Includes a "main" method which starts the server, and
 * optionally starts a "front-end" (a browser).
 * Uses the com.sun.net.httpserver package.
 * Uses XMLHttpRequest ("ajax") instead of WebSockets.
 */

public class DomHttpServer implements HttpHandler {
    static int verbose = 0;
    Map<String,Session> sessionMap = new HashMap<String,Session>();
    Set<Backend> pendingBackends = new HashSet();

    public static int serverBacklog = 0;
    HttpServer httpServer;
    int port;
    Object endMonitor;

    String[] backendArgs;

    static class Session {
        String key;
        Backend backend;
        static int counter;
        ReplWriter termWriter;
        String pending = null;
        DomHttpServer server;
        // SSLSession // FIXME

        public Session(DomHttpServer server, HttpExchange exchange) {
            this.server = server;
            key = Integer.toString(++counter);
            backend = server.createBackend();
            server.sessionMap.put(key, this);
        }

	public void reportEvent(String name, String str) {
	    if (name.equals("RECEIVED")) {
		try {
		    int received = Integer.parseInt(str);
		    termWriter.updateConfirmed(received);
		} catch (Throwable ex) {
		}
	    } else
		backend.reportEvent(name, str);
	}

        public void close() {
            server.sessionMap.remove(key);
            backend.close(server.sessionMap.isEmpty());
            if (server.endMonitor != null) {
                synchronized (server.endMonitor) {
                    server.endMonitor.notifyAll();
                }
            } else if (runBrowser >= 0) {
                server.stop();
            }
        }
        public String toString() { return "Session-"+key; }
    }

    static class ReplWriter extends StringBufferedWriter {
        Session session;
        List<String> strings = new ArrayList<String>();
        int numChars = 0;
        boolean closed;
	int limit = 2000;
	public static final int MASK28 = 0xfffffff;
	int countWritten;
	int countConfirmed;

        ReplWriter(Session session) { super(true); this.session = session; }
 
        @Override
        protected synchronized void writeRaw(String str) throws IOException {
            strings.add(str);
	    int slen = str.length();
            numChars += slen;
	    countWritten = (countWritten + slen) & MASK28;
	    while (((countWritten - countConfirmed) & MASK28) > 3000) {
		try {
		    wait();
		} catch (InterruptedException ex) {
		}
	    }
        }

	public synchronized void updateConfirmed(int confirmed) {
	    countConfirmed = confirmed;
	    notifyAll();
	}

        public synchronized CharSequence removeStrings() {
            StringBuilder sbuf = new StringBuilder(numChars);
            int nstrings = strings.size();
            for (int i = 0; i < nstrings; i++)
                sbuf.append(strings.get(i));
            numChars = 0;
            strings.clear();
            return sbuf;
        }
        public void close() throws IOException {
            closed = true;
            if (session != null) {
                write("\033[99;99u");
                super.close();
                session = null;
            }
        }
     }

    public DomHttpServer(int port, String[] backendArgs)
        throws IOException, UnknownHostException {
        httpServer = HttpServer.create();
        httpServer.bind(new InetSocketAddress(port), serverBacklog);
        httpServer.setExecutor(null); // creates a default executor
        this.backendArgs = backendArgs;
        httpServer.createContext("/", this);
    }

    public static void setExitOnClose(boolean exitOnClose) {
        runBrowser = exitOnClose ? 0 : -1;
    }

    private static String readAll(InputStream in) throws IOException {
        byte[] buf = new byte[1024];
        int n = 0;
        for (;;) {
            int avail = buf.length-n;
            if (avail == 0) {
                byte[] tmp = new byte[(3*buf.length)>>1];
                System.arraycopy(buf, 0, tmp, 0, buf.length);
                buf = tmp;
                avail = buf.length-n;
            }
            int r = in.read(buf, n, avail);
            if (r <= 0)
                break;
            n += r;
        }
        return new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8);
    }
    private static String readAll(HttpExchange exchange) throws IOException {
        InputStream in = exchange.getRequestBody();
        String rtext = readAll(in);
        in.close();
        return rtext;

    }
    public void handle(HttpExchange exchange) throws IOException {
        URI uri = exchange.getRequestURI();
        String uris = uri.toString();
        Headers headers = exchange.getResponseHeaders();
        if ("/".equals(uris)) {
            uris = "/domterm/#ajax";
            headers.add("Location", uris);
            exchange.sendResponseHeaders(307, -1);
            return;
        }
        if (uris.startsWith("/domterm/")) {
            uris = uris.substring(8);
            if (uris.equals("/"))
                uris = "/repl-client.html";
            if ("/open.txt".equals(uris)) {
                String rtext = readAll(exchange);
                Session session = new Session(this, exchange);
                Backend backend = session.backend;
                if (rtext.startsWith("VERSION="))
                    backend.addVersionInfo(rtext.substring(8));
                backend.versionInfo = backend.versionInfo+";DomHttpServer";
                try {
                    session.termWriter = new ReplWriter(session);
                    backend.run(session.termWriter);
                    backend.sendSessionName();
                } catch (Throwable ex) {
                    ex.printStackTrace(); // FIXME
                }
                String msg = "key="+session.key;
                byte[] bmsg = msg.getBytes();
                exchange.sendResponseHeaders(200, bmsg.length);
                OutputStream out = exchange.getResponseBody();
                out.write(bmsg);
                out.close();
                return;
            }
            else if (uris.startsWith("/io-")) {
                String key = uris.substring(4);
                Session session = sessionMap.get(key);
                String rtext = readAll(exchange);
                Backend backend = session.backend;
                processInput(session, rtext);
                CharSequence output = session.termWriter.removeStrings();
                byte[] bytes = output.toString().getBytes();
                exchange.sendResponseHeaders(200, bytes.length);
                OutputStream out = exchange.getResponseBody();
                out.write(bytes);
                out.close();
                if (session.termWriter.closed)
                    session.close();
                return;
            } else if (uris.startsWith("/close-")) {
                String key = uris.substring(7);
                Session session = sessionMap.get(key);
                session.close();
            } else {
                URL url = getClass().getResource(uris);
                URLConnection connection;
                InputStream in;
                if (url != null
                    && (connection = url.openConnection()) != null
                    && (in = connection.getInputStream()) != null) {
                    int length = connection.getContentLength();
                    String type = connection.getContentType();
                    if (type == null || type.equals("content/unknown")) {
                        if (uris.endsWith(".js"))
                            type = "application/javascript";
                        else if (uris.endsWith(".css"))
                            type = "text/css";
                    }
                    headers.add("Content-Type", type);
                    exchange.sendResponseHeaders(200, length);
                    OutputStream out = exchange.getResponseBody();
                    byte[] buf = new byte[2048];
                    for (;;) {
                        int count = in.read(buf);
                        if (count < 0)
                            break;
                        out.write(buf, 0, count);
                    }
                    out.close();
                    return;
                }
            }
        }
        String msg = "The requested URL "+uris
            +" was not found on this server.\r\n";
        byte[] bmsg = msg.getBytes();
        exchange.sendResponseHeaders(404, bmsg.length);
        OutputStream out = exchange.getResponseBody();
        out.write(bmsg);
        out.close();
    }
    public void start() {
        httpServer.start();
        this.port = httpServer.getAddress().getPort();
    }
    public void stop() {
        httpServer.stop(0);
        httpServer = null;
    }

    public int getPort() { return port; }

    public static void fatal(String message) {
        System.err.println(message);
        System.exit(-1);
    }

    protected Backend createBackend(Object session)// throws Exception
    {
        return createBackend();
    }
    protected Backend createBackend() //throws Exception
    {
        WTDebug.init();
        Backend backend = null;
        String[] args = backendArgs;
        char mode = ' ';
        int i = 0;
        for (; i < args.length; i++) {
            String arg = args[i];
            if (arg.equals("--pty") || arg.equals("-e"))
                mode = 'T';
            else if (arg.equals("--shell")
                     || arg.equals("--pipe")
                     || arg.equals("--process"))
                mode = 'S';
            else if (arg.equals("--class")) {
                if (i + 1 == args.length)
                    fatal("missing class name");
                java.lang.reflect.Method method = null;
                String cname = args[i+1];
                try {
                    method = ClassBackend.getMainMethod(cname);
                } catch (Throwable ex) {
                    fatal("caught "+ex+" trying to load class "+cname);
                }
                String[] restArgs = new String[args.length-i-2];
                System.arraycopy(args, i+2, restArgs, 0, restArgs.length);
                backend = new ClassBackend(method, restArgs);
                break;
            }
            else if (arg.length() == 0 || arg.charAt(0) == '-')
                fatal("unknown argument '"+arg+"'");
            else
                break;
        }

        if (backend == null) {
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
                        fatal("caught "+ex);
                }
            }
            try {
                if (mode == 'S')
                    backend = new ProcessBackend(restArgs);
                else
                    backend = new PtyBackend(restArgs, domtermPath);
             } catch (Throwable ex) {
                 fatal("caught "+ex);
             }
        }
        return backend;
    }

    public void processInput(Session session, String msg) {
        Backend backend = session.backend;
        if (verbose > 0)
            WTDebug.println("received msg ["+WTDebug.toQuoted(msg)+"]");
      if (session.pending != null) {
          msg = session.pending + msg;
          session.pending = null;
      }
      int len = msg.length();
      int nl = -1;
      for (int i = 0; i < len; i++) {
          // Octal 222 is 0x92 "Private Use 2".
          if (msg.charAt(i) == '\222') {
              backend.processInputCharacters(msg.substring(0, i));
              int eol = msg.indexOf('\n', i+1);
              if (eol >= 0) {
                  int space = i+1;
                  while (space < eol && msg.charAt(space) != ' ')
                      space++;
                  String cname = msg.substring(i+1, space);
                  while (space < eol && msg.charAt(space) == ' ')
                      space++;
                  session.reportEvent(cname,
                                     msg.substring(space, eol));
                  msg = msg.substring(eol+1);
                  i = -1;
                  len = msg.length();
              } else {
                  session.pending = msg.substring(i);
                  msg = "";
                  i = -1;
                  len = 0;
              }
          }
      }
      backend.processInputCharacters(msg);
    }

    static String domtermPath;

    // 1: run Firefox in -app mode
    // 2: run Chrome in --app mode
    // 2: run qtdomterm
    static int runBrowser = -1;
    public static void main (String[] args) {
        char mode = ' ';
        String browserCommand = null;
        domtermPath = System.getProperty("java.library.path");
        if (domtermPath != null && domtermPath.endsWith("/lib"))
            domtermPath = domtermPath.substring(0, domtermPath.length()-4);
        int port = -1;
        int i = 0;
        for (; i < args.length; i++) {
            String arg = args[i];
            if (arg.equals("--port")) {
                if (i + 1 == args.length)
                    fatal("missing port number");
                arg = args[++i];
                try {
                    port = Integer.parseInt(arg);
                } catch (Exception ex) {
                    fatal("bad port number '"+arg+"'");
                }
            } else if (arg.startsWith("--domterm-path=")) {
                domtermPath = arg.substring(15);
            } else if (arg.equals("--browser")) {
                runBrowser = 0;
            } else if (arg.startsWith("--browser=")) {
                runBrowser = 0;
                browserCommand = arg.substring(10);
            } else if (arg.equals("--firefox")) {
                runBrowser = 1;
            } else if (arg.equals("--chrome")) {
                runBrowser = 2;
            } else if (arg.equals("--qtdomterm")
                       || arg.equals("--qtwebengine")) {
                runBrowser = 3;
            } else
                break;
        }
        String[] backendArgs = new String[args.length-i];
        System.arraycopy(args, i, backendArgs, 0, backendArgs.length);
        if (port == -1)
            port = runBrowser >= 0 ? 0 : 8025;
        try {
            DomHttpServer s = new DomHttpServer(port, backendArgs);
            s.start();
            port = s.getPort();
            String defaultUrl = "http://localhost:"+port+"/domterm/#ajax";
            if (runBrowser == 0) { // desktop --browser
                if (browserCommand == null)
                    Desktop.getDesktop().browse(new URI(defaultUrl));
                else {
                    Process process = Runtime.getRuntime()
                        .exec(new String[] { browserCommand, defaultUrl });
                }
            } else if (runBrowser == 1) { // --firefox
                String firefoxCommand = firefoxCommand();
                Process process = Runtime.getRuntime()
                    .exec(new String[] { firefoxCommand, "-app",
                                         domtermPath+"/share/domterm/application.ini",
                                         "-ajax", "http://localhost:"+port+"/domterm/" });
            } else if (runBrowser == 2) { // --chrome
                String chromeCommand = chromeCommand();
                String appArg = "--app="+defaultUrl;
                Process process = Runtime.getRuntime()
                    .exec(new String[] { chromeCommand, appArg });
                //process.waitFor();
            } else if (runBrowser == 3) { // --qtdomterm
                String command = domtermPath+"/bin/qtdomterm";
                Process process = Runtime.getRuntime()
                    .exec(new String[] { command,
                                         "--connect", "localhost:"+port });
                process.waitFor();
            } else {
                System.out.println("DomTerm server started on port: "+port+".");
                System.out.println("Point your browser at "+defaultUrl);
                BufferedReader reader =
                    new BufferedReader(new InputStreamReader(System.in));
                System.out.print("Please press a key to stop the server.");
                reader.readLine();
            }
            if (runBrowser >= 0) {
                s.endMonitor = new Object();
                synchronized (s.endMonitor) {
                    s.endMonitor.wait();
                }
            }
            s.stop();
            System.exit(0);
        } catch (Throwable ex) {
            ex.printStackTrace();
            throw new RuntimeException(ex);
        }
    }

    public static String chromeCommand() {
        String chromeCommand = "google-chrome";
        String chromeBin = System.getenv("CHROME_BIN");
        if (chromeBin != null && new File(chromeBin).exists())
            chromeCommand = chromeBin;
        return chromeCommand;
    }

    public static String firefoxCommand() {
        String firefoxCommand = "firefox";
        String firefoxMac =
            "/Applications/Firefox.app/Contents/MacOS/firefox";
        if (new File(firefoxMac).exists())
            firefoxCommand = firefoxMac;
        return firefoxCommand;
    }
}
