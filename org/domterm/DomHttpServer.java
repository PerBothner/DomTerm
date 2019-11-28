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
        String pendingEvent = null;
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
        private static byte[] noBytes = new byte[0];
        Session session;
        byte[] bytes = noBytes;
        int numBytes = 0;
        boolean closed;
	int limit = 2000;
	public static final int MASK28 = 0xfffffff;
	int countWritten;
	int countConfirmed;

        ReplWriter(Session session) { super(true); this.session = session; }
 
        @Override
        protected synchronized void writeRaw(String str) throws IOException {
            byte[] strBytes = str.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            int strBLength = strBytes.length;
            int minSize = numBytes + strBLength;
            if (bytes == noBytes) {
                bytes = strBytes;
            } else {
                if (minSize >  bytes.length) {
                    int newSize = (3 * numBytes) >> 1;
                    if (minSize > newSize)
                        newSize = minSize;
                    byte[] newBytes = new byte[newSize];
                    System.arraycopy(bytes, 0, newBytes, 0, numBytes);
                    bytes = newBytes;
                }
                System.arraycopy(strBytes, 0, bytes, numBytes, strBLength);
            }
            numBytes = minSize;
	    countWritten = (countWritten + strBLength) & MASK28;
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
	    /*
		    if (((sentCount - confirmedCount) & MASK28) < 1000
			&& paused) {
			// FIXME lws_rx_flow_control(client->pty_wsi, 1);
			paused = false;
	    */
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

    private byte[] inputBuffer;
    private int inputLength;

    private void readAll(HttpExchange exchange) throws IOException {
        InputStream in = exchange.getRequestBody();
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
        this.inputBuffer = buf;
        this.inputLength = n;
        in.close();

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
                readAll(exchange);
                String rtext = new String(this.inputBuffer, 0, this.inputLength,
                                   java.nio.charset.StandardCharsets.UTF_8);
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
                exchange.getResponseHeaders()
                    .set("Content-Type", "text/plain");
                exchange.sendResponseHeaders(200, bmsg.length);
                OutputStream out = exchange.getResponseBody();
                out.write(bmsg);
                out.close();
                return;
            }
            else if (uris.startsWith("/io-")) {
                String key = uris.substring(4);
                Session session = sessionMap.get(key);
                readAll(exchange);
                Backend backend = session.backend;
                processInput(session);
                byte[] bytes;
                int numBytes;
                ReplWriter termWriter = session.termWriter;
                synchronized (termWriter) {
                    bytes = termWriter.bytes;
                    numBytes = termWriter.numBytes;
                    termWriter.bytes = ReplWriter.noBytes;
                    termWriter.numBytes = 0;
                }
                exchange.sendResponseHeaders(200, numBytes);
                OutputStream out = exchange.getResponseBody();
                out.write(bytes, 0, numBytes);
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
                    //PTY.checkLoaded();
                    Class.forName("org.domterm.pty.PTY");
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
                    backend =
                        ProcessBackend.tryPtyOrProcessBackend(restArgs,
                                                              domtermPath);
            } catch (Throwable ex) {
                 fatal("caught "+ex);
            }
        }
        return backend;
    }

    private void processInput(Session session) {
        Backend backend = session.backend;
      int start = 0;
      int len =  this.inputLength;
      int nl = -1;
      byte[] buf = this.inputBuffer;

      for (int i = 0; ; i++) {
          if (i == len || (buf[i] & 0xFF) == 0xFD || session.pendingEvent != null) {
              if (i > start) {
                  String msg = new String(buf, start, i-start,
                                          java.nio.charset.StandardCharsets.UTF_8);
                  if (verbose > 0)
                      WTDebug.println("received msg ["+WTDebug.toQuoted(msg)+"]");
                  backend.processInputCharacters(msg);
              }
              start = i;
              if (i == len)
                  break;
              // Otherwise: buf[i] == 0xFD
              if (session.pendingEvent == null)
                  i++;
              int j = i;
              while (j < len && buf[j] != (byte) '\n')
                  j++;
              String msg = new String(buf, i, j-i,
                                      java.nio.charset.StandardCharsets.UTF_8);
              if (session.pendingEvent != null)
                  msg = session.pendingEvent + msg;
              if (j == len) {
                  session.pendingEvent = msg;
                  break;
              }
              session.pendingEvent = null;
              int space = msg.indexOf(' ');
              String cname = space < 0 ? msg : msg.substring(0, space);
              String data = space < 0 ? "" : msg.substring(space+1);
              session.reportEvent(cname, data);
              i = j;
              start = j + 1;
          }
      }
    }

    static String domtermPath;

    // 1: run Firefox
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
                    .exec(new String[] { firefoxCommand, defaultUrl });
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
