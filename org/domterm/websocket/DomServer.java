package org.domterm.websocket;

import java.io.*;
import java.util.*;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;

import org.domterm.*;
import org.domterm.util.StringBufferedWriter;
import org.domterm.util.WTDebug;
import org.domterm.pty.*;

import org.java_websocket.WebSocket;
import org.java_websocket.framing.Framedata;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

public class DomServer extends WebSocketServer {
    static int verbose = 0;
    Map<WebSocket,Client> clientMap
        = new IdentityHashMap<>();
    Set<Client> pendingClients = new HashSet<>();

    // FIXME - should be per Client
    String pending = null;

    String[] clientArgs;

    static class ReplWriter extends StringBufferedWriter {
        WebSocket session;
        ReplWriter(WebSocket session) { super(true); this.session = session; }
 
        @Override
        protected void writeRaw(String str) throws IOException {
             session.send(str);
        }
     }

    public DomServer(int port, String[] clientArgs)
        throws UnknownHostException {
        super(new InetSocketAddress(port));
        this.clientArgs = clientArgs;
    }

    public DomServer(InetSocketAddress address, String[] clientArgs) {
        super(address);
        this.clientArgs = clientArgs;
    }

    public static void fatal(String message) {
        System.err.println(message);
        System.exit(-1);
    }

    Client createClient(WebSocket session, String[] args)
        throws Exception {
        Client client = null;
        char mode = ' ';
        int i = 0;
        for (; i < args.length; i++) {
            String arg = args[i];
            if (arg.equals("--pty"))
                mode = 'T';
            else if (arg.equals("--shell") || arg.equals("--process"))
                mode = 'S';
            else if (arg.length() == 0 || arg.charAt(0) == '-')
                fatal("unknown argument '"+arg+"'");
            else
                break;
        }

        WTDebug.init();
        if (client == null) {
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
                    client = new ProcessClient(restArgs);
                else
                    client = new PtyClient(restArgs);
             } catch (Throwable ex) {
                 fatal("caught "+ex);
             }
        }
        return client;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        try {
            Client client = createClient(conn, clientArgs);
            clientMap.put(conn, client);
            pendingClients.add(client);
        } catch (Throwable ex) {
            WTDebug.println("onOpen caught "+ex);
            throw new RuntimeException(ex);
        }
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote ) {
        WTDebug.println("onClose called");
        clientMap.remove(conn);
    }

    @Override
    public void onMessage(WebSocket conn, String msg) {
        Client client = clientMap.get(conn);
        if (verbose > 0)
            WTDebug.println("received msg ["+WTDebug.toQuoted(msg)+"] from "+conn);
      if (pending != null) {
          msg = pending + msg;
          pending = null;
      }
      int i = 0;
      int len = msg.length();
      int nl = -1;
      if (len >= 10 && msg.charAt(0) == 0x92
          && msg.substring(1, 9).equals("VERSION ")
          && (nl = msg.indexOf('\n')) > 0) {
          client.addVersionInfo(msg.substring(9, nl));
          nl++;
          len -= nl;
          msg = msg.substring(nl);
      }
      if (pendingClients.remove(client)) {
          try {
        client.versionInfo = client.versionInfo+";Java-WebSocket-server";
        client.run(new ReplWriter(conn));
          } catch (Throwable ex) {
              ex.printStackTrace();}
      }
      for (; i < len; i++) {
          // Octal 222 is 0x92 "Private Use 2".
          if (msg.charAt(i) == '\222') {
              client.processInputCharacters(msg.substring(0, i));
              int eol = msg.indexOf('\n', i+1);
              if (eol >= 0) {
                  int space = i+1;
                  while (space < eol && msg.charAt(space) != ' ')
                      space++;
                  String cname = msg.substring(i+1, space);
                  while (space < eol && msg.charAt(space) == ' ')
                      space++;
                  client.reportEvent(cname,
                                     msg.substring(space, eol));
                  msg = msg.substring(eol+1);
                  i = -1;
                  len = msg.length();
              } else {
                  pending = msg.substring(i);
                  msg = "";
                  i = -1;
                  len = 0;
              }
          }
      }
      client.processInputCharacters(msg);
    }

    @Override
    public void onFragment( WebSocket conn, Framedata fragment ) {
        WTDebug.println("onFragment called");
        System.out.println( "received fragment: " + fragment );
    }

    @Override
    public void onError( WebSocket conn, Exception ex ) {
        WTDebug.println("onError called");
        ex.printStackTrace();
        clientMap.remove(conn);
        if( conn != null ) {
            // some errors like port binding failed may not be assignable to a specific websocket
        }
    }

    public static void main (String[] args) {
        char mode = ' ';
        //int port = 8887; // 843 flash policy port
        int port = 8025;
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
            } else
                break;
        }
        String[] clientArgs = new String[args.length-i];
        System.arraycopy(args, i, clientArgs, 0, clientArgs.length);

        try {
            DomServer s = new DomServer(port, clientArgs);
            s.start();
            System.out.println("DomTerm server started on port: "
                               + s.getPort());
            BufferedReader reader =
                new BufferedReader(new InputStreamReader(System.in));
            System.out.print("Please press a key to stop the server.");
            reader.readLine();
            System.err.println("ready to stop");
            s.stop();
            System.exit(0);
        } catch (Throwable ex) {
            ex.printStackTrace();
            throw new RuntimeException(ex);
        }
    }
}
