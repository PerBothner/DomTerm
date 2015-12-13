// Inspired by / based on:
// http://architects.dzone.com/articles/sample-java-web-socket-client

package websocketterm;
//package websocket.server;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import javax.websocket.*;
import javax.websocket.server.*;
import ptyconsole.*;
import org.domterm.util.Util;
import org.domterm.util.WTDebug;
import org.domterm.*;

@ServerEndpoint("/replsrv")
public class ReplServer {
    Map<Session,Client> clientMap
        = new IdentityHashMap<Session,Client>();

    static int verbose = 0;
 
    static class ReplWriter extends Writer {
         Session session;
         ReplWriter(Session session) { this.session = session; }
         public void write(char[] buffer, int start, int len)
             throws IOException {
             write(new String(buffer, start, len));
         }
         public void write(String str)
             throws IOException {
             session.getBasicRemote().sendText(str);
         }
         public void flush() { }
         public void close() { }
     }

    static Client createClient(Session session) throws Exception {
        Client client;
        client = new PtyClient();
        //client = new ProcessClient();

        client.run(new ReplWriter(session));
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
          System.out.println("received msg ["+quoteString(msg)+"] from "+session.getId());
      if (pending != null) {
          msg = pending + msg;
          pending = null;
      }
      int i = 0;
      int len = msg.length();
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
  System.out.println("New session opened: "+session.getId());
 }

  @OnError
 public void error(Session session, Throwable t) {
      clientMap.remove(session);
  System.err.println("Error on session "+session.getId());  
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
