// Inspired by / based on:
// http://architects.dzone.com/articles/sample-java-web-socket-client

package websocketterm;
//package websocket.server;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import javax.websocket.*;
import javax.websocket.server.*;
import org.domterm.*;
import org.domterm.util.StringBufferedWriter;
import org.domterm.util.Util;
import org.domterm.util.WTDebug;
import org.domterm.pty.*;

@ServerEndpoint("/replsrv")
public class ReplServer {
    Map<Session,Client> clientMap
        = new IdentityHashMap<Session,Client>();
    Set<Client> pendingClients = new HashSet<Client>();

    static int verbose = 0;
 
    static class ReplWriter extends StringBufferedWriter {
        Session session;
        ReplWriter(Session session) { super(true); this.session = session; }
 
        protected void writeRaw(String str) throws IOException {
             session.getBasicRemote().sendText(str);
        }
     }

    static Client createClient(Session session) throws Exception {
        Client client;
        WTDebug.init();
        client = new PtyClient();
        //client = new ProcessClient();
        //client = new ProcessClient(new String[] {"java", "kawa.repl", "--domterm", "--console"} );
        //client = new ProcessClient(new String[] {"java", "-jar", "/home/bothner/Kawa/unmodified/kawa-2.1.1.jar", "--domterm", "--console"} );
        //client = new ClassClient("kawa.repl",
        //                         new String[] { "--console" });
        return client;
    }

    /** for debugging */
    public static String quoteString(String str) {
        if (str == null)
            return "(null)";
        StringBuilder sbuf = new StringBuilder();
        for (int i = 0;  i < str.length();  i++) {
            char ch = str.charAt(i);
            switch (ch) {
            case '\n': sbuf.append("\\n"); break;
            case '\r': sbuf.append("\\r"); break;
            case '\b': sbuf.append("\\b"); break;
            case 27: sbuf.append("\\E"); break;
            default:
                if (ch < ' ' || ch >= 127)
                    sbuf.append("\\u"+Integer.toHexString(ch));
                else
                    sbuf.append(ch);
            }
        }
        return sbuf.toString();
    }
 
    String pending = null;

    @OnMessage
    public void onMessage(Session session, String msg) {
        Client client = clientMap.get(session);
      if (verbose > 0)
          WTDebug.println("received msg ["+quoteString(msg)+"] from "+session.getId());
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
        //client.versionInfo = ...;
          try {
        client.versionInfo = client.versionInfo+";websocket-server";
        client.run(new ReplWriter(session));
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

 @OnOpen
 public void open(Session session) throws Exception {
     Client client = createClient(session);
     clientMap.put(session, client);
     pendingClients.add(client);
 }

    @OnError
    public void error(Session session, Throwable t) {
        clientMap.remove(session);
        WTDebug.println("Error on session "+session.getId());  
    }

    @OnClose
    public void closedConnection(Session session) { 
  clientMap.remove(session);
  String msg = "session closed: "+session.getId();
  if (verbose > 0)
      new Error(msg).printStackTrace();
  else
      System.out.println(msg);
 }

}
